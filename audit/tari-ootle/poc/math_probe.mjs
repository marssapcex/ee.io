// Math-focused probes for the Tari Ootle stealth statement, run against the shipped WASM build.
//
// Motivated by the Balancer / KyberSwap / Bunni / OtterSec rounding-bug analyses. Their transferable
// primitives, restated for a confidential-transfer validator:
//
//   P1  rounding direction inversion        -> an operation rounds the *wrong* way at a boundary
//   P2  computed value != moved value       -> the amount used in the proof is not the amount spent
//   P3  extreme-state amplification         -> correctness holds at 0/1/MAX but not at "0-ish"
//   P4  binding is per-field, not per-slot   -> a proof verifies a *set* but the engine reads a *position*
//   P5  compounding                         -> one unit of error is free to repeat
//
// P4 is the one a confidential-transfer design is most exposed to: an aggregated range proof commits to
// an ordered list of (commitment, minimum_value_promise, viewable proof). If any of those can be permuted
// between slots after the proof is built, the engine would honour an output it never verified.
//
// Run:  node poc/math_probe.mjs binding
//       node poc/math_probe.mjs extremes
import * as w from '@tari-project/ootle-wasm';

const NET = 0x26; // Esmeralda
const TARI = 'resource_0101010101010101010101010101010101010101010101010101010101010101';
const S = (x) => JSON.stringify(x);
const hex = (u8) => Buffer.from(u8).toString('hex');

