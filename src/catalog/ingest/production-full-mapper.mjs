import crypto from 'node:crypto';
import { frameUtf8 } from './framing.mjs';
import { validateFullRecords } from './full-record-v1.mjs';
import { normalizeSku } from '../domain/sku.mjs';

export const PRODUCTION_MAPPER_VERSION = 1;
export class FullMapperError extends Error { constructor(code,message,details={}){super(message);this.name='FullMapperError';this.code=code;this.details=details;} }
const fail=(c,m,d)=>{throw new FullMapperError(c,m,d)};
const canonical=v=>JSON.stringify(sort(v));
function sort(v){if(Array.isArray(v))return v.map(sort);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])]));return v;}
function digest(domain,...values){const h=crypto.createHash('sha256').update(domain);for(const v of values)h.update(frameUtf8(v));return h.digest('hex').slice(0,32);}
export function dimensionId(type,provider,nativeId){const prefix={brand:'brand_',category:'cat_',store:'store_',attribute_definition:'attr_'}[type];if(!prefix)throw new TypeError('invalid dimension type');return prefix+digest('BP-CATALOG-DIMENSION-V1\0',type,provider,nativeId);}
export function imageId(provider,product,image){return 'img_'+digest('BP-CATALOG-IMAGE-V1\0',provider,product,image);}
function provenance(provider,nativeId,data){return canonical({source:{provider,native_id:nativeId},provider_data:data??{}});}
function imageProvenance(provider, product, image, data) { return canonical({ source: {
  provider, native_product_id: product, native_image_id: image }, provider_data: data ?? {} }); }
function kitProvenance(record) { return canonical({ source: { provider: record.provider,
  kit_native_product_id: record.kit_native_product_id,
  component_native_variant_id: record.component_native_variant_id }, provider_data: record.metadata ?? {} }); }
function identityCall(fn,detail){try{return fn();}catch(e){fail('FULL_MAPPER_IDENTITY_CONFLICT','Identity mapping conflict',{...detail,cause_code:e.code??null});}}
function topoCategories(records){const cats=records.filter(r=>r.type==='category'), by=new Map(cats.map(r=>[`${r.provider}\0${r.native_category_id}`,r])),out=[],vis=new Set(),stack=new Set();function visit(r){const k=`${r.provider}\0${r.native_category_id}`;if(vis.has(k))return;if(stack.has(k))fail('FULL_RECORD_DUPLICATE','category cycle in chunk');stack.add(k);if(r.parent_native_category_id){const p=by.get(`${r.provider}\0${r.parent_native_category_id}`);if(p)visit(p);}stack.delete(k);vis.add(k);out.push(r);}cats.forEach(visit);return out;}
function checkValue(type,value){return type==='TEXT'?typeof value==='string':type==='NUMBER'?typeof value==='number'&&Number.isFinite(value):type==='BOOL'?typeof value==='boolean':type==='ENUM'?(typeof value==='string'||(Array.isArray(value)&&value.length>0&&value.every(x=>typeof x==='string')&&new Set(value).size===value.length)):false;}
function preflightProducts(writer, records) {
  for (const record of records.filter(row => row.type === 'product')) {
    if (record.brand_native_id && !writer.hasBrand(dimensionId('brand', record.provider, record.brand_native_id))) fail('FULL_MAPPER_REFERENCE_MISSING', 'Brand reference is missing');
    for (const category of record.categories) if (!writer.hasCategory(dimensionId('category', record.provider, category.native_category_id))) fail('FULL_MAPPER_REFERENCE_MISSING', 'Category reference is missing');
    for (const variant of record.variants) for (const stock of variant.stock) if (!writer.hasStore(dimensionId('store', record.provider, stock.store_native_id))) fail('FULL_MAPPER_REFERENCE_MISSING', 'Store reference is missing');
    for (const attribute of [...record.attributes, ...record.variants.flatMap(variant => variant.attributes)]) {
      const definition = writer.readAttributeDefinition(dimensionId('attribute_definition', record.provider, attribute.native_attribute_id));
      if (!definition) fail('FULL_MAPPER_REFERENCE_MISSING', 'Attribute definition is missing');
      if (!checkValue(definition.type, attribute.value)) fail('FULL_RECORD_INVALID', 'Attribute value type mismatch');
    }
  }
}

