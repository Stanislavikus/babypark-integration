import { performance } from 'node:perf_hooks';
import { validateFullRecords } from '../src/catalog/ingest/full-record-v1.mjs';
const rows=Array.from({length:500},(_,i)=>({schema:'bp.catalog.full-record/1',type:'brand',phase:0,provider:'benchmark',native_brand_id:`brand-${i}`,name:`Brand ${i}`}));
const samples=[];for(let i=0;i<7;i++){const start=performance.now();validateFullRecords(structuredClone(rows));samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);console.log(JSON.stringify({fixture:'500 worst-row-count valid records',runs:samples.length,median_ms:+samples[3].toFixed(3),max_ms:+Math.max(...samples).toFixed(3)}));
