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
import { packPhaseChunks, buildChunkFiles } from '../canonical/chunk-packer.mjs';
import { sanitizePhaseRecords } from '../canonical/sanitize.mjs';
import {
  checkFilesystemPrecheck,
  checkFilesystemStability,
} from '../filesystem-stability.mjs';
import { extractSnapshotToNdjson } from '../source/mariadb-snapshot.mjs';
import {
  resolveSpoolPaths,
  createBuildingDir,
  writeJsonAtomic,
  writeFileAtomic,
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
  let sourceDir;

  if (fixtureSourceDir) {
    sourceDir = fixtureSourceDir;
    snapshotWatermark = 'fixture-watermark-123456789012345678';
    stockSyncUnix = 1700000000;
  } else {
    const buildingPaths = resolveSpoolPaths(config.spoolRoot, 'pending');
    sourceDir = path.join(buildingPaths.building, 'source');
    fs.mkdirSync(sourceDir, { recursive: true });

    const snapshot = await sourceExtractor({ config, sourceDir });
    snapshotWatermark = snapshot.snapshotWatermark;
    stockSyncUnix = snapshot.stockSyncUnix;

    const stability = checkFilesystemStability({
      config,
      beforeFingerprint: precheck.processedFingerprint,
      stockSyncUnix,
    });
    for (const blocker of stability.blockers) blockers.add(blocker);
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
    ...blockers.toReport(),
  };

  if (mode === 'preflight' || blockers.hasBlockers()) {
    return {
      ok: !blockers.hasBlockers(),
      preflight: preflightReport,
      collisionReport,
      snapshotWatermark,
      blockers,
      phase0: built.phase0,
      phase1: products,
    };
  }

  const spoolResult = await writeSpool({
    config,
    snapshotWatermark,
    preflightReport,
    collisionReport,
    phase0: built.phase0,
    phase1: products,
    collisionConfigSha256: collisionConfig.sha256,
    excludedByPolicy: built.excluded_by_policy,
    authorityCounts: countAuthorities(products),
  });

  return {
    ok: true,
    preflight: preflightReport,
    collisionReport,
    snapshotWatermark,
    spool: spoolResult,
    blockers,
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

async function writeSpool({
  config,
  snapshotWatermark,
  preflightReport,
  collisionReport,
  phase0,
  phase1,
  collisionConfigSha256,
  excludedByPolicy,
  authorityCounts,
}) {
  const { building, ready } = resolveSpoolPaths(config.spoolRoot, snapshotWatermark);
  createBuildingDir(building);

  const canonicalPhase0 = sanitizePhaseRecords(phase0);
  const canonicalPhase1 = sanitizePhaseRecords(phase1);
  const phase0Chunks = buildChunkFiles(packPhaseChunks(canonicalPhase0, 0), 0);
  const phase1Chunks = buildChunkFiles(packPhaseChunks(canonicalPhase1, 1), 1);
  const allChunks = [...phase0Chunks, ...phase1Chunks];

  let totalRows = 0;
  let largestChunkBytes = 0;
  let largestProductBytes = 0;

  for (const chunk of allChunks) {
    writeFileAtomic(building, chunk.filename, chunk.body);
    totalRows += chunk.rows;
    largestChunkBytes = Math.max(largestChunkBytes, chunk.bytes);
  }

  for (const product of phase1) {
    const bytes = Buffer.byteLength(JSON.stringify(product), 'utf8');
    largestProductBytes = Math.max(largestProductBytes, bytes);
  }

  const manifest = {
    schema: 'bp.drupal-exporter.spool/1',
    version: 1,
    provider: config.provider,
    source_epoch: config.sourceEpoch,
    snapshot_watermark: snapshotWatermark,
    collision_config_sha256: collisionConfigSha256,
    authority_counts: authorityCounts,
    excluded_by_policy: excludedByPolicy,
    blocker_count: 0,
    warning_count: 0,
    phase_row_counts: {
      phase0: phase0.length,
      phase1: phase1.length,
    },
    chunk_count: allChunks.length,
    chunks: allChunks.map(c => ({
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

  const { atomicPromote } = await import('../spool/layout.mjs');
  atomicPromote(building, ready);

  return {
    readyPath: ready,
    manifest,
  };
}