export function mapProductionFullRecords(writer, records, identityStore) {
  validateFullRecords(records);
  if(!writer||typeof writer.writeProduct!=='function'||!identityStore)fail('FULL_RECORD_INVALID','mapper configuration invalid');
  preflightProducts(writer, records);
  const ordered=records[0]?.phase===0?[...records.filter(r=>r.type!=='category'),...topoCategories(records)]:records;
  for(const r of ordered){
    if(r.type==='brand')writer.writeBrand({brand_id:dimensionId(r.type,r.provider,r.native_brand_id),name:r.name,provenance_json:provenance(r.provider,r.native_brand_id,r.provenance)});
    else if(r.type==='store')writer.writeStore({store_id:dimensionId(r.type,r.provider,r.native_store_id),name:r.name,active:+r.active,metadata_json:provenance(r.provider,r.native_store_id,r.metadata)});
    else if(r.type==='category')writer.writeCategory({category_id:dimensionId(r.type,r.provider,r.native_category_id),parent_id:r.parent_native_category_id?dimensionId(r.type,r.provider,r.parent_native_category_id):null,name_json:canonical(r.localized_names),provenance_json:provenance(r.provider,r.native_category_id,r.provenance)});
    else if(r.type==='attribute_definition')writer.writeAttributeDefinition({attribute_id:dimensionId(r.type,r.provider,r.native_attribute_id),code:r.code,type:r.value_type,label_json:canonical(r.localized_labels),provenance_json:provenance(r.provider,r.native_attribute_id,r.provenance)});
    else if(r.type==='product'){
      const p=identityCall(()=>identityStore.ensureProduct({provider:r.provider,nativeProductId:r.native_product_id}),{type:r.type,provider:r.provider,native_key:r.native_product_id});
      const variants=new Map();for(const v of r.variants){const id=identityCall(()=>identityStore.ensureVariant({provider:r.provider,nativeVariantId:v.native_variant_id,productId:p.product_id,sku:v.sku}),{type:'variant',provider:r.provider,native_key:v.native_variant_id});variants.set(v.native_variant_id,id.variant_id);}
      const def=r.variants.find(v=>v.is_default);writer.writeProduct({product_id:p.product_id,kind:r.kind,product_type:r.product_type??null,brand_id:r.brand_native_id?dimensionId('brand',r.provider,r.brand_native_id):null,default_variant_id:null,provenance_json:provenance(r.provider,r.native_product_id,r.provenance),updated_at:r.updated_at});
      for(const [language,t] of Object.entries(r.localized))writer.writeProductText({product_id:p.product_id,language,title:t.title,short_description:t.short_description??null,description:t.description??null,url:t.url??null});
      for(const v of r.variants){const variant_id=variants.get(v.native_variant_id), n=normalizeSku(v.sku);writer.writeVariant({variant_id,product_id:p.product_id,sku:v.sku,sku_key:n.sku_key,gtin:v.gtin??null,is_default:+v.is_default,options_json:canonical(v.options??{}),updated_at:v.updated_at});if(v.offer)writer.writeOffer({variant_id,current_minor:v.offer.current_minor,regular_minor:v.offer.regular_minor??null,currency:v.offer.currency,on_sale:+v.offer.on_sale,commercial_availability:v.offer.commercial_availability,tax_included:v.offer.tax_included==null?null:+v.offer.tax_included,valid_from:v.offer.valid_from??null,valid_to:v.offer.valid_to??null,source_updated_at:v.offer.source_updated_at??null});for(const s of v.stock)writer.writeStoreStock({variant_id,store_id:dimensionId('store',r.provider,s.store_native_id),quantity:s.quantity,source_updated_at:s.source_updated_at??null});for(const a of v.attributes){const d=writer.readAttributeDefinition(dimensionId('attribute_definition',r.provider,a.native_attribute_id));writer.writeAttributeValue({owner_type:'VARIANT',owner_id:variant_id,attribute_id:d.attribute_id,value_json:canonical(a.value)});}}
      writer.setDefaultVariant(p.product_id,variants.get(def.native_variant_id));
      for(const c of r.categories)writer.writeProductCategory({product_id:p.product_id,category_id:dimensionId('category',r.provider,c.native_category_id),is_primary:+(c.is_primary??false)});
      for(const a of r.attributes){const d=writer.readAttributeDefinition(dimensionId('attribute_definition',r.provider,a.native_attribute_id));writer.writeAttributeValue({owner_type:'PRODUCT',owner_id:p.product_id,attribute_id:d.attribute_id,value_json:canonical(a.value)});}
      for(const i of r.images)writer.writeImage({image_id:imageId(r.provider,r.native_product_id,i.native_image_id),product_id:p.product_id,variant_id:i.variant_native_id?variants.get(i.variant_native_id):null,url:i.url,role:i.role??null,position:i.position??0,metadata_json:imageProvenance(r.provider,r.native_product_id,i.native_image_id,i.metadata)});
    } else if(r.type==='kit_component'){
      const p=identityStore.lookupProductBySource({provider:r.provider,nativeProductId:r.kit_native_product_id});const v=identityStore.lookupVariantBySource({provider:r.provider,nativeVariantId:r.component_native_variant_id});if(!p||!v)fail('FULL_MAPPER_REFERENCE_MISSING','KIT identity reference missing');writer.writeKitComponent({kit_product_id:p.product_id,component_variant_id:v.variant_id,quantity:r.quantity,discount_minor:r.discount_minor??null,mutable:+(r.mutable??false),metadata_json:kitProvenance(r)});
    }
  }
  return records.length;
}

export function productionWriteRows(identityStore){return (writer,rows)=>mapProductionFullRecords(writer,rows,identityStore);}
