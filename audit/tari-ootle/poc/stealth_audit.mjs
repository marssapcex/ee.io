// Tari Ootle — executable audit harness against the project's own shipped WASM artifact.
//
// Artifact: @tari-project/ootle-wasm 0.48.0 (published 2026-10-29), built from
// tari-project/tari-ootle v0.48.0 (6a25dbc5) — the code under audit
// (checkout 3460b2ff = v0.48.0 + #3188). Everything exercised below is real compiled Rust:
//   tari_ootle_wallet_crypto, tari_engine_types::stealth, ootle_address, tari_ootle_transaction.
//
// Run one section per process (`node stealth_audit.mjs <section>`), because a wasm panic poisons the
// instance and because each range proof holds a large transient allocation:
//   node run_all.sh      (runs every section and aggregates last_run.json)
import * as w from '@tari-project/ootle-wasm';
import { createHash } from 'node:crypto';

const NET = 0x26; // Network::Esmeralda
const TARI = 'resource_0101010101010101010101010101010101010101010101010101010101010101';

const hex = (u8) => Buffer.from(u8).toString('hex');
const u8 = (h) => Uint8Array.from(Buffer.from(h, 'hex'));
const S = (x) => JSON.stringify(x);

let pass = 0, fail = 0;
const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    pass++;
    results.push({ name, ok: true, detail: String(detail ?? '') });
    console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`);
  } catch (e) {
    fail++;
    results.push({ name, ok: false, detail: String(e?.message ?? e) });
    console.log(`FAIL  ${name} :: ${String(e?.message ?? e)}`); if (process.env.STACK) console.log(e.stack);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const expectThrow = (fn, why) => {
  try { fn(); } catch (e) { return String(e?.message ?? e); }
  throw new Error(`expected a rejection (${why}) but the call succeeded`);
};

// ---------------------------------------------------------------- identities
const alice = w.generateOotleSecretKey();
const alicePub = w.ootlePublicKeyFromSecretKey(alice.owner_key, alice.view_key);
const aliceAddr = w.generateOotleAddress(alicePub.owner_key, alicePub.view_key, NET);
const bob = w.generateOotleSecretKey();
const bobPub = w.ootlePublicKeyFromSecretKey(bob.owner_key, bob.view_key);

function createOutput(amount, { payTo = null, mvp = 0n, memo = null, receiver = bobPub, network = NET } = {}) {
  const witnessJson = w.createStealthOutputWitness(
    network, receiver.owner_key, receiver.view_key, BigInt(amount), TARI, null, memo,
    payTo === null ? null : S(payTo), BigInt(mvp),
  );
  const out = w.generateStealthOutputsStatement(`[${witnessJson}]`, 0n, new Uint8Array(0));
  const stmt = JSON.parse(out.statement_json);
  return { witnessJson, witness: JSON.parse(witnessJson), stmt, output: stmt.outputs[0], aggMask: out.aggregated_output_mask };
}

function spendKeyPath(o, to = alicePub, amount = null) {
  const value = amount ?? Number(o.witness.witness.amount);
  const inputs = S([{ mask_and_value: { value: Number(o.witness.witness.amount), mask: o.witness.witness.mask } }]);
  const change = w.createStealthOutputWitness(NET, to.owner_key, to.view_key, BigInt(value), TARI, null, null, null, 0n);
  return w.buildStealthTransferStatement(inputs, 0n, `[${change}]`, 0n, new Uint8Array(0));
}

function mutateAndValidate(stmtJson, mutate, label) {
  const s = JSON.parse(stmtJson);
  mutate(s);
  return expectThrow(() => w.validateStealthTransfer(S(s), null), label);
}

// ================================================================= sections
const sections = {
  // ------------------------------------------------------------ 1. addresses
  address() {
    check('address: bech32m round-trip preserves keys, network and destination tag', () => {
      const tag = Uint8Array.from([1, 2, 3, 4]);
      const a = w.generateOotleAddress(bobPub.owner_key, bobPub.view_key, NET, tag);
      const p = w.parseOotleAddress(a);
      assert(p.network === NET, 'network byte lost');
      assert(hex(p.owner_key) === hex(bobPub.owner_key), 'owner key lost');
      assert(hex(p.view_key) === hex(bobPub.view_key), 'view key lost');
      assert(hex(p.destination_tag) === '01020304', 'destination tag lost');
      return a.slice(0, 26) + '…';
    });

    check('address: single-character corruption is rejected (bech32m checksum)', () => {
      let accepted = 0;
      for (let i = 26; i < aliceAddr.length; i += 5) {
        const c = aliceAddr[i] === 'q' ? 'p' : 'q';
        try { w.parseOotleAddress(aliceAddr.slice(0, i) + c + aliceAddr.slice(i + 1)); accepted++; } catch { /* expected */ }
      }
      assert(accepted === 0, `${accepted} corrupted addresses parsed`);
      return 'no corruption accepted';
    });

    check('address [OBS-1]: codec accepts 64 arbitrary bytes as an address payload (no curve-point validation)', () => {
      const junk = Buffer.alloc(64, 0x5a);
      const addr = bech32mEncode('otl_esm_', junk);
      const p = w.parseOotleAddress(addr);
      assert(hex(p.owner_key) === junk.subarray(0, 32).toString('hex'), 'unexpected payload');
      return `parsed OK; owner_key=${hex(p.owner_key).slice(0, 16)}… is not a Ristretto point`;
    });

    check('address: a non-canonical key is rejected once a payment is actually built', () => {
      const junk = Buffer.alloc(64, 0x5a);
      const err = expectThrow(() => w.createStealthOutputWitness(NET, junk.subarray(0, 32), junk.subarray(32),
        1n, TARI, null, null, null, 0n), 'junk keys');
      return err.slice(0, 90);
    });
  },

  // ----------------------------------------------- 2. key-path full lifecycle
  lifecycle() {
    check('stealth: recipient unblinds value+mask from the on-chain commitment', () => {
      const o = createOutput(123_456);
      const key = w.encryptedDataDhKdfAead(bob.view_key, u8(o.witness.witness.sender_public_nonce));
      const dec = w.unblindOutput(u8(o.output.output.commitment), u8(o.witness.witness.encrypted_data), key, false);
      assert(dec.value === 123_456n, `value ${dec.value}`);
      assert(hex(dec.mask) === o.witness.witness.mask, 'mask mismatch');
      return `commitment=${o.output.output.commitment.slice(0, 16)}… value=${dec.value}`;
    });

    check('stealth: recipient derives the committed one-time spend key (output is spendable)', () => {
      const o = createOutput(500_000);
      const secret = w.stealthDhSecret(NET, bob.owner_key, bob.view_key, u8(o.witness.witness.sender_public_nonce));
      const derivedPub = hex(w.publicKeyFromSecretKey(secret));
      const committed = o.output.auth.Key;
      assert(typeof committed === 'string', 'auth is not {Key: hex}');
      assert(derivedPub === committed, `derived ${derivedPub.slice(0, 16)}… != committed ${committed.slice(0, 16)}…`);
      return 'P = H(vR).G + A reproduced from (a, v, R)';
    });

    check('stealth: unblind rejects a tampered ciphertext and a wrong key', () => {
      const o = createOutput(777);
      const commitment = u8(o.output.output.commitment);
      const key = w.encryptedDataDhKdfAead(bob.view_key, u8(o.witness.witness.sender_public_nonce));
      const mutated = u8(o.witness.witness.encrypted_data);
      mutated[mutated.length - 1] ^= 0x01;
      const e1 = expectThrow(() => w.unblindOutput(commitment, mutated, key, false), 'AEAD tag');
      const otherKey = w.encryptedDataDhKdfAead(alice.view_key, u8(o.witness.witness.sender_public_nonce));
      const e2 = expectThrow(() => w.unblindOutput(commitment, u8(o.witness.witness.encrypted_data), otherKey, false), 'wrong key');
      return `tamper="${e1.slice(0, 34)}…" wrongKey="${e2.slice(0, 34)}…"`;
    });

    check('stealth: memo round-trips and is dropped only when skip_memo is set', () => {
      const o = createOutput(9_000, { memo: S({ Message: 'invoice 42' }) });
      const key = w.encryptedDataDhKdfAead(bob.view_key, u8(o.witness.witness.sender_public_nonce));
      const dec = w.unblindOutput(u8(o.output.output.commitment), u8(o.witness.witness.encrypted_data), key, false);
      assert(JSON.parse(dec.memo_json).Message === 'invoice 42', 'memo lost');
      const dec2 = w.unblindOutput(u8(o.output.output.commitment), u8(o.witness.witness.encrypted_data), key, true);
      assert(dec2.memo_json === undefined, 'skip_memo ignored');
      return 'memo intact, skip_memo honoured';
    });

    check('stealth: output for network LocalNet is not spendable under Esmeralda key derivation', () => {
      const o = createOutput(1_000, { network: 0x10 /* LocalNet */ });
      const right = hex(w.publicKeyFromSecretKey(
        w.stealthDhSecret(0x10, bob.owner_key, bob.view_key, u8(o.witness.witness.sender_public_nonce))));
      const wrong = hex(w.publicKeyFromSecretKey(
        w.stealthDhSecret(NET, bob.owner_key, bob.view_key, u8(o.witness.witness.sender_public_nonce))));
      assert(right === o.output.auth.Key, 'network-bound derivation mismatch');
      assert(wrong !== right, 'network byte is not bound into the spend key');
      return 'network byte is domain-separated';
    });
  },

  // ------------------------------------------------------ 3. value + binding
  conservation() {
    check('value conservation: honest key-path spend passes the engine\'s own validator', () => {
      const o = createOutput(1_000_000);
      w.validateStealthTransfer(spendKeyPath(o), null);
      return 'validate_transfer OK';
    });

    check('value conservation: an output worth more than the input is rejected', () => {
      const o = createOutput(1_000_000);
      const inputs = S([{ mask_and_value: { value: 1_000_000, mask: o.witness.witness.mask } }]);
      const change = w.createStealthOutputWitness(NET, alicePub.owner_key, alicePub.view_key, 1_999_999n, TARI, null, null, null, 0n);
      const bad = JSON.parse(w.buildStealthTransferStatement(inputs, 0n, `[${change}]`, 0n, new Uint8Array(0)));
      return expectThrow(() => w.validateStealthTransfer(S(bad), null), 'inflation').slice(0, 95);
    });

    check('binding: minimum_value_promise is covered by the range proof', () => {
      const stmtJson = spendKeyPath(createOutput(1_000_000));
      return mutateAndValidate(stmtJson, (s) => {
        s.outputs_statement.outputs[0].output.minimum_value_promise = 1_000_000;
      }, 'mvp').slice(0, 95);
    });

    check('binding: an output\'s SpendAuthorization is covered (cannot be re-targeted pre-seal)', () => {
      const stmtJson = spendKeyPath(createOutput(1_000_000));
      const attacker = w.generateOotleSecretKey();
      const attackerPub = w.ootlePublicKeyFromSecretKey(attacker.owner_key, attacker.view_key);
      return mutateAndValidate(stmtJson, (s) => {
        s.outputs_statement.outputs[0].auth = { Key: hex(attackerPub.owner_key) };
      }, 'auth').slice(0, 95);
    });

    check('binding: encrypted_data is covered', () => {
      const stmtJson = spendKeyPath(createOutput(1_000_000));
      return mutateAndValidate(stmtJson, (s) => {
        const ed = Buffer.from(s.outputs_statement.outputs[0].output.encrypted_data, 'hex');
        ed[ed.length - 1] ^= 1;
        s.outputs_statement.outputs[0].output.encrypted_data = ed.toString('hex');
      }, 'encrypted_data').slice(0, 95);
    });

    check('binding: a substituted input commitment is covered', () => {
      const stmtJson = spendKeyPath(createOutput(1_000_000));
      const other = createOutput(42);
      return mutateAndValidate(stmtJson, (s) => {
        s.inputs_statement.inputs[0].commitment = other.output.output.commitment;
      }, 'input commitment').slice(0, 95);
    });

    check('binding: the range proof is bound to the output commitments', () => {
      const a = createOutput(10);
      const b = createOutput(20);
      const s = JSON.parse(a.stmt && S(a.stmt));
      s.outputs[0].output.commitment = b.output.output.commitment;
      return expectThrow(() => w.validateStealthTransfer(S({
        inputs_statement: { inputs: [], revealed_amount: 10 },
        outputs_statement: s,
        balance_proof: null,
        covenant_claims: [],
      }), null), 'commitment swap under a fixed proof').slice(0, 95);
    });
  },

  // ------------------------------------------------------ 4. condition tree
  htlc() {
    const preimage = Uint8Array.from(Buffer.from('correct horse battery staple'));
    const sha = createHash('sha256').update(preimage).digest('hex');
    const conditions = [
      [{ Builtin: { HashLock: { hash: sha, alg: 'Sha256' } } }, { AccessRule: 'AllowAll' }],
      [{ Builtin: { AfterEpoch: 100 } }],
    ];

    check('htlc: committed script root equals the root a claimant recomputes', () => {
      const o = createOutput(250_000, { payTo: { Conditions: conditions } });
      const committed = o.output.auth.Script;
      assert(committed, 'output is not gated by a condition tree');
      const claim = JSON.parse(w.buildScriptPathWitness(S(conditions), S(conditions[0]), preimage));
      assert(claim.condition_root === committed, `committed ${committed} != recomputed ${claim.condition_root}`);
      return `root=${committed.slice(0, 16)}…`;
    });

    check('htlc: a script-path claim builds a statement the engine validator accepts', () => {
      const o = createOutput(250_000, { payTo: { Conditions: conditions } });
      const claim = JSON.parse(w.buildScriptPathWitness(S(conditions), S(conditions[0]), preimage));
      const inputs = S([{
        mask_and_value: { value: Number(o.witness.witness.amount), mask: o.witness.witness.mask },
        witness: claim.witness,
        condition_root: claim.condition_root,
      }]);
      const change = w.createStealthOutputWitness(NET, alicePub.owner_key, alicePub.view_key, 250_000n, TARI, null, null, null, 0n);
      const stmtJson = w.buildStealthTransferStatement(inputs, 0n, `[${change}]`, 0n, new Uint8Array(0));
      w.validateStealthTransfer(stmtJson, null);
      const claims = JSON.parse(stmtJson).covenant_claims;
      // The builder attaches one sub-balance claim per distinct condition_root among script-path inputs,
      // even when the revealed leaf never reads it (an inert claim); the engine only consumes it if a
      // Covenant atom is evaluated. Record the shape rather than forbidding it.
      assert(claims.length === 1, `expected exactly 1 claim, got ${claims.length}`);
      assert(claims[0].partition_input_index === 0, 'claim is not keyed to the partition\'s first input');
      return 'validate_transfer OK (predicates themselves are the engine\'s job)';
    });

    check('htlc: a leaf that was never committed yields no witness', () => {
      const rogue = [{ Builtin: { BeforeEpoch: 1 } }];
      return expectThrow(() => w.buildScriptPathWitness(S(conditions), S(rogue), new Uint8Array(0)),
        'uncommitted leaf').slice(0, 95);
    });

    check('htlc: duplicate leaves are refused when building the root', () => {
      return expectThrow(() => w.createStealthOutputWitness(NET, bobPub.owner_key, bobPub.view_key, 1n, TARI,
        null, null, S({ Conditions: [conditions[0], conditions[0]] }), 0n), 'duplicate leaves').slice(0, 95);
    });

    check('htlc: a hashlock leaf with the wrong preimage still produces a statement (predicate is engine-side)', () => {
      const o = createOutput(250_000, { payTo: { Conditions: conditions } });
      const claim = JSON.parse(w.buildScriptPathWitness(S(conditions), S(conditions[0]), u8('00'.repeat(28))));
      const inputs = S([{
        mask_and_value: { value: Number(o.witness.witness.amount), mask: o.witness.witness.mask },
        witness: claim.witness,
        condition_root: claim.condition_root,
      }]);
      const change = w.createStealthOutputWitness(NET, alicePub.owner_key, alicePub.view_key, 250_000n, TARI, null, null, null, 0n);
      const stmtJson = w.buildStealthTransferStatement(inputs, 0n, `[${change}]`, 0n, new Uint8Array(0));
      w.validateStealthTransfer(stmtJson, null);
      return 'accepted by the crypto layer; rejection happens in evaluate_builtin (engine, Rust)';
    });
  },

  // --------------------------------------------------- 5. viewable balance
  viewable() {
    check('viewable balance: proof decrypts to the true value; a lying range yields nothing', () => {
      const o = createOutput(42);
      const vk = w.generateOotleSecretKey();
      const vkPub = w.ootlePublicKeyFromSecretKey(vk.owner_key, vk.view_key);
      const proof = w.generateElgamalViewableBalanceProof(u8(o.witness.witness.mask), 42n,
        u8(o.output.output.commitment), vkPub.view_key);
      const got = w.decryptElgamalViewableBalance(proof, u8(o.output.output.commitment), vkPub.view_key, vk.view_key, 0n, 100n);
      assert(got === 42n, `decrypted ${got}`);
      const none = w.decryptElgamalViewableBalance(proof, u8(o.output.output.commitment), vkPub.view_key, vk.view_key, 0n, 10n);
      assert(none === undefined, `range-limited decrypt returned ${none}`);
      return `value=${got}, out-of-range=undefined`;
    });

    check('viewable balance: proof is bound to its commitment', () => {
      const o1 = createOutput(1_000);
      const o2 = createOutput(1_000);
      const vk = w.generateOotleSecretKey();
      const vkPub = w.ootlePublicKeyFromSecretKey(vk.owner_key, vk.view_key);
      const proof = w.generateElgamalViewableBalanceProof(u8(o1.witness.witness.mask), 1_000n,
        u8(o1.output.output.commitment), vkPub.view_key);
      return expectThrow(() => w.decryptElgamalViewableBalance(proof, u8(o2.output.output.commitment),
        vkPub.view_key, vk.view_key, 0n, 2_000n), 'commitment substitution').slice(0, 95);
    });
  },

  // ------------------------------------------------ 6. split build/sign flow
  split() {
    check('flow parity: separate inputs/outputs/balance-proof calls produce a valid statement', () => {
      const o = createOutput(3_000_000);
      const inp = w.buildStealthInputsStatement(u8(o.output.output.commitment), 0n);
      const change = w.createStealthOutputWitness(NET, alicePub.owner_key, alicePub.view_key, 3_000_000n, TARI, null, null, null, 0n);
      const outs = w.generateStealthOutputsStatement(`[${change}]`, 0n, new Uint8Array(0));
      const inMask = w.aggregateInputMasks(u8(o.witness.witness.mask));
      const sig = w.generateStealthBalanceProofSignature(inMask, outs.aggregated_output_mask, inp, outs.statement_json, '[]');
      const stmt = {
        inputs_statement: JSON.parse(inp),
        outputs_statement: JSON.parse(outs.statement_json),
        balance_proof: { public_nonce: hex(sig.public_nonce), signature: hex(sig.signature) },
        covenant_claims: [],
      };
      w.validateStealthTransfer(S(stmt), null);
      const ok = w.validateBalanceProofSignature(sig.public_nonce, sig.signature, inp, outs.statement_json, '[]');
      assert(ok === true, 'standalone balance-proof verification rejected the same proof');
      return 'both verifiers agree';
    });

    check('flow parity: aggregateInputMasks rejects a non-multiple-of-32 mask blob', () => {
      return expectThrow(() => w.aggregateInputMasks(new Uint8Array(31)), 'ragged mask blob').slice(0, 95);
    });
  },

  // -------------------------------------------------------- 7. limits / DoS
  limits() {
    check('limits [OBS-2]: the pre-flight validator has no statement-size bound of its own', () => {
      const o = createOutput(1_000);
      const c = o.output.output.commitment;
      const many = Array.from({ length: 256 }, () => ({ commitment: c, witness: 'KeyPath' }));
      const inp = w.buildStealthInputsStatementFromInputs(S(many), 0n);
      const n = JSON.parse(inp).inputs.length;
      assert(n === 256, `built ${n} inputs`);
      return `${n} duplicate inputs accepted by the builder; the engine bounds this with check_stealth_transfer_limits (STEALTH_LIMITS)`;
    });

    check('limits: duplicate input commitments are rejected by validate_transfer', () => {
      const o = createOutput(1_000);
      const c = o.output.output.commitment;
      const dup = S([{ commitment: c, witness: 'KeyPath' }, { commitment: c, witness: 'KeyPath' }]);
      const inp = w.buildStealthInputsStatementFromInputs(dup, 0n);
      const outs = w.generateStealthOutputsStatement('[]', 0n, new Uint8Array(0));
      const stmt = {
        inputs_statement: JSON.parse(inp),
        outputs_statement: JSON.parse(outs.statement_json),
        balance_proof: null,
        covenant_claims: [],
      };
      return expectThrow(() => w.validateStealthTransfer(S(stmt), null), 'duplicate inputs').slice(0, 95);
    });
  },
};

// ------------------------------------------------------------------ utility
function bech32mEncode(hrpStr, payloadBytes) {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const data = [];
  let acc = 0, bits = 0;
  for (const byte of payloadBytes) {
    acc = (acc << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; data.push((acc >> bits) & 31); }
  }
  if (bits > 0) data.push((acc << (5 - bits)) & 31);
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  const polymod = (values) => {
    let chk = 1;
    for (const v of values) {
      const top = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
    }
    return chk;
  };
  const hrp = [...hrpStr].map((c) => c.charCodeAt(0));
  const expanded = [...hrp.map((c) => c >> 5), 0, ...hrp.map((c) => c & 31)];
  const mod = polymod([...expanded, ...data, 0, 0, 0, 0, 0, 0]) ^ 0x2bc830a3;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31);
  return hrpStr + '1' + [...data, ...checksum].map((d) => CHARSET[d]).join('');
}

// -------------------------------------------------------------------- entry
const section = process.argv[2];
const chosen = section ? [section] : Object.keys(sections);
for (const name of chosen) {
  if (!sections[name]) { console.error(`unknown section ${name}`); process.exit(2); }
  sections[name]();
}
console.log(`\n──────── ${section ?? 'all'}: checks=${pass + fail} pass=${pass} fail=${fail} ────────`);
const fs = await import('node:fs');
fs.writeFileSync(new URL(`./last_run${section ? '.' + section : ''}.json`, import.meta.url), JSON.stringify({
  artifact: '@tari-project/ootle-wasm@0.48.0',
  repoCommit: '3460b2ff19640c5a3b758de9ec407eac8e372044 (tari-project/tari-ootle; v0.48.0 + #3188)',
  node: process.version,
  section: section ?? 'all',
  pass, fail, results,
}, null, 2));
if (fail > 0) process.exitCode = 1;
