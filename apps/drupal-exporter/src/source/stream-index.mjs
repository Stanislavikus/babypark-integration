import fs from 'node:fs';

async function forEachLfDelimitedLine(filePath, onLine) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  let pending = '';

  try {
    for await (const chunk of stream) {
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        let line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        await onLine(line);
      }
    }
    if (pending) {
      if (pending.endsWith('\r')) pending = pending.slice(0, -1);
      await onLine(pending);
    }
  } finally {
    stream.destroy();
  }
}

export async function streamNdjson(filePath, onRow) {
  if (!fs.existsSync(filePath)) return;
  await forEachLfDelimitedLine(filePath, async line => {
    if (line.trim()) await onRow(JSON.parse(line));
  });
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
