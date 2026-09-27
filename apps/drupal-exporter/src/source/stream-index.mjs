import fs from 'node:fs';
import readline from 'node:readline';

export async function streamNdjson(filePath, onRow) {
  if (!fs.existsSync(filePath)) return;
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) await onRow(JSON.parse(line));
  }
}

export async function indexNdjsonByKey(filePath, keyFn, { filter = null } = {}) {
  const index = new Map();
  await streamNdjson(filePath, row => {
    if (filter && !filter(row)) return;
    const key = keyFn(row);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  });
  return index;
}

export async function loadSmallNdjson(filePath) {
  const rows = [];
  await streamNdjson(filePath, row => rows.push(row));
  return rows;
}
