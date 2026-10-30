import * as w from '@tari-project/ootle-wasm';
const hex=b=>Buffer.from(b).toString('hex');
const variants = [
  ['single hashlock leaf, empty data', JSON.stringify([[{Builtin:{HashLock:{hash:'ab'.repeat(32),alg:'Sha256'}}}]]), JSON.stringify([{Builtin:{HashLock:{hash:'ab'.repeat(32),alg:'Sha256'}}}]), new Uint8Array(0)],
  ['single timelock leaf',            JSON.stringify([[{Builtin:{AfterEpoch:100}}]]), JSON.stringify([{Builtin:{AfterEpoch:100}}]), new Uint8Array(0)],
  ['access rule leaf',                JSON.stringify([[{AccessRule:'AllowAll'}]]), JSON.stringify([{AccessRule:'AllowAll'}]), new Uint8Array(0)],
  ['two leaves',                      JSON.stringify([[{Builtin:{AfterEpoch:100}}],[{Builtin:{BeforeEpoch:5}}]]), JSON.stringify([{Builtin:{AfterEpoch:100}}]), new Uint8Array(0)],
];
for (const [name, cj, lj, d] of variants) {
  try { const r = w.buildScriptPathWitness(cj, lj, d); console.log('OK  ', name, '->', r.slice(0,80)); }
  catch (e) { console.log('ERR ', name, '->', String(e.message).slice(0,120)); }
}
