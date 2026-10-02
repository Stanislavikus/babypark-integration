import { IdentityStore } from './store.mjs';
import {
  readVerifiedChunk,
  verifyFrozenSpoolArtifact,
} from '../../drupal-d2b/spool.mjs';

export const STORE_BOOTSTRAP_PLAN_SCHEMA =
  'bp.catalog.store-bootstrap-plan/1';

export class StoreBootstrapPlanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StoreBootstrapPlanError';
    this.code = code;
    this.details = details;
  }
}

const sourceKey = (provider, nativeStoreId) =>
  `${provider}\0${nativeStoreId}`;

function blocker(code, details = {}) {
  return { code, ...details };
}
function collectSourceEvidence(spool) {
  const stores = new Map();
  const stockRefs = new Map();
  const blockers = [];

  for (const chunk of spool.chunks) {
    const parsed = JSON.parse(readVerifiedChunk(spool, chunk).toString('utf8'));
    for (const row of parsed.rows) {
      if (row.provider !== spool.manifest.provider) {
        blockers.push(blocker('STORE_PROVIDER_MISMATCH', {
          row_type: row.type,
          row_provider: row.provider,
          manifest_provider: spool.manifest.provider,
        }));
        continue;
      }

      if (row.type === 'store') {
        const key = sourceKey(row.provider, row.native_store_id);
        if (stores.has(key)) {
          blockers.push(blocker('DUPLICATE_SOURCE_STORE', {
            provider: row.provider,
            native_store_id: row.native_store_id,
          }));
          continue;
        }
        stores.set(key, {
          provider: row.provider,
          native_store_id: row.native_store_id,
          source_name: row.name,
          source_active: row.active,
        });
        continue;
      }

      if (row.type !== 'product') continue;
      for (const variant of row.variants) {
        for (const stock of variant.stock) {
          const key = sourceKey(row.provider, stock.store_native_id);
          const current = stockRefs.get(key) ?? {
            provider: row.provider,
            native_store_id: stock.store_native_id,
            reference_count: 0,
          };
          current.reference_count += 1;
          stockRefs.set(key, current);
        }
      }
    }
  }

  for (const [key, ref] of stockRefs) {
    if (!stores.has(key)) {
      blockers.push(blocker('STOCK_STORE_RECORD_MISSING', ref));
    }
  }
  return { stores, stockRefs, blockers };
}
function attachIdentityState(source, identityStore, blockers) {
  const rows = [];
  const byCanonical = new Map();

  for (const item of source.stores.values()) {
    const mapping = identityStore.lookupStoreBySource({
      provider: item.provider,
      nativeStoreId: item.native_store_id,
    });

    let mappingStatus = 'UNMAPPED';
    let storeId = null;
    let reviewedSource = null;

    if (!mapping) {
      blockers.push(blocker('STORE_XREF_MISSING', {
        provider: item.provider,
        native_store_id: item.native_store_id,
      }));
    } else {
      storeId = mapping.store_id;
      reviewedSource = mapping.reviewed_source;
      if (mapping.lifecycle === 'active') {
        mappingStatus = 'MAPPED_ACTIVE';
      } else {
        mappingStatus = 'MAPPED_INACTIVE';
        blockers.push(blocker('STORE_XREF_INACTIVE', {
          provider: item.provider,
          native_store_id: item.native_store_id,
          store_id: mapping.store_id,
          lifecycle: mapping.lifecycle,
        }));
      }
    }
    const row = {
      ...item,
      referenced_by_stock: source.stockRefs.has(
        sourceKey(item.provider, item.native_store_id)
      ),
      stock_reference_count: source.stockRefs.get(
        sourceKey(item.provider, item.native_store_id)
      )?.reference_count ?? 0,
      mapping_status: mappingStatus,
      store_id: storeId,
      reviewed_source: reviewedSource,
    };
    rows.push(row);

    if (mappingStatus === 'MAPPED_ACTIVE') {
      const current = byCanonical.get(storeId) ?? [];
      current.push({
        provider: item.provider,
        native_store_id: item.native_store_id,
      });
      byCanonical.set(storeId, current);
    }
  }

  for (const [storeId, claims] of byCanonical) {
    if (claims.length < 2) continue;
    blockers.push(blocker('CANONICAL_STORE_COLLISION', {
      store_id: storeId,
      source_stores: claims,
    }));
  }

  return rows;
}
function discoveryRows(source) {
  return [...source.stores.values()].map(item => ({
    ...item,
    referenced_by_stock: source.stockRefs.has(
      sourceKey(item.provider, item.native_store_id)
    ),
    stock_reference_count: source.stockRefs.get(
      sourceKey(item.provider, item.native_store_id)
    )?.reference_count ?? 0,
    mapping_status: 'NOT_CHECKED',
    store_id: null,
    reviewed_source: null,
  }));
}

