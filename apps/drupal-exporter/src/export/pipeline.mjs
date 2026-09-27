import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BLOCKER_CODES, Blocker, BlockerCollection } from '../blockers.mjs';
import { loadCollisionConfig, parseCollisionMappings, validateCollisionMappingUniqueness } from '../collision/config.mjs';
import {
  createSkuCollisionCollector,
  resolveCollisionExclusions,
  filterProductByExclusions,
  buildCollisionReportEntry,
  sortCollisionReport,
} from '../collision/detector.mjs';
import { buildCanonicalRecords } from '../canonical/build-from-source.mjs';
import { IncrementalChunkWriter } from '../canonical/incremental-chunks.mjs';
import { sanitizeProductForCanonical } from '../canonical/sanitize.mjs';
import {
  checkFilesystemPrecheck,
} from '../filesystem-stability.mjs';
import { extractSnapshotToNdjson } from '../source/mariadb-snapshot.mjs';
import {
  resolveSpoolPaths,
  writeJsonAtomic,
  atomicPromote,
} from '../spool/layout.mjs';
import { streamCandidateProducts } from './candidates.mjs';

export async function runExportPipeline({
  config,
  mode,
  sourceExtractor = extractSnapshotToNdjson,
  fixtureSourceDir = null,
  skipFilesystemChecks = false,
}) {
  const blockers = new BlockerCollection();
  const precheck = skipFilesystemChecks
    ? { blockers: [], processedFingerprint: null }
    : checkFilesystemPrecheck(config);
  for (const blocker of precheck.blockers) blockers.add(blocker);

  let snapshotWatermark = '0';
  let stockSyncUnix = 0;
  let sourceDir = fixtureSourceDir;
  let buildingPath = null;
  let ownsBuildingPath = false;

  if (!fixtureSourceDir) {
    if (blockers.hasBlockers()) {
      return buildPipelineResult({
        mode,
        blockers,
        snapshotWatermark,
        built: null,
        prepared: null,
      });
    }

    const snapshot = await sourceExtractor({
      config,
      beforeFingerprint: precheck.processedFingerprint,
    });

    if (snapshot.unstable) {
      for (const blocker of snapshot.blockers) blockers.add(blocker);
      return buildPipelineResult({
        mode,
        blockers,
        snapshotWatermark: snapshot.snapshotWatermark,
        built: null,
        prepared: null,
      });
    }

    snapshotWatermark = snapshot.snapshotWatermark;
    stockSyncUnix = snapshot.stockSyncUnix;
    sourceDir = snapshot.sourceDir;
    buildingPath = snapshot.buildingPath;
    ownsBuildingPath = snapshot.ownsBuildingPath ?? false;
  } else {
    snapshotWatermark = 'fixture-watermark-123456789012345678';
    stockSyncUnix = 1700000000;
    buildingPath = resolveSpoolPaths(config.spoolRoot, snapshotWatermark).building;
  }

  const collisionConfig = loadCollisionConfig(config.collisionConfigPath);
  const mappings = parseCollisionMappings(collisionConfig);
  validateCollisionMappingUniqueness(mappings, blockers);

  const built = await buildCanonicalRecords({
    sourceDir,
    config,
    stockSyncUnix,
    blockers,
  });

  const collisionCollector = createSkuCollisionCollector(blockers);
  const productIndex = new Map();
  await streamCandidateProducts(built.candidatesPath, product => {
    collisionCollector.addProduct(product);
    productIndex.set(product.native_product_id, product);
  });
  const collisionSnapshot = collisionCollector.snapshot();

  const exclusions = resolveCollisionExclusions({
    cross: collisionSnapshot.cross,
    within: collisionSnapshot.within,
    mappings,
    blockers,
  });

  const collisionReport = buildCollisionReport({
    collisionSnapshot,
    productIndex,
    mappings,
  });

  const filteredPath = path.join(path.dirname(built.candidatesPath), 'filtered.ndjson');
  let prepared = null;
  let phase1Count = 0;
  if (!blockers.hasBlockers()) {
    const chunkResult = await prepareIncrementalChunks({
      phase0: built.phase0,
      candidatesPath: built.candidatesPath,
      filteredPath,
      exclusions,
      blockers,
      mode,
      buildingPath,
    });
    prepared = chunkResult?.prepared ?? null;
    phase1Count = chunkResult?.phase1Count ?? 0;
  }

  const authorityCounts = await countFilteredAuthorities(
    built.candidatesPath,
    exclusions
  );

  const preflightReport = {
    mode,
    provider: config.provider,
    source_epoch: config.sourceEpoch,
    snapshot_watermark: snapshotWatermark,
    collision_config_sha256: collisionConfig.sha256,
    excluded_by_policy: built.excluded_by_policy,
    product_types: built.product_type_names,
    authority_counts: authorityCounts,
    prepared_chunk_count: prepared?.chunks.length ?? 0,
    ...blockers.toReport(),
  };

  if (blockers.hasBlockers() || mode === 'preflight') {
    if (prepared?.writer) {
      prepared.writer.cleanup();
    }
    if (buildingPath && fs.existsSync(buildingPath) && (ownsBuildingPath || fixtureSourceDir)) {
      fs.rmSync(buildingPath, { recursive: true, force: true });
    }
    return buildPipelineResult({
      mode,
      blockers,
      snapshotWatermark,
      built,
      prepared,
      preflightReport,
      collisionReport,
      candidatesPath: built.candidatesPath,
      filteredPath,
    });
  }

  const spoolResult = writePreparedSpool({
    config,
    snapshotWatermark,
    buildingPath,
    preflightReport,
    collisionReport,
    prepared,
    excludedByPolicy: built.excluded_by_policy,
    authorityCounts,
    phase0Count: built.phase0.length,
    phase1Count,
  });

  return {
    ok: true,
    preflight: preflightReport,
    collisionReport,
    snapshotWatermark,
    spool: spoolResult,
    blockers,
    prepared,
    candidatesPath: built.candidatesPath,
    filteredPath,
  };
}

