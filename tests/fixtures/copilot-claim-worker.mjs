import fs from 'node:fs';
import { CopilotStore } from '../../src/copilot/store.mjs';

const [database, gate, token] = process.argv.slice(2);
while (!fs.existsSync(gate)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
const store = CopilotStore.open(database, { now: () => 2_000_000_000_000 });
const claimed = store.claimNext({ leaseMs: 60_000, token });
store.close();
process.stdout.write(claimed ? `${claimed.id}\n` : 'none\n');

