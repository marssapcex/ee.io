import * as w from '@tari-project/ootle-wasm';
const NET=0x26, TARI='resource_0101010101010101010101010101010101010101010101010101010101010101';
const S=JSON.stringify;
const conds=[[{Builtin:{HashLock:{hash:'ab'.repeat(32),alg:'Sha256'}}},{AccessRule:'AllowAll'}],[{Builtin:{AfterEpoch:100}}]];
const big = S({Conditions: conds});
console.log('payload len', big.length);
// prefix that the failing section performs at module load
const a=w.generateOotleSecretKey(); const aPub=w.ootlePublicKeyFromSecretKey(a.owner_key,a.view_key);
const aAddr=w.generateOotleAddress(aPub.owner_key,aPub.view_key,NET);
const b=w.generateOotleSecretKey(); const bPub=w.ootlePublicKeyFromSecretKey(b.owner_key,b.view_key);
console.log('addr', aAddr.slice(0,20));
try {
  const wj=w.createStealthOutputWitness(NET,bPub.owner_key,bPub.view_key,250000n,TARI,null,null,big,0n);
  console.log('OK witness len', wj.length);
} catch(e) { console.log('ERR', String(e.message)); }
