// Proves the Mainnet write path: one real memory into the underwriter account, then reads it back.
// Usage: pnpm mem:ping
import { underwriter, recall, listAll } from '../src/memory/client.js';
import { C } from '../src/config.js';

const text = `${C.PREFIX.quote}${JSON.stringify({ kind: 'write-path-check', at: Date.now() })}`;

console.log('health   ', await underwriter.health());
const t0 = Date.now();
const res = await underwriter.rememberAndWait(text, C.NS.quotes);
console.log(`remember  blob ${res.blob_id} (${Date.now() - t0} ms, namespace ${res.namespace})`);

const hits = await recall(underwriter, C.NS.quotes, 'write path check', 5);
console.log('recall   ', hits.length, 'hit(s); nearest distance', hits[0]?.distance ?? 'n/a');
console.log('indexed  ', (await listAll(underwriter, C.NS.quotes)).length, 'memories in', C.NS.quotes);
