export function createCatalogLogger(output = process.stdout) {
  return { log(fields) { output.write(JSON.stringify({ time: new Date().toISOString(), service: 'babypark-catalog-ingest', ...fields }) + '\n'); } };
}
