import fs from 'node:fs';
import path from 'node:path';
import { BlockerCollection } from '../blockers.mjs';
import { loadCollisionConfig, parseCollisionMappings } from '../collision/config.mjs';
import {
  applyCollisionConfig,
  collectSkuCollisions,
  buildCollisionReportEntry,
  sortCollisionReport,
} from '../collision/detector.mjs';
import { buildCanonicalRecords } from '../canonical/build-from-source.mjs';
import { prepareCanonicalChunks } from '../canonical/prepare.mjs';
import {
  checkFilesystemPrecheck,
} from '../filesystem-stability.mjs';
import { extractSnapshotToNdjson } from '../source/mariadb-snapshot.mjs';
import {
  resolveSpoolPaths,
  writeJsonAtomic,
  writeFileAtomic,
  atomicPromote,
} from '../spool/layout.mjs';

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

  if (!fixtureSourceDir) {
    if (blockers.hasBlockers()) {
      return buildPipelineResult({
        mode,
        config,
        blockers,
        snapshotWatermark,
        built: null,
        products: [],
        collisionConfig: null,
        mappings: [],
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
        config,
        blockers,
        snapshotWatermark: snapshot.snapshotWatermark,
        built: null,
        products: [],
        collisionConfig: null,
        mappings: [],
        prepared: null,
      });
    }

    snapshotWatermark = snapshot.snapshotWatermark;
    stockSyncUnix = snapshot.stockSyncUnix;
    sourceDir = snapshot.sourceDir;
    buildingPath = snapshot.buildingPath;
  } else {
    snapshotWatermark = 'fixture-watermark-123456789012345678';
    stockSyncUnix = 1700000000;
    buildingPath = resolveSpoolPaths(config.spoolRoot, snapshotWatermark).building;
  }

  const collisionConfig = loadCollisionConfig(config.collisionConfigPath);
  const mappings = parseCollisionMappings(collisionConfig);

  const built = await buildCanonicalRecords({
    sourceDir,
    config,
    stockSyncUnix,
    blockers,
  });

  let products = built.phase1;
  products = applyCollisionConfig({
    products,
    mappings,
    blockers,
  });

  const prepared = prepareCanonicalChunks({
    phase0: built.phase0,
    phase1: products,
    blockers,
  });

  const collisionReport = buildCollisionReport({
    products: built.phase1,
    mappings,
  });

  const preflightReport = {
    mode,
    provider: config.provider,
    source_epoch: config.sourceEpoch,
    snapshot_watermark: snapshotWatermark,
    collision_config_sha256: collisionConfig.sha256,
    excluded_by_policy: built.excluded_by_policy,
    product_types: built.product_type_names,
    authority_counts: countAuthorities(built.phase1),
    prepared_chunk_count: prepared?.allChunks.length ?? 0,
    ...blockers.toReport(),
  };

  if (blockers.hasBlockers() || mode === 'preflight') {
    if (buildingPath && fs.existsSync(buildingPath) && !fixtureSourceDir) {
      fs.rmSync(buildingPath, { recursive: true, force: true });
    }
    return buildPipelineResult({
      mode,
      config,
      blockers,
      snapshotWatermark,
      built,
      products,
      collisionConfig,
      mappings,
      prepared,
      preflightReport,
      collisionReport,
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
    authorityCounts: countAuthorities(products),
    phase0Count: built.phase0.length,
    phase1Count: products.length,
  });

  return {
    ok: true,
    preflight: preflightReport,
    collisionReport,
    snapshotWatermark,
    spool: spoolResult,
    blockers,
    prepared,
  };
}

function buildPipelineResult({
  mode,
  blockers,
  snapshotWatermark,
  built,
  products,
  collisionReport,
  preflightReport,
  prepared,
}) {
  return {
    ok: !blockers.hasBlockers(),
    mode,
    preflight: preflightReport ?? {
      mode,
      snapshot_watermark: snapshotWatermark,
      prepared_chunk_count: prepared?.allChunks.length ?? 0,
      ...blockers.toReport(),
    },
    collisionReport,
    snapshotWatermark,
    blockers,
    phase0: built?.phase0 ?? [],
    phase1: products,
    prepared,
  };
}

function countAuthorities(products) {
  let ru = 0;
  let uk = 0;
  for (const product of products) {
    if (product.authority?.language === 'ru') ru += 1;
    else if (product.authority?.language === 'uk') uk += 1;
  }
  return { ru, uk_fallback: uk };
}

function buildCollisionReport({ products, mappings }) {
  const { cross, within } = collectSkuCollisions(products);
  const productIndex = new Map(products.map(p => [p.native_product_id, p]));
  const entries = [];

  for (const collision of cross) {
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
  for (const collision of within) {
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
  fs.mkdirSync(building, { recursive: true });

  let totalRows = 0;
  let largestChunkBytes = 0;
  let largestProductBytes = 0;

  for (const chunk of prepared.allChunks) {
    writeFileAtomic(building, chunk.filename, chunk.body);
    totalRows += chunk.rows;
    largestChunkBytes = Math.max(largestChunkBytes, chunk.bytes);
  }

  for (const product of prepared.canonicalPhase1) {
    const bytes = Buffer.byteLength(JSON.stringify(product), 'utf8');
    largestProductBytes = Math.max(largestProductBytes, bytes);
  }

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
    chunk_count: prepared.allChunks.length,
    chunks: prepared.allChunks.map(c => ({
      filename: c.filename,
      phase: c.phase,
      rows: c.rows,
      bytes: c.bytes,
      sha256: c.sha256,
    })),
    total_canonical_rows: totalRows,
    largest_chunk_bytes: largestChunkBytes,
    largest_product_bytes: largestProductBytes,
  };

  writeJsonAtomic(building, 'manifest.json', manifest);
  writeJsonAtomic(building, 'preflight.json', preflightReport);
  writeJsonAtomic(building, 'collision-report.json', collisionReport);

  const sourceScratch = path.join(building, 'source');
  if (fs.existsSync(sourceScratch)) {
    fs.rmSync(sourceScratch, { recursive: true, force: true });
  }

  atomicPromote(building, ready);

  return {
    readyPath: ready,
    manifest,
    prepared,
  };
}
