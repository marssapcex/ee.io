import * as w from '@tari-project/ootle-wasm';
import { createHash } from 'node:crypto';
const NET=0x26, TARI='resource_0101010101010101010101010101010101010101010101010101010101010101';
const S=JSON.stringify;
const bob=w.generateOotleSecretKey(), bobPub=w.ootlePublicKeyFromSecretKey(bob.owner_key,bob.view_key);
const preimage=Uint8Array.from(Buffer.from('correct horse battery staple'));
const sha=createHash('sha256').update(preimage).digest('hex');
const conds=[[{Builtin:{HashLock:{hash:sha,alg:'Sha256'}}},{AccessRule:'AllowAll'}],[{Builtin:{AfterEpoch:100}}]];
function step(label, fn){ try { const r=fn(); console.log('OK  ', label, r ?? ''); return r; } catch(e){ console.log('ERR ', label, String(e.message).slice(0,120)); } }
step('witnessWithConditions', ()=> w.createStealthOutputWitness(NET,bobPub.owner_key,bobPub.view_key,250000n,TARI,null,null,S({Conditions:conds}),0n).length+' bytes');
const wj = step('witness2', ()=> w.createStealthOutputWitness(NET,bobPub.owner_key,bobPub.view_key,250000n,TARI,null,null,S({Conditions:conds}),0n));
step('outputsStatement', ()=> { const o=w.generateStealthOutputsStatement(`[${wj}]`,0n,new Uint8Array(0)); return o.statement_json.length+' bytes'; });
step('scriptPathWitness', ()=> w.buildScriptPathWitness(S(conds),S(conds[0]),preimage).length+' bytes');
