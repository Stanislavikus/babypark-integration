import crypto from 'node:crypto';
import { frameUtf8 } from './framing.mjs';
import { CATALOG_SCHEMA_VERSION } from '../sqlite/schema.mjs';
import { IDENTITY_SCHEMA_VERSION } from '../identity/schema.mjs';
import { FULL_RECORD_CONTRACT_VERSION, RECORD_VALIDATOR_VERSION } from './full-record-v2.mjs';
import { PRODUCTION_MAPPER_VERSION } from './production-full-mapper.mjs';
export const FTS_BUILDER_VERSION=1;
export const SKU_NORMALIZER_VERSION=1;
export const PRODUCTION_DEPENDENCY_FINGERPRINT_VERSION=2;
const hashParts=(domain,parts)=>{const h=crypto.createHash('sha256').update(domain);for(const p of parts)h.update(frameUtf8(String(p)));return h.digest('hex');};
export function identityConfigStateSha256(identityStore){const rows=identityStore.db.prepare('SELECT config_key,sha256 FROM config_state ORDER BY config_key').all();return hashParts('BP-IDENTITY-CONFIG-STATE-V1\0',[rows.length,...rows.flatMap(r=>[r.config_key,r.sha256])]);}
export function identityStoreStateSha256(identityStore){
  const stores=identityStore.db.prepare('SELECT store_id,lifecycle FROM stores ORDER BY store_id').all();
  const xrefs=identityStore.db.prepare('SELECT provider,native_store_id,store_id,reviewed_source FROM source_stores ORDER BY provider,native_store_id').all();
  return hashParts('BP-IDENTITY-STORE-STATE-V1\0',[
    stores.length,...stores.flatMap(r=>[r.store_id,r.lifecycle]),
    xrefs.length,...xrefs.flatMap(r=>[r.provider,r.native_store_id,r.store_id,r.reviewed_source]),
  ]);
}
export function productionDependencyFingerprint(identityStore,overrides={}){
  const values={catalog_schema_version:CATALOG_SCHEMA_VERSION,full_record_contract_version:FULL_RECORD_CONTRACT_VERSION,record_validator_version:RECORD_VALIDATOR_VERSION,production_mapper_version:PRODUCTION_MAPPER_VERSION,fts_builder_version:FTS_BUILDER_VERSION,sku_normalizer_version:SKU_NORMALIZER_VERSION,identity_schema_version:IDENTITY_SCHEMA_VERSION,identity_config_state_sha256:identityConfigStateSha256(identityStore),store_identity_state_sha256:identityStoreStateSha256(identityStore),...overrides};
  const names=['catalog_schema_version','full_record_contract_version','record_validator_version','production_mapper_version','fts_builder_version','sku_normalizer_version','identity_schema_version','identity_config_state_sha256','store_identity_state_sha256'];
  return hashParts(`BP-CATALOG-DEPENDENCY-V${PRODUCTION_DEPENDENCY_FINGERPRINT_VERSION}\0`,names.flatMap(n=>[n,values[n]]));
}
