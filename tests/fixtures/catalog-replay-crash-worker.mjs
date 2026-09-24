import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';

const [mode, file, encodedKey] = process.argv.slice(2);
const key = JSON.parse(encodedKey);
const store = ReplayStore.openExisting(file);
if (mode === 'after_claim') {
  store.claim(key, 100);
} else if (mode === 'after_takeover') {
  const result = store.takeover(key, { now: 161, expectedLeaseUntil: 160 });
  if (result.status !== 'TAKEN_OVER') throw new Error('Takeover did not happen');
} else {
  throw new Error('Unknown failpoint');
}
process.stdout.write('FAILPOINT:' + mode + '\n');
setInterval(() => {}, 1000);
