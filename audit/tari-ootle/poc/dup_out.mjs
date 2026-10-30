import * as w from '@tari-project/ootle-wasm';
const NET=0x26, TARI='resource_0101010101010101010101010101010101010101010101010101010101010101';
const S=JSON.stringify;
const a=w.generateOotleSecretKey(), aPub=w.ootlePublicKeyFromSecretKey(a.owner_key,a.view_key);
const b=w.generateOotleSecretKey(), bPub=w.ootlePublicKeyFromSecretKey(b.owner_key,b.view_key);
// two witnesses with identical mask+amount -> identical commitment
const mask = Buffer.from(w.generateOotleSecretKey().owner_key).toString('hex');
const wj = (amt, extra={}) => S({ witness: { amount: amt, mask, sender_public_nonce: extra.nonce ?? Buffer.from(w.generateOotleSecretKey().view_key).toString('hex'),
   minimum_value_promise: 0, encrypted_data: '00'.repeat(16+24+8+32) /* placeholder, replaced below */, resource_view_key: null }, auth: { Key: Buffer.from(aPub.owner_key).toString('hex') }, tag: 0 });
// Build one real witness then clone it with the same mask/amount so commitments collide
const w1 = JSON.parse(w.createStealthOutputWitness(NET, aPub.owner_key, aPub.view_key, 700n, TARI, null, null, null, 0n));
const w2 = JSON.parse(S(w1)); // exact clone -> same mask/amount/nonce => same commitment
const outs = w.generateStealthOutputsStatement(S([w1, w2]), 0n, new Uint8Array(0));
const st = JSON.parse(outs.statement_json);
console.log('outputs:', st.outputs.length, 'commitments equal:', st.outputs[0].output.commitment === st.outputs[1].output.commitment);
// two inputs of 700 each (same mask duplicated is not possible; use two distinct real UTXOs)
const u1 = JSON.parse(w.createStealthOutputWitness(NET, aPub.owner_key, aPub.view_key, 700n, TARI, null, null, null, 0n));
const u2 = JSON.parse(w.createStealthOutputWitness(NET, aPub.owner_key, aPub.view_key, 700n, TARI, null, null, null, 0n));
const u1o = JSON.parse(w.generateStealthOutputsStatement(S([u1]), 0n, new Uint8Array(0)).statement_json).outputs[0].output.commitment;
const u2o = JSON.parse(w.generateStealthOutputsStatement(S([u2]), 0n, new Uint8Array(0)).statement_json).outputs[0].output.commitment;
const inputs = S([{ mask_and_value: { value: 700, mask: u1.witness.mask } }, { mask_and_value: { value: 700, mask: u2.witness.mask } }]);
const stmt = w.buildStealthTransferStatement(inputs, 0n, S([w1, w2]), 0n, new Uint8Array(0));
const p = JSON.parse(stmt);
console.log('input commitments:', p.inputs_statement.inputs.map(i=>i.commitment.slice(0,12)));
console.log('output commitments:', p.outputs_statement.outputs.map(o=>o.output.commitment.slice(0,12)));
try { w.validateStealthTransfer(stmt, null); console.log('RESULT: validateStealthTransfer ACCEPTS the duplicate-output statement'); }
catch (e) { console.log('RESULT: rejected ->', String(e.message).slice(0,120)); }
