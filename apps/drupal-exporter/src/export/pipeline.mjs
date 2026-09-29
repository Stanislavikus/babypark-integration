import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BLOCKER_CODES, Blocker, BlockerCollection } from '../blockers.mjs';
import { loadCollisionConfig, parseCollisionMappings, partitionCollisionMappings } from '../collision/config.mjs';
import {
  createSkuCollisionCollector,
  resolveCollisionExclusions,
  filterProductByExclusions,
  buildCollisionReportEntry,
  sortCollisionReport,
  verifyPublishableSkuCollisions,
} from '../collision/detector.mjs';
import { loadPublicationPolicy } from '../anomaly/publication-policy.mjs';
import {
  buildDrupalAnomalyReport,
  deriveAnomalyQuarantine,
  filterProductByQuarantine,
} from '../anomaly/quarantine.mjs';
import { observationsFromCollisionSnapshot } from '../../../../src/catalog/anomaly/observation.mjs';
import { buildCanonicalRecords } from '../canonical/build-from-source.mjs';
import {
  IncrementalChunkWriter,
  validateSingleCanonicalRecord,
  purgeChunkArtifacts,
} from '../canonical/incremental-chunks.mjs';
import { sanitizeProductForCanonical } from '../canonical/sanitize.mjs';
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
import { streamCandidateProducts } from './candidates.mjs';
import { loadReleaseProvenance, RUNTIME_PACKAGE_LOCK_PATH, RUNTIME_RELEASE_PROVENANCE_PATH } from '../release-provenance.mjs';
import { checkDiskSpaceGate } from '../disk-gate.mjs';
import { collectFixtureSourceAcceptance } from '../source/source-acceptance.mjs';
import { loadSourceAcceptanceCases } from '../source/source-acceptance-config.mjs';
import { finishStage, startStage } from '../stage-timings.mjs';