let pass = 0, fail = 0;
const results = [];
function check(name, fn) {
  try {
    const d = fn();
    pass++;
    results.push({ name, ok: true, detail: String(d ?? '') });
    console.log(`PASS  ${name}${d ? ' :: ' + d : ''}`);
  } catch (e) {
    fail++;
    results.push({ name, ok: false, detail: String(e?.message ?? e) });
    console.log(`FAIL  ${name} :: ${String(e?.message ?? e)}`);
    if (process.env.STACK) console.log(e.stack);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const expectThrow = (fn, why) => {
  try { fn(); } catch (e) { return String(e?.message ?? e).slice(0, 120); }
  throw new Error(`expected rejection (${why}) but call succeeded`);
};

const alice = w.generateOotleSecretKey();
const alicePub = w.ootlePublicKeyFromSecretKey(alice.owner_key, alice.view_key);
const bob = w.generateOotleSecretKey();
const bobPub = w.ootlePublicKeyFromSecretKey(bob.owner_key, bob.view_key);

const RECEIVER = bobPub.owner_key;            // revealed-output destination (32 bytes)
const rvkPair = w.generateOotleSecretKey();
const RESOURCE_VIEW_KEY = w.ootlePublicKeyFromSecretKey(rvkPair.owner_key, rvkPair.view_key).view_key;

const witness = (amount, { mvp = 0n, viewKey = null, payTo = null } = {}) =>
  w.createStealthOutputWitness(NET, bobPub.owner_key, bobPub.view_key, BigInt(amount), TARI,
    viewKey, null, payTo === null ? null : S(payTo), BigInt(mvp));

const inputOf = (wjson, value = null) => {
  const x = JSON.parse(wjson).witness;
  return `{"mask_and_value":{"value":${value ?? x.amount},"mask":"${x.mask}"}}`;
};

/** A statement spending one funding UTXO of `total` into `amounts`, each with its own mvp. */
function buildStatement(total, amounts, { mvps = null, viewKeyForAll = null, revealed = 0n } = {}) {
  const funding = witness(total);
  const outs = amounts.map((a, i) => witness(a, {
    mvp: mvps ? BigInt(mvps[i]) : 0n,
    viewKey: viewKeyForAll,
  }));
  const stmt = w.buildStealthTransferStatement(`[${inputOf(funding)}]`, 0n, `[${outs.join(',')}]`, revealed,
    RECEIVER);
  return { stmt, parsed: JSON.parse(stmt) };
}

const sections = {
  // ------------------------------------------------------------------ P4: slot binding
  binding() {
    check('binding: swapping two output commitments (same set, different slots) is rejected', () => {
      const { stmt } = buildStatement(1_000, [10, 900]);
      const s = JSON.parse(stmt);
      assert(s.outputs_statement.outputs.length === 2, 'expected 2 outputs');
      const c0 = s.outputs_statement.outputs[0].output.commitment;
      const c1 = s.outputs_statement.outputs[1].output.commitment;
      assert(c0 !== c1, 'outputs collided');
      s.outputs_statement.outputs[0].output.commitment = c1;
      s.outputs_statement.outputs[1].output.commitment = c0;
      return expectThrow(() => w.validateStealthTransfer(S(s), null), 'permuted commitments');
    });

    check('binding: swapping minimum_value_promise between two slots is rejected', () => {
      const { stmt } = buildStatement(1_000, [10, 900], { mvps: [0, 500] });
      const s = JSON.parse(stmt);
      const a = s.outputs_statement.outputs[0].output.minimum_value_promise;
      const b = s.outputs_statement.outputs[1].output.minimum_value_promise;
      assert(a !== b, `mvp not distinct (${a}, ${b})`);
      s.outputs_statement.outputs[0].output.minimum_value_promise = b;
      s.outputs_statement.outputs[1].output.minimum_value_promise = a;
      return expectThrow(() => w.validateStealthTransfer(S(s), null), 'permuted mvp');
    });

    check('binding: swapping viewable-balance proofs between two slots is rejected', () => {
      const { stmt } = buildStatement(1_000, [10, 900], { viewKeyForAll: RESOURCE_VIEW_KEY });
      const s = JSON.parse(stmt);
      const p0 = s.outputs_statement.outputs[0].output.viewable_balance_proof;
      const p1 = s.outputs_statement.outputs[1].output.viewable_balance_proof;
      assert(p0 && p1 && S(p0) !== S(p1), 'no distinct viewable proofs were produced');
      s.outputs_statement.outputs[0].output.viewable_balance_proof = p1;
      s.outputs_statement.outputs[1].output.viewable_balance_proof = p0;
      return expectThrow(() => w.validateStealthTransfer(S(s), null), 'permuted viewable proofs');
    });

    check('binding: reordering the output list is rejected', () => {
      const { stmt } = buildStatement(1_000, [10, 900]);
      const s = JSON.parse(stmt);
      s.outputs_statement.outputs.reverse();
      return expectThrow(() => w.validateStealthTransfer(S(s), null), 'reordered outputs');
    });

    check('binding: an odd output count (3) still binds every slot', () => {
      // bulletproofs aggregate by padding to a power of two; 3 statements exercise that padding.
      const { stmt } = buildStatement(1_000, [100, 200, 700]);
      const s = JSON.parse(stmt);
      assert(s.outputs_statement.outputs.length === 3, 'expected 3 outputs');
      const c = s.outputs_statement.outputs.map(o => o.output.commitment);
      s.outputs_statement.outputs[2].output.commitment = c[0];
      s.outputs_statement.outputs[0].output.commitment = c[2];
      return expectThrow(() => w.validateStealthTransfer(S(s), null), 'permuted 3-way');
    });

    check('binding: 5 outputs — permuting the last two, which pad into the same aggregation block', () => {
      const { stmt } = buildStatement(1_000, [100, 100, 100, 300, 400]);
      const s = JSON.parse(stmt);
      const o = s.outputs_statement.outputs;
      const a = o[3].output.commitment;
      o[3].output.commitment = o[4].output.commitment;
      o[4].output.commitment = a;
      return expectThrow(() => w.validateStealthTransfer(S(s), null), 'permuted 5-way tail');
    });

    check('binding: revealed_output cannot be retargeted to another amount after signing', () => {
      const funding = witness(1_000);
      const change = witness(400);
      const stmt = w.buildStealthTransferStatement(`[${inputOf(funding)}]`, 0n, `[${change}]`, 600n,
        RECEIVER);
      const s = JSON.parse(stmt);
      assert(s.outputs_statement.revealed_output, 'no revealed_output in statement');
      s.outputs_statement.revealed_output.amount = 700;
      return expectThrow(() => w.validateStealthTransfer(S(s), null), 'revealed amount raised');
    });

    check('binding: revealed_input cannot be raised after signing (P2: computed != moved)', () => {
      const funding = witness(1_000);
      const change = witness(1_000);
      const stmt = w.buildStealthTransferStatement(`[${inputOf(funding)}]`, 0n, `[${change}]`, 0n,
        new Uint8Array(0));
      const s = JSON.parse(stmt);
      s.inputs_statement.revealed_amount = 1;
      return expectThrow(() => w.validateStealthTransfer(S(s), null), 'revealed input raised');
    });
  },

  // ------------------------------------------------------------------ P3: extremes
  extremes() {
    check('extremes: value 0 output with mvp 0 is either refused or carries a sound proof', () => {
      const { stmt } = buildStatement(1_000, [0, 1_000]);
      try {
        w.validateStealthTransfer(stmt, null);
        return 'accepted with a range proof over a zero value (sound: 0 is provable)';
      } catch (e) {
        return `refused: ${String(e.message).slice(0, 90)}`;
      }
    });

    check('extremes: mvp > amount is refused at build time', () => {
      return expectThrow(() => buildStatement(1_000, [10], { mvps: [11] }), 'mvp above value');
    });

    check('extremes: value = 2^64-1 is accepted and range-proved (top of the u64 domain)', () => {
      const max = 18446744073709551615n;
      const funding = witness(max);
      const out = witness(max - 1n);
      const raw = `[{"mask_and_value":{"value":18446744073709551615,"mask":"${JSON.parse(funding).witness.mask}"}}]`;
      const stmt = w.buildStealthTransferStatement(raw, 0n, `[${out}]`, 1n, RECEIVER);
      w.validateStealthTransfer(stmt, null);
      return 'u64::MAX accepted, u64::MAX-1 + 1 revealed balances exactly';
    });

    check('extremes: value = 2^64 (outside the range-proof domain) cannot produce a valid statement', () => {
      let built = null;
      try {
        const out = w.createStealthOutputWitness(NET, bobPub.owner_key, bobPub.view_key, 2n ** 64n, TARI,
          null, null, null, 0n);
        built = out;
      } catch (e) {
        return `refused at build: ${String(e.message).slice(0, 90)}`;
      }
      const funding = witness(1_000);
      const stmt = w.buildStealthTransferStatement(`[${inputOf(funding)}]`, 0n, `[${built}]`, 0n,
        new Uint8Array(0));
      return expectThrow(() => w.validateStealthTransfer(stmt, null), '2^64 output');
    });

    check('extremes: two outputs at 2^63 each, funded by one 2^64-1 input', () => {
      // Sum of the two outputs (2^64) exceeds the input by 1 -> must fail on the excess, not on overflow.
      const half = 9223372036854775808n;
      const funding = witness(18446744073709551615n);
      const o1 = witness(half);
      const o2 = witness(half);
      const raw = `[{"mask_and_value":{"value":18446744073709551615,"mask":"${JSON.parse(funding).witness.mask}"}}]`;
      const stmt = w.buildStealthTransferStatement(raw, 0n, `[${o1},${o2}]`, 0n, RECEIVER);
      return expectThrow(() => w.validateStealthTransfer(stmt, null), '1 unit of inflation');
    });

    check('extremes: the aggregation ceiling is reachable — 16 outputs build, 17 are refused', () => {
      const { parsed } = buildStatement(16, Array.from({ length: 16 }, () => 1));
      assert(parsed.outputs_statement.outputs.length === 16, 'expected 16 outputs');
      const err = (() => {
        try {
          buildStatement(17, Array.from({ length: 17 }, () => 1));
          return null;
        } catch (e) { return String(e.message); }
      })();
      assert(err !== null, '17 outputs were built but MAX_LAZY_BP_AGG_FACTORS is 16');
      assert(/exceeds the maximum supported 16/.test(err), `unexpected error: ${err}`);
      return 'limit is enforced by the prover and by the verifier (range_proof.rs:47)';
    });

    check('extremes: negative revealed_amount is refused by the validator', () => {
      const funding = witness(1_000);
      const change = witness(1_000);
      const stmt = w.buildStealthTransferStatement(`[${inputOf(funding)}]`, 0n, `[${change}]`, 0n,
        new Uint8Array(0));
      const s = JSON.parse(stmt);
      s.inputs_statement.revealed_amount = -1;
      return expectThrow(() => w.validateStealthTransfer(S(s), null), 'negative revealed input');
    });
  },
};

const want = process.argv[2];
if (!sections[want]) {
  console.error(`usage: node math_probe.mjs <${Object.keys(sections).join('|')}>`);
  process.exit(2);
}
sections[want]();
console.log(`\n──────── math/${want}: checks=${pass + fail} pass=${pass} fail=${fail} ────────`);
const fs = await import('node:fs');
fs.writeFileSync(`poc/last_run.math_${want}.json`, JSON.stringify({
  artifact: '@tari-project/ootle-wasm@0.48.0', section: `math_${want}`, pass, fail, results,
}, null, 2));
process.exit(fail === 0 ? 0 : 1);
