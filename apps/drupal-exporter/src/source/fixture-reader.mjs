import fs from 'node:fs';
import readline from 'node:readline';

export async function readNdjson(filePath) {
  const rows = [];
  if (!fs.existsSync(filePath)) return rows;
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}

export async function streamNdjson(filePath, onRow) {
  if (!fs.existsSync(filePath)) return;
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) await onRow(JSON.parse(line));
  }
}

export function writeNdjson(filePath, rows) {
  const lines = rows.map(row => `${JSON.stringify(row)}\n`).join('');
  fs.writeFileSync(filePath, lines);
}