async function countFilteredAuthorities(candidatesPath, exclusions) {
  let ru = 0;
  let uk = 0;
  await streamCandidateProducts(candidatesPath, product => {
    const filtered = filterProductByExclusions(product, exclusions);
    if (!filtered) return;
    if (filtered.authority?.language === 'ru') ru += 1;
    else if (filtered.authority?.language === 'uk') uk += 1;
  });
  return { ru, uk_fallback: uk };
}

async function prepareIncrementalChunks({
  phase0,
  candidatesPath,
  filteredPath,
  exclusions,
  blockers,
  mode,
  buildingPath,
}) {
  const outputDir = mode === 'preflight'
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'drupal-chunks-scratch-'))
    : buildingPath;

  const writer = new IncrementalChunkWriter({
    outputDir,
    scratch: mode === 'preflight',
  });

  if (fs.existsSync(filteredPath)) {
    fs.unlinkSync(filteredPath);
  }

  let phase1Count = 0;

  try {
    writer.writePhase0Records(phase0);

    const postCollector = createSkuCollisionCollector(blockers);
    await streamCandidateProducts(candidatesPath, product => {
      const filtered = filterProductByExclusions(product, exclusions);
      if (!filtered) return;
      phase1Count += 1;
      fs.appendFileSync(filteredPath, `${JSON.stringify(filtered)}\n`);
      postCollector.addProduct(filtered);
      writer.writePhase1Record(sanitizeProductForCanonical(filtered));
    });

    const remaining = postCollector.snapshot();
    for (const collision of remaining.cross) {
      blockers.add(new Blocker(
        BLOCKER_CODES.SKU_COLLISION_CROSS_PRODUCT,
        `Unresolved cross-product SKU collision: ${collision.sku_key}`,
        {
          sku_key: collision.sku_key,
          products: [...new Set(collision.entries.map(e => e.native_product_id))],
        }
      ));
    }
    for (const collision of remaining.within) {
      if (collision.variants.length > 2) {
        blockers.add(new Blocker(
          BLOCKER_CODES.COLLISION_MAPPING_UNSUPPORTED,
          'Within-product collision has more than two variants',
          {
            sku_key: collision.sku_key,
            native_product_id: collision.native_product_id,
            variants: collision.variants.map(v => v.native_variant_id),
          }
        ));
        continue;
      }
      blockers.add(new Blocker(
        BLOCKER_CODES.SKU_COLLISION_WITHIN_PRODUCT,
        `Unresolved within-product SKU collision: ${collision.sku_key}`,
        {
          sku_key: collision.sku_key,
          native_product_id: collision.native_product_id,
          variants: collision.variants.map(v => v.native_variant_id),
        }
      ));
    }

    if (blockers.hasBlockers()) {
      writer.cleanup();
      if (fs.existsSync(filteredPath)) fs.unlinkSync(filteredPath);
      return { prepared: null, phase1Count: 0 };
    }

    const result = writer.finish();
    return {
      prepared: {
        ...result,
        writer,
      },
      phase1Count,
    };
  } catch (error) {
    writer.cleanup();
    if (fs.existsSync(filteredPath)) fs.unlinkSync(filteredPath);
    if (error instanceof Blocker) {
      blockers.add(error);
      return { prepared: null, phase1Count: 0 };
    }
    throw error;
  }
}