export async function runExportPipeline({
  config,
  mode,
  sourceExtractor = extractSnapshotToNdjson,
  fixtureSourceDir = null,
  skipFilesystemChecks = false,
}) {
  const totalStarted = startStage();
  const stageTimings = {};
  const blockers = new BlockerCollection();
  const prerequisitesStarted = startStage();
  const releaseProvenance = loadReleaseProvenance(
    config.releaseProvenancePath,
    {
      expectedPath: fixtureSourceDir ? null : RUNTIME_RELEASE_PROVENANCE_PATH,
      expectedPackageLockPath: fixtureSourceDir ? null : RUNTIME_PACKAGE_LOCK_PATH,
    }
  );
  const sourceAcceptanceCases = loadSourceAcceptanceCases(config.sourceAcceptanceCasesPath);
  finishStage(stageTimings, 'prerequisites_ms', prerequisitesStarted);

  const diskGateStarted = startStage();
  const diskGate = skipFilesystemChecks
    ? { checks: [], blockers: [] }
    : checkDiskSpaceGate({
        paths: [os.tmpdir(), config.spoolRoot, config.dbDataPath],
        minFreeBytes: config.minFreeBytes,
      });
  for (const blocker of diskGate.blockers) blockers.add(blocker);
  finishStage(stageTimings, 'disk_gate_ms', diskGateStarted);

  const filesystemPrecheckStarted = startStage();
  const precheck = skipFilesystemChecks
    ? { blockers: [], processedFingerprint: null }
    : checkFilesystemPrecheck(config);
  for (const blocker of precheck.blockers) blockers.add(blocker);
  finishStage(stageTimings, 'filesystem_precheck_ms', filesystemPrecheckStarted);

  let snapshotWatermark = '0';
  let stockSyncUnix = 0;
  let sourceDir = fixtureSourceDir;
  let sourceAcceptance = null;
  let buildingPath = null;
  let ownsBuildingPath = false;

  if (!fixtureSourceDir) {
    if (blockers.hasBlockers()) {
      finishStage(stageTimings, 'total_ms', totalStarted);
      return buildPipelineResult({
        mode,
        blockers,
        snapshotWatermark,
        built: null,
        prepared: null,
        stageTimings,
      });
    }

    const snapshot = await sourceExtractor({
      config,
      beforeFingerprint: precheck.processedFingerprint,
      acceptanceCases: sourceAcceptanceCases,
    });
    Object.assign(stageTimings, snapshot.stageTimings ?? {});

    if (snapshot.unstable) {
      for (const blocker of snapshot.blockers) blockers.add(blocker);
      finishStage(stageTimings, 'total_ms', totalStarted);
      return buildPipelineResult({
        mode,
        blockers,
        snapshotWatermark: snapshot.snapshotWatermark,
        built: null,
        prepared: null,
        stageTimings,
      });
    }

    snapshotWatermark = snapshot.snapshotWatermark;
    stockSyncUnix = snapshot.stockSyncUnix;
    sourceDir = snapshot.sourceDir;
    sourceAcceptance = snapshot.sourceAcceptance;
    buildingPath = snapshot.buildingPath;
    ownsBuildingPath = snapshot.ownsBuildingPath ?? false;
  } else {
    snapshotWatermark = 'fixture-watermark-123456789012345678';
    stockSyncUnix = 1700000000;
    buildingPath = resolveSpoolPaths(config.spoolRoot, snapshotWatermark).building;
    const fixtureAcceptanceStarted = startStage();
    const fixtureSourceCurrency = config.sourceCurrency ?? JSON.parse(
      fs.readFileSync(path.join(sourceDir, 'source-currency.json'), 'utf8')
    );
    sourceAcceptance = await collectFixtureSourceAcceptance(sourceDir, {
      provider: config.provider,
      sourceEpoch: config.sourceEpoch,
      snapshotWatermark,
      stockSyncUnix,
      producerInputs: {
        public_site_url: config.publicSiteUrl,
        public_files_url: config.publicFilesUrl,
        source_currency: fixtureSourceCurrency,
      },
    });
    finishStage(stageTimings, 'source_acceptance_ms', fixtureAcceptanceStarted);
  }

  const authorityConfigStarted = startStage();
  const collisionConfig = loadCollisionConfig(config.collisionConfigPath);
  const publicationPolicy = loadPublicationPolicy(config.anomalyPublicationPolicyPath);
  const mappings = parseCollisionMappings(collisionConfig);
  const { validMappings } = partitionCollisionMappings(mappings, blockers);
  finishStage(stageTimings, 'authority_config_ms', authorityConfigStarted);

  const canonicalBuildStarted = startStage();
  const built = await buildCanonicalRecords({
    sourceDir,
    config,
    stockSyncUnix,
    blockers,
  });
  finishStage(stageTimings, 'canonical_build_ms', canonicalBuildStarted);

  const collisionStageStarted = startStage();
  const collisionCollector = createSkuCollisionCollector(blockers);
  await streamCandidateProducts(built.candidatesPath, product => {
    collisionCollector.addProduct(product);
  });
  const collisionSnapshot = collisionCollector.snapshot();

  const exclusions = resolveCollisionExclusions({
    cross: collisionSnapshot.cross,
    within: collisionSnapshot.within,
    mappings: validMappings,
    blockers,
  });

  const collisionReport = buildCollisionReport({
    collisionSnapshot,
    mappings,
  });

  const postCollector = createSkuCollisionCollector(blockers);
  const postMappingProducts = [];
  await streamCandidateProducts(built.candidatesPath, product => {
    const filtered = filterProductByExclusions(product, exclusions, blockers);
    if (filtered) {
      postMappingProducts.push(filtered);
      postCollector.addProduct(filtered);
    }
  });
  const postCollisionSnapshot = postCollector.snapshot();

  const anomalyObservations = observationsFromCollisionSnapshot({
    snapshot: postCollisionSnapshot,
    provider: config.provider,
    sourceEpoch: config.sourceEpoch,
  });
  finishStage(stageTimings, 'collision_mapping_anomaly_ms', collisionStageStarted);

  const quarantineStarted = startStage();
  let quarantinedProductIds;
  try {
    quarantinedProductIds = deriveAnomalyQuarantine({
      observations: anomalyObservations,
      policy: publicationPolicy.policy,
    });
  } catch (error) {
    blockers.add(new Blocker(
      BLOCKER_CODES.COLLISION_MAPPING_UNSUPPORTED,
      error.message,
      { phase: 'anomaly_publication_policy' }
    ));
    quarantinedProductIds = new Set();
  }

  const publishableProducts = postMappingProducts.filter(product =>
    !quarantinedProductIds.has(product.native_product_id)
  );
  verifyPublishableSkuCollisions(publishableProducts, blockers);

  const anomalyReport = buildDrupalAnomalyReport({
    observations: anomalyObservations,
    provider: config.provider,
    sourceEpoch: config.sourceEpoch,
    snapshotWatermark,
    collisionConfigSha256: collisionConfig.sha256,
    anomalyPublicationPolicySha256: publicationPolicy.sha256,
  });

  const combinedExclusions = {
    excludedProducts: new Set([
      ...exclusions.excludedProducts,
      ...quarantinedProductIds,
    ]),
    excludedVariants: exclusions.excludedVariants,
    defaultPromotions: exclusions.defaultPromotions,
  };
  finishStage(stageTimings, 'quarantine_filter_ms', quarantineStarted);

  const filteredPath = path.join(path.dirname(built.candidatesPath), 'filtered.ndjson');
  const chunkPreparationStarted = startStage();
  const chunkResult = await prepareDiagnosticChunks({
    phase0: built.phase0,
    candidatesPath: built.candidatesPath,
    filteredPath,
    exclusions: combinedExclusions,
    blockers,
    mode,
    buildingPath,
  });
  const prepared = chunkResult?.prepared ?? null;
  const phase1Count = chunkResult?.phase1Count ?? 0;

  const authorityCounts = await countFilteredAuthorities(
    built.candidatesPath,
    combinedExclusions,
    blockers
  );
  finishStage(stageTimings, 'chunk_preparation_ms', chunkPreparationStarted);

  const acceptanceSerializeStarted = startStage();
  if (!sourceAcceptance) {
    throw new Error('source acceptance evidence is required');
  }
  const sourceAcceptanceBytes = `${JSON.stringify(sourceAcceptance, null, 2)}\n`;
  const sourceAcceptanceSha256 = crypto.createHash('sha256')
    .update(sourceAcceptanceBytes)
    .digest('hex');
  finishStage(stageTimings, 'acceptance_serialize_ms', acceptanceSerializeStarted);

  const preflightReport = {
    mode,
    provider: config.provider,
    source_epoch: config.sourceEpoch,
    snapshot_watermark: snapshotWatermark,
    producer_commit: releaseProvenance.document.commit,
    producer_release_provenance_sha256: releaseProvenance.sha256,
    source_acceptance_sha256: sourceAcceptanceSha256,
    disk_gate: diskGate.checks,
    collision_config_sha256: collisionConfig.sha256,
    anomaly_publication_policy_sha256: publicationPolicy.sha256,
    anomaly_count: anomalyReport.anomaly_count,
    quarantined_product_count: anomalyReport.quarantined_product_count,
    excluded_by_policy: built.excluded_by_policy,
    product_types: built.product_type_names,
    authority_counts: authorityCounts,
    prepared_chunk_count: prepared?.chunks.length ?? 0,
    source_currency: built.sourceCurrency ?? null,
    source_policy_diagnostics: built.sourcePolicyDiagnostics ?? null,
    ...(mode === 'preflight' ? { stage_timings_ms: stageTimings } : {}),
    ...blockers.toReport(),
  };

  if (blockers.hasBlockers() || mode === 'preflight') {
    const cleanupStarted = startStage();
    if (chunkResult?.scratchDir && fs.existsSync(chunkResult.scratchDir)) {
      fs.rmSync(chunkResult.scratchDir, { recursive: true, force: true });
    }
    if (buildingPath && fs.existsSync(buildingPath) && (ownsBuildingPath || fixtureSourceDir)) {
      fs.rmSync(buildingPath, { recursive: true, force: true });
    }
    finishStage(stageTimings, 'cleanup_ms', cleanupStarted);
    finishStage(stageTimings, 'total_ms', totalStarted);
    return buildPipelineResult({
      mode,
      blockers,
      snapshotWatermark,
      built,
      prepared,
      preflightReport,
      collisionReport,
      anomalyReport,
      candidatesPath: built.candidatesPath,
      filteredPath,
      stageTimings,
    });
  }

  const spoolResult = writePreparedSpool({
    config,
    snapshotWatermark,
    buildingPath,
    preflightReport,
    collisionReport,
    anomalyReport,
    sourceAcceptance,
    sourceAcceptanceBytes,
    sourceAcceptanceSha256,
    releaseProvenance,
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
    anomalyReport,
    snapshotWatermark,
    spool: spoolResult,
    blockers,
    prepared,
    candidatesPath: built.candidatesPath,
    filteredPath,
  };
}

async function countFilteredAuthorities(candidatesPath, exclusions, blockers) {
  let ru = 0;
  let uk = 0;
  await streamCandidateProducts(candidatesPath, product => {
    const filtered = filterProductByExclusions(product, exclusions, blockers);
    if (!filtered) return;
    if (filtered.authority?.language === 'ru') ru += 1;
    else if (filtered.authority?.language === 'uk') uk += 1;
  });
  return { ru, uk_fallback: uk };
}

export async function prepareDiagnosticChunks({
  phase0,
  candidatesPath,
  filteredPath,
  exclusions,
  blockers,
  mode,
  buildingPath,
}) {
  const scratch = mode === 'preflight';
  let diagnosticOutputDir = scratch
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'drupal-chunks-scratch-'))
    : buildingPath;

  if (fs.existsSync(filteredPath)) {
    fs.unlinkSync(filteredPath);
  }

  let phase1Count = 0;
  let writer = new IncrementalChunkWriter({
    outputDir: diagnosticOutputDir,
    scratch,
  });
  let phase0Succeeded = true;
  let abandonedWriterDir = null;
  let abandonedWriterFiles = null;

  try {
    writer.writePhase0Records(phase0);
  } catch (error) {
    phase0Succeeded = false;
    if (error instanceof Blocker) {
      blockers.add(error);
    } else {
      throw error;
    }
    abandonedWriterDir = diagnosticOutputDir;
    if (fs.existsSync(abandonedWriterDir)) {
      abandonedWriterFiles = fs.readdirSync(abandonedWriterDir);
    }
    writer.abandon();
    if (scratch) {
      if (fs.existsSync(abandonedWriterDir)) {
        fs.rmSync(abandonedWriterDir, { recursive: true, force: true });
      }
      diagnosticOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drupal-chunks-scratch-'));
    } else {
      purgeChunkArtifacts(buildingPath);
      diagnosticOutputDir = buildingPath;
    }
    writer = new IncrementalChunkWriter({
      outputDir: diagnosticOutputDir,
      scratch,
    });
  }

  await streamCandidateProducts(candidatesPath, product => {
    const filtered = filterProductByExclusions(product, exclusions, blockers);
    if (!filtered) return;

    const canonical = sanitizeProductForCanonical(filtered);
    const validation = validateSingleCanonicalRecord(canonical);
    if (!validation.ok) {
      const blocker = validation.blocker;
      if (!blocker.details.native_product_id && filtered.native_product_id) {
        blocker.details.native_product_id = filtered.native_product_id;
      }
      blockers.add(blocker);
      return;
    }

    phase1Count += 1;
    fs.appendFileSync(filteredPath, `${JSON.stringify(filtered)}\n`);
    writer.writePhase1Record(canonical);
  });

  try {
    const result = writer.finish();
    return {
      prepared: result,
      phase1Count,
      scratchDir: scratch ? diagnosticOutputDir : null,
      diagnosticOutputDir,
      phase0Succeeded,
      abandonedWriterDir,
      abandonedWriterFiles,
    };
  } catch (error) {
    writer.abandon();
    if (fs.existsSync(filteredPath)) fs.unlinkSync(filteredPath);
    if (error instanceof Blocker) {
      blockers.add(error);
      return {
        prepared: null,
        phase1Count: 0,
        scratchDir: scratch ? diagnosticOutputDir : null,
        diagnosticOutputDir,
        phase0Succeeded,
        abandonedWriterDir,
        abandonedWriterFiles,
      };
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
  anomalyReport,
  preflightReport,
  prepared,
  candidatesPath,
  filteredPath,
  stageTimings = {},
}) {
  return {
    ok: !blockers.hasBlockers(),
    mode,
    preflight: preflightReport ?? {
      mode,
      snapshot_watermark: snapshotWatermark,
      prepared_chunk_count: prepared?.chunks.length ?? 0,
      stage_timings_ms: stageTimings,
      ...blockers.toReport(),
    },
    collisionReport,
    anomalyReport,
    snapshotWatermark,
    blockers,
    phase0: built?.phase0 ?? [],
    prepared,
    candidatesPath,
    filteredPath,
  };
}

