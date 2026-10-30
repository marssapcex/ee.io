import * as w from '@tari-project/ootle-wasm';
const data = Uint8Array.from(Buffer.from('correct horse battery staple'));
const H = 'ab'.repeat(32);
const conj = [[{Builtin:{HashLock:{hash:H,alg:'Sha256'}}},{AccessRule:'AllowAll'}],[{Builtin:{AfterEpoch:100}}]];
const cases = [
 ['conjunction, empty data', JSON.stringify(conj), JSON.stringify(conj[0]), new Uint8Array(0)],
 ['conjunction, 28B data',  JSON.stringify(conj), JSON.stringify(conj[0]), data],
 ['hashlock only, 28B data',JSON.stringify([[{Builtin:{HashLock:{hash:H,alg:'Sha256'}}}]]), JSON.stringify([{Builtin:{HashLock:{hash:H,alg:'Sha256'}}}]), data],
 ['hashlock+timelock, data',JSON.stringify([[{Builtin:{HashLock:{hash:H,alg:'Sha256'}}},{Builtin:{AfterEpoch:5}}]]), JSON.stringify([{Builtin:{HashLock:{hash:H,alg:'Sha256'}}},{Builtin:{AfterEpoch:5}}]), data],
];
for (const [name, cj, lj, d] of cases) {
  try { const r = JSON.parse(w.buildScriptPathWitness(cj, lj, d)); console.log('OK  ', name, 'root=', r.condition_root.slice(0,16)); }
  catch (e) { console.log('ERR ', name, '->', String(e.message).slice(0,140)); }
}
