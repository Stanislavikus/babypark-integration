import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validateAnomalyReport } from '../anomaly/report.mjs';
import { normalizeSku } from '../domain/sku.mjs';
import { normalizeTitleKey } from '../domain/title.mjs';
import { IdentityStore } from '../identity/store.mjs';
import { resolveCanonicalStore } from '../identity/store-resolution.mjs';
import { decodeFullChunkForApply } from '../ingest/full-apply.mjs';
import { FULL_RECORD_CONTRACT_VERSION, RECORD_VALIDATOR_VERSION, validateFullRecords } from '../ingest/full-record-v2.mjs';
import { frameUtf8 } from '../ingest/framing.mjs';
import { SKU_NORMALIZER_VERSION } from '../ingest/dependency-fingerprint.mjs';
import { DRUPAL_SPOOL_SCHEMA, NATIVE_IDENTITY_SCHEME, REQUIRED_CONFIG_KEYS } from '../ingest/publication-authority.mjs';
import { withExactCatalogGeneration } from '../sqlite/generation.mjs';
import { readVerifiedChunk, verifyFrozenSpoolArtifact } from '../../drupal-d2b/spool.mjs';

export const LINK_A_REPORT_SCHEMA = 'bp.catalog.link-a-report/1';
export const LINK_A_VERIFIER_VERSION = 3;
export const MAX_MISMATCH_DETAILS = 200;
export const MAX_MISMATCH_DETAIL_BYTES = 4096;
export const MAX_MISMATCH_DETAILS_BYTES = 256 * 1024;
export const FTS_PROBE_LIMITS = Object.freeze({ exact_sku: 16, text: 16, category: 16 });
export const LINK_A_TABLES = Object.freeze(['brands','categories','stores','attribute_defs','products','product_text','variants','variant_offers','store_stock','product_categories','product_attributes','images','kit_components']);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
export const canonicalLinkAJson = value => JSON.stringify(sorted(value));
function digest(domain, ...values) { const h = crypto.createHash('sha256').update(domain); for (const value of values) h.update(frameUtf8(value)); return h.digest('hex').slice(0, 32); }
export function linkADimensionId(type, provider, nativeId) { const prefix = { brand:'brand_',category:'cat_',attribute_definition:'attr_' }[type]; if (!prefix) throw new TypeError('invalid dimension type'); return prefix + digest('BP-CATALOG-DIMENSION-V1\0', type, provider, nativeId); }
export function linkAImageId(provider, product, image) { return 'img_' + digest('BP-CATALOG-IMAGE-V1\0', provider, product, image); }
const provenance = (provider, nativeId, data) => canonicalLinkAJson({ source:{ provider, native_id:nativeId }, provider_data:data ?? {} });
const imageProvenance = (provider, product, image, data) => canonicalLinkAJson({ source:{ provider, native_product_id:product, native_image_id:image }, provider_data:data ?? {} });
const kitProvenance = record => canonicalLinkAJson({ source:{ provider:record.provider, kit_native_product_id:record.kit_native_product_id, component_native_variant_id:record.component_native_variant_id }, provider_data:record.metadata ?? {} });
export function sha256FileBounded(file, { bufferBytes = 1024 * 1024, read = fs.readSync } = {}) {
  if (!Number.isSafeInteger(bufferBytes) || bufferBytes < 4096 || bufferBytes > 4 * 1024 * 1024) throw new TypeError('bufferBytes is out of range');
  const hash = crypto.createHash('sha256'); const buffer = Buffer.allocUnsafe(bufferBytes); const fd = fs.openSync(file, 'r');
  try { let count; while ((count = read(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function fileEvidence(file) { const stat = fs.statSync(file); return { size:stat.size, mode:stat.mode, mtime_ms:stat.mtimeMs, ctime_ms:stat.ctimeMs, sha256:sha256FileBounded(file) }; }
function same(a,b) { return canonicalLinkAJson(a) === canonicalLinkAJson(b); }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function readFd(fd) { const chunks=[]; const buffer=Buffer.allocUnsafe(256); let position=0,count; while((count=fs.readSync(fd,buffer,0,buffer.length,position))>0){chunks.push(Buffer.from(buffer.subarray(0,count)));position+=count;if(position>256)fail('LINK_A_CURRENT_MOVED','CURRENT pointer is unexpectedly large');} return Buffer.concat(chunks); }
export function openCurrentPointerGuard(catalogStorageDir, expectedGenerationId) {
  const pointer=path.join(path.resolve(catalogStorageDir),'CURRENT'); const before=fs.lstatSync(pointer);
  if(before.isSymbolicLink()||!before.isFile()||before.size>256)fail('LINK_A_CURRENT_MOVED','CURRENT is unsafe');
  const fd=fs.openSync(pointer,'r'); const admitted=fs.fstatSync(fd); let bytes;try{bytes=readFd(fd);}catch(error){fs.closeSync(fd);throw error;}
  if(bytes.toString('utf8').trim()!==`catalog.${expectedGenerationId}.sqlite`) { fs.closeSync(fd); fail('LINK_A_CURRENT_MOVED','CURRENT is not the expected generation'); }
  return { assert(){const pathname=fs.lstatSync(pointer),held=fs.fstatSync(fd);if(pathname.isSymbolicLink()||!pathname.isFile()||pathname.size>256||pathname.dev!==admitted.dev||pathname.ino!==admitted.ino||held.dev!==admitted.dev||held.ino!==admitted.ino||!readFd(fd).equals(bytes)||!fs.readFileSync(pointer).equals(bytes))fail('LINK_A_CURRENT_MOVED','CURRENT moved during verification');},close(){fs.closeSync(fd);},bytes:Buffer.from(bytes)};
}
function atomicReport(file, report) { const directory=path.dirname(file); const temp=`${file}.tmp.${process.pid}`; if(fs.existsSync(temp))fail('LINK_A_WORK_PATH_UNSAFE','Report temporary file already exists'); const fd=fs.openSync(temp,'wx',0o600); try { fs.writeFileSync(fd,`${canonicalLinkAJson(report)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } if(fs.existsSync(file)){const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile())fail('LINK_A_WORK_PATH_UNSAFE','Existing report is unsafe');} fs.renameSync(temp,file); const d=fs.openSync(directory,'r'); try{fs.fsyncSync(d);}finally{fs.closeSync(d);} }
function reservoirAdd(list, kind, stable, probe) { const score=sha256(`${kind}\0${stable}`); const cap=FTS_PROBE_LIMITS[kind]; list.push({score,...probe}); list.sort((a,b)=>a.score.localeCompare(b.score)); if(list.length>cap)list.pop(); }

function validateWorkRoot(workRoot, catalogStorageDir, identityPath, stagedSpoolPath) {
  if (!path.isAbsolute(workRoot)) fail('LINK_A_WORK_ROOT_INVALID','Link A working root must be absolute');
  const resolvedRoot=path.resolve(workRoot);let root,catalog,identity,staged,identityAuthority;
  try { root=fs.realpathSync(resolvedRoot);catalog=fs.realpathSync(path.resolve(catalogStorageDir));identity=fs.realpathSync(path.resolve(identityPath));staged=fs.realpathSync(path.resolve(stagedSpoolPath));identityAuthority=fs.realpathSync(path.dirname(path.resolve(identityPath))); }
  catch { fail('LINK_A_WORK_ROOT_INVALID','Link A paths must already exist'); }
  if(root!==resolvedRoot)fail('LINK_A_WORK_ROOT_INVALID','Symlinked Link A working paths are forbidden');
  const stat=fs.lstatSync(root); if(stat.isSymbolicLink()||!stat.isDirectory()||(stat.mode&0o777)!==0o700)fail('LINK_A_WORK_ROOT_INVALID','Link A working root must be a non-symlink mode-0700 directory');
  const inside=(candidate,parent)=>candidate===parent||candidate.startsWith(`${parent}${path.sep}`);
  if(inside(root,catalog)||inside(root,staged)||root===identity||root===identityAuthority)fail('LINK_A_WORK_ROOT_AUTHORITY','Link A working root overlaps an authority or frozen artifact');
  return root;
}

function validateAcceptedRun(value, chunkCount) {
  const keys=value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort():[];
  if(keys.join('\0')!=='final_seq\0run_digest\0run_id'||!/^[A-Za-z0-9_-]{1,64}$/.test(value?.run_id??'')||!/^[a-f0-9]{64}$/.test(value?.run_digest??'')||!Number.isSafeInteger(value?.final_seq)||value.final_seq<1||value.final_seq!==chunkCount+1)fail('LINK_A_ACCEPTED_RUN_INPUT_INVALID','acceptedRun must exactly bind the staged spool sequence');
  return {run_id:value.run_id,run_digest:value.run_digest,final_seq:value.final_seq};
}
function boundedMismatchValue(value) { if(value===undefined)return {value:null,truncated:false}; let encoded;try{encoded=canonicalLinkAJson(value);}catch{encoded=String(value);}if(Buffer.byteLength(encoded)<=1536)return {value,truncated:false};return {value:`${encoded.slice(0,1536)}…[truncated]`,truncated:true}; }

export function verifyLinkA({ stagedSpoolPath, workRoot, catalogStorageDir, identityPath, expectedGenerationId, acceptedRun, now = () => new Date() }) {
  const workingDirectory=validateWorkRoot(workRoot,catalogStorageDir,identityPath,stagedSpoolPath);
  const reportPath=path.join(workingDirectory,'link-a-report.json');
  const started=now(); const cpu=process.cpuUsage(); const usage=process.resourceUsage(); let mismatches=0,mismatchBytes=0,mismatchTruncated=false; const details=[];
  const mismatch=(code,table,key,expected,actual)=>{ mismatches++; if(details.length>=MAX_MISMATCH_DETAILS){mismatchTruncated=true;return;}const boundedExpected=boundedMismatchValue(expected),boundedActual=boundedMismatchValue(actual);if(boundedExpected.truncated||boundedActual.truncated)mismatchTruncated=true;const detail={code,table,key,expected:boundedExpected.value,actual:boundedActual.value};const bytes=Buffer.byteLength(canonicalLinkAJson(detail));if(bytes>MAX_MISMATCH_DETAIL_BYTES||mismatchBytes+bytes>MAX_MISMATCH_DETAILS_BYTES){mismatchTruncated=true;return;}details.push(detail);mismatchBytes+=bytes; };
  let spool; let generationMeta={ generation_id:expectedGenerationId, generation_manifest_sha256:null, identity_revision:null }; let publicationAuthoritySha=null;
  const sourceCounts={}; const expectedCounts={}; const actualCounts={}; const probes={exact_sku:[],text:[],category:[]}; let quarantineCount=0; let quarantineLeaks=0; let ftsComplete=false,currentGuard,acceptedEvidence;
  try {
    spool=verifyFrozenSpoolArtifact(stagedSpoolPath); validateAnomalyReport(spool.anomalyReport);
    acceptedEvidence=validateAcceptedRun(acceptedRun,spool.chunks.length);
    currentGuard=openCurrentPointerGuard(catalogStorageDir,expectedGenerationId);
    const generationFile=path.join(catalogStorageDir,`catalog.${expectedGenerationId}.sqlite`); const beforeGeneration=fileEvidence(generationFile); const beforeIdentity=fileEvidence(identityPath); const beforePointer=fs.readFileSync(path.join(catalogStorageDir,'CURRENT'));
    const identity=IdentityStore.openExisting(identityPath,{readOnly:true});
    try {
      withExactCatalogGeneration(catalogStorageDir,expectedGenerationId,(db,metadata)=>{
        generationMeta={generation_id:expectedGenerationId,generation_manifest_sha256:metadata.manifest_sha256,identity_revision:metadata.identity_revision};
        const liveIdentityRevision=identity.metadata().revision;
        if(liveIdentityRevision!==metadata.identity_revision){mismatch('LINK_A_IDENTITY_REVISION_MISMATCH','identity_meta','revision',metadata.identity_revision,liveIdentityRevision);return;}
        const manifest=JSON.parse(db.prepare('SELECT manifest_json FROM catalog_meta WHERE singleton=1').get().manifest_json); const authority=manifest.extra?.publication_authority;
        const authorityKeys=['anomaly_report_sha256','config_digests','full_record_contract_version','native_identity_scheme','producer_commit','producer_release_provenance_sha256','record_validator_version','schema','sku_normalizer_version','spool_manifest_sha256','spool_schema'];
        if(!authority||Object.keys(authority).sort().join('\0')!==authorityKeys.sort().join('\0'))mismatch('LINK_A_PUBLICATION_AUTHORITY','catalog_meta','keys',authorityKeys,Object.keys(authority??{}).sort());
        if(authority?.schema!=='bp.catalog.publication-authority/1') mismatch('LINK_A_PUBLICATION_AUTHORITY','catalog_meta','schema','bp.catalog.publication-authority/1',authority?.schema);
        publicationAuthoritySha=authority ? sha256(canonicalLinkAJson(authority)) : null;
        const authorityExpected={spool_schema:DRUPAL_SPOOL_SCHEMA,spool_manifest_sha256:spool.spoolManifestSha256,anomaly_report_sha256:spool.manifest.anomaly_report_sha256,producer_commit:spool.manifest.producer_commit,producer_release_provenance_sha256:spool.manifest.producer_release_provenance_sha256,full_record_contract_version:FULL_RECORD_CONTRACT_VERSION,record_validator_version:RECORD_VALIDATOR_VERSION,sku_normalizer_version:SKU_NORMALIZER_VERSION,native_identity_scheme:NATIVE_IDENTITY_SCHEME};
        for(const [name,expected] of Object.entries(authorityExpected))if(authority?.[name]!==expected)mismatch('LINK_A_AUTHORITY_MISMATCH','catalog_meta',name,expected,authority?.[name]);
        const configExpected={'drupal-collisions':spool.manifest.collision_config_sha256,'drupal-anomaly-publication-policy':spool.manifest.anomaly_publication_policy_sha256};
        if(!authority?.config_digests||Object.keys(authority.config_digests).sort().join('\0')!==[...REQUIRED_CONFIG_KEYS].sort().join('\0'))mismatch('LINK_A_AUTHORITY_MISMATCH','catalog_meta','config_digests.keys',Object.keys(configExpected).sort(),Object.keys(authority?.config_digests??{}).sort());
        for(const [name,expected] of Object.entries(configExpected))if(authority?.config_digests?.[name]!==expected)mismatch('LINK_A_AUTHORITY_MISMATCH','catalog_meta',`config_digests.${name}`,expected,authority?.config_digests?.[name]);
        for(const [name,expected] of Object.entries({provider:spool.manifest.provider,source_epoch:spool.manifest.source_epoch,snapshot_watermark:spool.manifest.snapshot_watermark,collision_config_sha256:spool.manifest.collision_config_sha256,anomaly_publication_policy_sha256:spool.manifest.anomaly_publication_policy_sha256}))if(spool.anomalyReport[name]!==expected)mismatch('LINK_A_ANOMALY_CROSSLINK','anomaly-report',name,expected,spool.anomalyReport[name]);
        if(manifest.source_epoch!==spool.manifest.source_epoch)mismatch('LINK_A_SOURCE_EPOCH','catalog_meta','source_epoch',spool.manifest.source_epoch,manifest.source_epoch);
        const run=db.prepare('SELECT * FROM ingest_runs WHERE run_id=?').get(acceptedEvidence.run_id);
        for(const [field,want] of Object.entries(acceptedEvidence))if(run?.[field]!==want)mismatch('LINK_A_ACCEPTED_RUN','ingest_runs',field,want,run?.[field]);
        for(const [field,want] of [['layer','full'],['status','ACCEPTED'],['run_kind','full'],['source_watermark',null]])if(run?.[field]!==want)mismatch('LINK_A_ACCEPTED_RUN','ingest_runs',field,want,run?.[field]);
        for(const layer of ['taxonomy','content','commercial','stock']){const row=db.prepare('SELECT accepted_watermark FROM sync_state WHERE layer=?').get(layer);if(row?.accepted_watermark!==spool.manifest.snapshot_watermark)mismatch('LINK_A_WATERMARK','sync_state',layer,spool.manifest.snapshot_watermark,row?.accepted_watermark);}
        const workPath=path.join(workingDirectory,'link-a-work.sqlite'); if(fs.existsSync(workPath)){const stat=fs.lstatSync(workPath);if(stat.isSymbolicLink()||!stat.isFile())fail('LINK_A_WORK_PATH_UNSAFE','Existing work DB is unsafe');fs.unlinkSync(workPath);} const workFd=fs.openSync(workPath,'wx',0o600);fs.closeSync(workFd);const work=new DatabaseSync(workPath,{create:false});
        try {
          work.exec('PRAGMA journal_mode=DELETE; CREATE TABLE expected(table_name TEXT,key_json TEXT,PRIMARY KEY(table_name,key_json)); CREATE TABLE source_products(provider TEXT,native_id TEXT,PRIMARY KEY(provider,native_id)); CREATE TABLE quarantine(provider TEXT,native_id TEXT,PRIMARY KEY(provider,native_id)); CREATE TABLE source_dimensions(type TEXT,provider TEXT,native_id TEXT,value_json TEXT NOT NULL,PRIMARY KEY(type,provider,native_id));');
          const add=(table,key,row)=>{ const keyJson=canonicalLinkAJson(key); const inserted=work.prepare('INSERT OR IGNORE INTO expected VALUES(?,?)').run(table,keyJson).changes; if(!inserted){mismatch('LINK_A_DUPLICATE_EXPECTED',table,keyJson,row,null);return;} const clauses=Object.keys(key).map(k=>`${k}=?`).join(' AND '); const actual=db.prepare(`SELECT * FROM ${table} WHERE ${clauses}`).get(...Object.values(key)); if(!same(actual,row))mismatch('LINK_A_ROW_MISMATCH',table,keyJson,row,actual??null); };
          const resolveStore=(provider,nativeId)=>{try{return resolveCanonicalStore(identity,{provider,nativeStoreId:nativeId}).store_id;}catch(error){mismatch('LINK_A_STORE_IDENTITY_UNRESOLVED','identity',`${provider}:${nativeId}`,'active reviewed canonical store xref',error.code??error.message);return null;}};
          for(const anomaly of spool.anomalyReport.anomalies)for(const nativeId of anomaly.isolation.affected_native_product_ids){work.prepare('INSERT OR IGNORE INTO quarantine VALUES(?,?)').run(spool.anomalyReport.provider,nativeId);}
          quarantineCount=Number(work.prepare('SELECT count(*) n FROM quarantine').get().n);
          for(const chunk of spool.chunks){currentGuard.assert();const body=readVerifiedChunk(spool,chunk);const records=decodeFullChunkForApply({layer:'full',final:false,contentEncoding:'identity',bodySha256:chunk.sha256,seq:1,runId:'link-a'},body).rows;validateFullRecords(records);
            for(const r of records){sourceCounts[`${r.phase}:${r.type}`]=(sourceCounts[`${r.phase}:${r.type}`]??0)+1;
              if(r.type==='brand'){const id=linkADimensionId('brand',r.provider,r.native_brand_id);work.prepare('INSERT OR IGNORE INTO source_dimensions VALUES(?,?,?,?)').run('brand',r.provider,r.native_brand_id,canonicalLinkAJson(r.name));add('brands',{brand_id:id},{brand_id:id,name:r.name,provenance_json:provenance(r.provider,r.native_brand_id,r.provenance)});}
              else if(r.type==='store'){const id=resolveStore(r.provider,r.native_store_id);if(id)add('stores',{store_id:id},{store_id:id,name:r.name,active:+r.active,metadata_json:provenance(r.provider,r.native_store_id,r.metadata)});}
              else if(r.type==='category'){const id=linkADimensionId('category',r.provider,r.native_category_id);work.prepare('INSERT OR IGNORE INTO source_dimensions VALUES(?,?,?,?)').run('category',r.provider,r.native_category_id,canonicalLinkAJson(r.localized_names));add('categories',{category_id:id},{category_id:id,parent_id:r.parent_native_category_id?linkADimensionId('category',r.provider,r.parent_native_category_id):null,name_json:canonicalLinkAJson(r.localized_names),provenance_json:provenance(r.provider,r.native_category_id,r.provenance)});}
              else if(r.type==='attribute_definition'){const id=linkADimensionId('attribute_definition',r.provider,r.native_attribute_id);add('attribute_defs',{attribute_id:id},{attribute_id:id,code:r.code,type:r.value_type,label_json:canonicalLinkAJson(r.localized_labels),provenance_json:provenance(r.provider,r.native_attribute_id,r.provenance)});}
              else if(r.type==='product'){
                work.prepare('INSERT OR IGNORE INTO source_products VALUES(?,?)').run(r.provider,r.native_product_id);if(work.prepare('SELECT 1 FROM quarantine WHERE provider=? AND native_id=?').get(r.provider,r.native_product_id))mismatch('LINK_A_QUARANTINE_EMITTED','products',`${r.provider}:${r.native_product_id}`,null,'emitted');
                const p=identity.lookupProductBySource({provider:r.provider,nativeProductId:r.native_product_id});if(!p){mismatch('LINK_A_IDENTITY_MISSING','products',r.native_product_id,'xref',null);continue;}const variants=new Map();for(const v of r.variants){const x=identity.lookupVariantBySource({provider:r.provider,nativeVariantId:v.native_variant_id});if(!x)mismatch('LINK_A_IDENTITY_MISSING','variants',v.native_variant_id,'xref',null);else variants.set(v.native_variant_id,x.variant_id);}
                const def=r.variants.find(v=>v.is_default);add('products',{product_id:p.product_id},{product_id:p.product_id,kind:r.kind,product_type:r.product_type??null,brand_id:r.brand_native_id?linkADimensionId('brand',r.provider,r.brand_native_id):null,default_variant_id:variants.get(def.native_variant_id),lifecycle:'active',provenance_json:provenance(r.provider,r.native_product_id,r.provenance),updated_at:r.updated_at});
                for(const [language,t] of Object.entries(r.localized)){add('product_text',{product_id:p.product_id,language},{product_id:p.product_id,language,title:t.title,title_key:normalizeTitleKey(t.title),short_description:t.short_description??null,description:t.description??null,url:t.url??null});if(t.title)reservoirAdd(probes.text,'text',`${r.provider}:${r.native_product_id}:${language}:title`,{query:t.title,product_id:p.product_id,source:'title'});const brandRow=r.brand_native_id?work.prepare("SELECT value_json FROM source_dimensions WHERE type='brand' AND provider=? AND native_id=?").get(r.provider,r.brand_native_id):null;if(brandRow)reservoirAdd(probes.text,'text',`${r.provider}:${r.native_product_id}:${language}:brand`,{query:JSON.parse(brandRow.value_json),product_id:p.product_id,source:'brand'});}
                for(const v of r.variants){const variant_id=variants.get(v.native_variant_id);if(!variant_id)continue;const n=normalizeSku(v.sku);add('variants',{variant_id},{variant_id,product_id:p.product_id,sku:v.sku,sku_key:n.sku_key,gtin:v.gtin??null,is_default:+v.is_default,commercial_availability:v.commercial_availability,options_json:canonicalLinkAJson(v.options??{}),lifecycle:'active',updated_at:v.updated_at});reservoirAdd(probes.exact_sku,'exact_sku',`${r.provider}:${v.native_variant_id}`,{query:v.sku,product_id:p.product_id});
                  if(v.offer)add('variant_offers',{variant_id},{variant_id,current_minor:v.offer.current_minor,regular_minor:v.offer.regular_minor??null,currency:v.offer.currency,on_sale:+v.offer.on_sale,tax_included:v.offer.tax_included==null?null:+v.offer.tax_included,valid_from:v.offer.valid_from??null,valid_to:v.offer.valid_to??null,source_updated_at:v.offer.source_updated_at??null});else if(db.prepare('SELECT 1 FROM variant_offers WHERE variant_id=?').get(variant_id))mismatch('LINK_A_UNEXPECTED_OFFER','variant_offers',variant_id,null,'present');
                  for(const s of v.stock){const store_id=resolveStore(r.provider,s.store_native_id);if(store_id)add('store_stock',{variant_id,store_id},{variant_id,store_id,quantity:s.quantity,source_updated_at:s.source_updated_at??null});}for(const a of v.attributes){const attribute_id=linkADimensionId('attribute_definition',r.provider,a.native_attribute_id);add('product_attributes',{owner_type:'VARIANT',owner_id:variant_id,attribute_id},{owner_type:'VARIANT',owner_id:variant_id,attribute_id,value_json:canonicalLinkAJson(a.value)});}}
                for(const c of r.categories){const category_id=linkADimensionId('category',r.provider,c.native_category_id);add('product_categories',{product_id:p.product_id,category_id},{product_id:p.product_id,category_id,is_primary:+(c.is_primary??false)});const categoryRow=work.prepare("SELECT value_json FROM source_dimensions WHERE type='category' AND provider=? AND native_id=?").get(r.provider,c.native_category_id);for(const [language,name] of Object.entries(categoryRow?JSON.parse(categoryRow.value_json):{}))reservoirAdd(probes.category,'category',`${r.provider}:${r.native_product_id}:${c.native_category_id}:${language}`,{query:name,product_id:p.product_id,source:'category'});}for(const a of r.attributes){const attribute_id=linkADimensionId('attribute_definition',r.provider,a.native_attribute_id);add('product_attributes',{owner_type:'PRODUCT',owner_id:p.product_id,attribute_id},{owner_type:'PRODUCT',owner_id:p.product_id,attribute_id,value_json:canonicalLinkAJson(a.value)});}for(const i of r.images){const image_id=linkAImageId(r.provider,r.native_product_id,i.native_image_id);add('images',{image_id},{image_id,product_id:p.product_id,variant_id:i.variant_native_id?variants.get(i.variant_native_id):null,url:i.url,role:i.role??null,position:i.position??0,metadata_json:imageProvenance(r.provider,r.native_product_id,i.native_image_id,i.metadata)});}
              } else if(r.type==='kit_component'){const p=identity.lookupProductBySource({provider:r.provider,nativeProductId:r.kit_native_product_id});const v=identity.lookupVariantBySource({provider:r.provider,nativeVariantId:r.component_native_variant_id});if(p&&v)add('kit_components',{kit_product_id:p.product_id,component_variant_id:v.variant_id},{kit_product_id:p.product_id,component_variant_id:v.variant_id,quantity:r.quantity,discount_minor:r.discount_minor??null,mutable:+(r.mutable??false),metadata_json:kitProvenance(r)});else mismatch('LINK_A_IDENTITY_MISSING','kit_components',r.kit_native_product_id,'xref',null);}
            }
          }
          for(const table of LINK_A_TABLES){expectedCounts[table]=Number(work.prepare('SELECT count(*) n FROM expected WHERE table_name=?').get(table).n);actualCounts[table]=Number(db.prepare(`SELECT count(*) n FROM ${table}`).get().n);if(expectedCounts[table]!==actualCounts[table])mismatch('LINK_A_TABLE_COUNT',table,'count',expectedCounts[table],actualCounts[table]);}
          for(const row of db.prepare('SELECT product_id,provenance_json FROM products').iterate()){let source;try{source=JSON.parse(row.provenance_json).source;}catch{}if(source&&work.prepare('SELECT 1 FROM quarantine WHERE provider=? AND native_id=?').get(source.provider,source.native_id)){quarantineLeaks++;mismatch('LINK_A_QUARANTINE_LEAK','products',row.product_id,null,source);}}
          for(const list of Object.values(probes))for(const probe of list){let query=probe.query;const tokens=String(query).match(/[\p{L}\p{N}]+/gu)?.slice(0,3)??[];probe.executed=true;if(!tokens.length){probe.passed=true;continue;}const match=tokens.map(t=>`"${t.replaceAll('"','""')}"`).join(' AND ');const found=db.prepare('SELECT 1 FROM fts_words WHERE fts_words MATCH ? AND product_id=? LIMIT 1').get(match,probe.product_id);probe.passed=Boolean(found);if(!found)mismatch('LINK_A_FTS_MISSING','fts_words',probe.product_id,true,false);}ftsComplete=true;
        } finally { work.close(); }
      });
    } finally { identity.close(); }
    currentGuard.assert();
    const post=verifyFrozenSpoolArtifact(stagedSpoolPath);if(post.spoolManifestSha256!==spool.spoolManifestSha256)fail('LINK_A_SPOOL_CHANGED','Staged spool changed');
    if(!same(beforeGeneration,fileEvidence(path.join(catalogStorageDir,`catalog.${expectedGenerationId}.sqlite`)))||!same(beforeIdentity,fileEvidence(identityPath))||!beforePointer.equals(fs.readFileSync(path.join(catalogStorageDir,'CURRENT'))))fail('LINK_A_AUTHORITY_MUTATED','Authority files changed');
  } catch(error){mismatch(error.code??'LINK_A_INTERNAL',null,null,null,error.message);} finally { currentGuard?.close(); }
  const completed=now();const afterCpu=process.cpuUsage(cpu);const afterUsage=process.resourceUsage();const flatProbes=Object.entries(probes).flatMap(([kind,list])=>list.map(({score,...probe})=>({kind,...probe})));
  const report={schema:LINK_A_REPORT_SCHEMA,version:1,status:mismatches===0?'PASS':'FAIL',verifier_version:LINK_A_VERIFIER_VERSION,spool_manifest_sha256:spool?.spoolManifestSha256??null,source_epoch:spool?.manifest.source_epoch??null,snapshot_watermark:spool?.manifest.snapshot_watermark??null,generation:generationMeta,accepted_run:acceptedEvidence??{run_id:acceptedRun?.run_id??null,run_digest:acceptedRun?.run_digest??null,final_seq:acceptedRun?.final_seq??null},publication_authority_sha256:publicationAuthoritySha,source_record_counts:sourceCounts,expected_unique_counts:expectedCounts,actual_counts:actualCounts,quarantine:{quarantined_source_products:quarantineCount,leaked_source_products:quarantineLeaks},fts:{status:ftsComplete?'COMPLETE':'NOT_COMPLETED',probe_count:flatProbes.length,executed_probe_count:flatProbes.filter(p=>p.executed).length,failed_probe_count:ftsComplete?flatProbes.filter(p=>p.passed===false).length:null,probes:flatProbes},mismatch_count:mismatches,mismatches_truncated:mismatchTruncated,mismatches:details,started_at:started.toISOString(),completed_at:completed.toISOString(),duration_ms:completed-started,process_usage:{max_rss:Math.max(usage.maxRSS,afterUsage.maxRSS),user_cpu:afterCpu.userCPU,system_cpu:afterCpu.systemCPU,fs_read:afterUsage.fsRead-usage.fsRead,fs_write:afterUsage.fsWrite-usage.fsWrite}};
  atomicReport(reportPath,report);return report;
}