function buildCollisionReport({ collisionSnapshot, mappings }) {
  const entries = [];

  for (const collision of collisionSnapshot.cross) {
    for (const entry of collision.entries) {
      entries.push(buildCollisionReportEntry('cross_product', entry));
    }
  }
  for (const collision of collisionSnapshot.within) {
    for (const variant of collision.variants) {
      entries.push(buildCollisionReportEntry('within_product', variant));
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
  anomalyReport,
  sourceAcceptance,
  sourceAcceptanceBytes,
  sourceAcceptanceSha256,
  releaseProvenance,
  prepared,
  excludedByPolicy,
  authorityCounts,
  phase0Count,
  phase1Count,
}) {
  const { ready } = resolveSpoolPaths(config.spoolRoot, snapshotWatermark);
  const building = buildingPath ?? resolveSpoolPaths(config.spoolRoot, snapshotWatermark).building;

  writeJsonAtomic(building, 'anomaly-report.json', anomalyReport);
  const anomalyReportBytes = `${JSON.stringify(anomalyReport, null, 2)}\n`;
  const anomalyReportSha256 = crypto.createHash('sha256')
    .update(anomalyReportBytes)
    .digest('hex');

  if (sourceAcceptance.schema !== 'bp.drupal.source-acceptance/1') {
    throw new Error('unsupported source acceptance schema');
  }
  writeFileAtomic(building, 'source-acceptance.json', sourceAcceptanceBytes);

  const manifest = {
    schema: 'bp.drupal-exporter.spool/3',
    version: 3,
    provider: config.provider,
    source_epoch: config.sourceEpoch,
    snapshot_watermark: snapshotWatermark,
    producer_commit: releaseProvenance.document.commit,
    producer_release_provenance_sha256: releaseProvenance.sha256,
    source_acceptance_sha256: sourceAcceptanceSha256,
    collision_config_sha256: preflightReport.collision_config_sha256,
    anomaly_publication_policy_sha256: preflightReport.anomaly_publication_policy_sha256,
    anomaly_report_sha256: anomalyReportSha256,
    anomaly_count: preflightReport.anomaly_count,
    quarantined_product_count: preflightReport.quarantined_product_count,
    authority_counts: authorityCounts,
    excluded_by_policy: excludedByPolicy,
    blocker_count: 0,
    warning_count: preflightReport.warning_count ?? 0,
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

  atomicPromote(building, ready);

  return {
    ready_path: ready,
    manifest,
  };
}