function stableRows(rows) {
  return rows.sort((a, b) =>
    a.provider.localeCompare(b.provider) ||
    a.native_store_id.localeCompare(b.native_store_id)
  );
}

function counts(rows, blockers, stockRefs) {
  return {
    source_stores: rows.length,
    stock_store_refs: stockRefs.size,
    mapped_active: rows.filter(x => x.mapping_status === 'MAPPED_ACTIVE').length,
    mapped_inactive: rows.filter(x => x.mapping_status === 'MAPPED_INACTIVE').length,
    unmapped: rows.filter(x => x.mapping_status === 'UNMAPPED').length,
    blockers: blockers.length,
  };
}
export function buildStoreBootstrapPlan({
  spoolPath,
  identityPath = null,
  expectedSpoolSha256 = null,
} = {}) {
  if (typeof spoolPath !== 'string' || spoolPath === '') {
    throw new StoreBootstrapPlanError(
      'STORE_BOOTSTRAP_INPUT_INVALID',
      'spoolPath is required'
    );
  }

  const spool = verifyFrozenSpoolArtifact(spoolPath);
  if (
    expectedSpoolSha256 !== null &&
    (
      typeof expectedSpoolSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(expectedSpoolSha256) ||
      spool.spoolManifestSha256 !== expectedSpoolSha256
    )
  ) {
    throw new StoreBootstrapPlanError(
      'STORE_BOOTSTRAP_SPOOL_AUTHORITY_MISMATCH',
      'Frozen spool manifest does not match expected authority',
      {
        expected_spool_manifest_sha256: expectedSpoolSha256,
        actual_spool_manifest_sha256: spool.spoolManifestSha256,
      }
    );
  }
  const source = collectSourceEvidence(spool);
  const blockers = [...source.blockers];

  let identity = null;
  let rows;

  if (identityPath === null) {
    rows = discoveryRows(source);
  } else {
    const store = IdentityStore.openExisting(identityPath, { readOnly: true });
    try {
      const before = store.metadata();
      rows = attachIdentityState(source, store, blockers);
      const after = store.metadata();
      if (after.revision !== before.revision) {
        throw new StoreBootstrapPlanError(
          'STORE_BOOTSTRAP_IDENTITY_MOVED',
          'IdentityStore changed during bootstrap planning',
          { before_revision: before.revision, after_revision: after.revision }
        );
      }
      identity = {
        schema_version: before.schema_version,
        revision: before.revision,
      };
    } finally {
      store.close();
    }
  }
  const post = verifyFrozenSpoolArtifact(spoolPath);
  if (post.spoolManifestSha256 !== spool.spoolManifestSha256) {
    throw new StoreBootstrapPlanError(
      'STORE_BOOTSTRAP_SPOOL_MOVED',
      'Frozen spool changed during bootstrap planning'
    );
  }

  rows = stableRows(rows);
  const status = blockers.length
    ? 'BLOCKED'
    : identityPath === null
      ? 'REVIEW_REQUIRED'
      : 'READY';

  return Object.freeze({
    schema: STORE_BOOTSTRAP_PLAN_SCHEMA,
    status,
    provider: spool.manifest.provider,
    source_epoch: spool.manifest.source_epoch,
    snapshot_watermark: spool.manifest.snapshot_watermark,
    spool_manifest_sha256: spool.spoolManifestSha256,
    evidence_ref: `${spool.manifest.provider}-spool:${spool.spoolManifestSha256}`,
    identity,
    counts: counts(rows, blockers, source.stockRefs),
    stores: rows,
    blockers,
  });
}
