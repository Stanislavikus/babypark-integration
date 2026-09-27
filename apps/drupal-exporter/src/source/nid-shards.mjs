import fs from 'node:fs';
import path from 'node:path';
import { streamNdjson } from './stream-index.mjs';

export async function buildNidShards({
  sourceFile,
  shardDir,
  nidField,
  filter = null,
}) {
  if (!fs.existsSync(sourceFile)) {
    return;
  }
  fs.mkdirSync(shardDir, { recursive: true });
  await streamNdjson(sourceFile, row => {
    const nid = row[nidField];
    if (nid === undefined || nid === null) return;
    if (filter && !filter(nid)) return;
    const file = path.join(shardDir, `${nid}.ndjson`);
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  });
}

export function readNidShard(shardDir, nid) {
  const file = path.join(shardDir, `${nid}.ndjson`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

export function removeNidShards(shardDir) {
  if (fs.existsSync(shardDir)) {
    fs.rmSync(shardDir, { recursive: true, force: true });
  }
}
