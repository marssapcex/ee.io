import * as w from '@tari-project/ootle-wasm';
const NET=0x26, TARI='resource_0101010101010101010101010101010101010101010101010101010101010101';
const bob=w.generateOotleSecretKey(), bobPub=w.ootlePublicKeyFromSecretKey(bob.owner_key,bob.view_key);
const alice=w.generateOotleSecretKey(), alicePub=w.ootlePublicKeyFromSecretKey(alice.owner_key,alice.view_key);
const mb=x=>(x/1048576).toFixed(0);
let i=0;
for (; i<200; i++) {
  try {
    const wj=w.createStealthOutputWitness(NET,bobPub.owner_key,bobPub.view_key,1000n+BigInt(i),TARI,null,null,null,0n);
    const out=w.generateStealthOutputsStatement(`[${wj}]`,0n,new Uint8Array(0));
    if (i%10===0) console.log(`i=${i} rss=${mb(process.memoryUsage().rss)}MB`);
  } catch(e) { console.log(`i=${i} THROW ${String(e.message).slice(0,80)}`); break; }
}
console.log('stopped at', i, 'rss', mb(process.memoryUsage().rss));