function buildPipelineResult({
  mode,
  blockers,
  snapshotWatermark,
  built,
  collisionReport,
  preflightReport,
  prepared,
  candidatesPath,
  filteredPath,
}) {
  return {
    ok: !blockers.hasBlockers(),
    mode,
    preflight: preflightReport ?? {
      mode,
      snapshot_watermark: snapshotWatermark,
      prepared_chunk_count: prepared?.chunks.length ?? 0,
      ...blockers.toReport(),
    },
    collisionReport,
    snapshotWatermark,
    blockers,
    phase0: built?.phase0 ?? [],
    prepared,
    candidatesPath,
    filteredPath,
  };
}

function buildCollisionReport({ collisionSnapshot, productIndex, mappings }) {
  const entries = [];

  for (const collision of collisionSnapshot.cross) {
    for (const entry of collision.entries) {
      entries.push(buildCollisionReportEntry({
        collision: {
          collision_type: 'cross_product',
          native_product_id: entry.native_product_id,
          variant: entry.variant,
          product: entry.product,
        },
        productIndex,
      }));
    }
  }
  for (const collision of collisionSnapshot.within) {
    for (const variant of collision.variants) {
      entries.push(buildCollisionReportEntry({
        collision: {
          collision_type: 'within_product',
          native_product_id: collision.native_product_id,
          variant,
          product: productIndex.get(collision.native_product_id),
        },
        productIndex,
      }));
    }
  }

  return {
    version: 1,
    mapping_count: mappings.length,
    entries: sortCollisionReport(entries),
  };
}

function writePreparedSpool({
  config,
  snapshotWatermark,
  buildingPath,
  preflightReport,
  collisionReport,
  prepared,
  excludedByPolicy,
  authorityCounts,
  phase0Count,
  phase1Count,
}) {
  const { ready } = resolveSpoolPaths(config.spoolRoot, snapshotWatermark);
  const building = buildingPath ?? resolveSpoolPaths(config.spoolRoot, snapshotWatermark).building;

  const manifest = {
    schema: 'bp.drupal-exporter.spool/1',
    version: 1,
    provider: config.provider,
    source_epoch: config.sourceEpoch,
    snapshot_watermark: snapshotWatermark,
    collision_config_sha256: preflightReport.collision_config_sha256,
    authority_counts: authorityCounts,
    excluded_by_policy: excludedByPolicy,
    blocker_count: 0,
    warning_count: 0,
    phase_row_counts: {
      phase0: phase0Count,
      phase1: phase1Count,
    },
    chunk_count: prepared.chunks.length,
    chunks: prepared.chunks.map(c => ({
      filename: c.filename,
      phase: c.phase,
      rows: c.rows,
      bytes: c.bytes,
      sha256: c.sha256,
    })),
    total_canonical_rows: prepared.totalRows,
    largest_chunk_bytes: prepared.largestChunkBytes,
    largest_product_bytes: prepared.largestProductBytes,
  };

  writeJsonAtomic(building, 'manifest.json', manifest);
  writeJsonAtomic(building, 'preflight.json', preflightReport);
  writeJsonAtomic(building, 'collision-report.json', collisionReport);

  const sourceScratch = path.join(building, 'source');
  if (fs.existsSync(sourceScratch)) {
    fs.rmSync(sourceScratch, { recursive: true, force: true });
  }

  const sourceCandidates = path.join(building, 'source', 'candidates.ndjson');
  if (fs.existsSync(sourceCandidates)) {
    fs.unlinkSync(sourceCandidates);
  }

  atomicPromote(building, ready);

  return {
    readyPath: ready,
    manifest,
    prepared,
  };
}
