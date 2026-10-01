/**
 * evidence/keccakChain.ts — canonical encoding + hash-chain construction.
 *
 * receiptHash = keccak256( keccak256(stableJSON(core)) ‖ prevHash )
 *
 * Two-layer hashing keeps the chain linkable and the core independently
 * verifiable: anyone holding the core JSON can recompute the core hash,
 * anyone holding the chain can recompute every link. Same trick as
 * ee.io's swap receipts, generalized from one flow to any agent task.
 *
 * Pure: depends only on shared/keccak (our own keccak-f, no libraries),
 * so the encoding survives dependency rot — receipts must stay
 * re-verifiable forever from a published spec.
 */
import { keccak_256 } from '../shared/keccak.js';
import type { EvidenceReceipt, Hex, ReceiptCore } from './types.js';

export const GENESIS: Hex = `0x${'00'.repeat(32)}` as Hex;

/** Deterministic JSON: keys sorted at every depth, no whitespace. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const body = keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',');
  return `{${body}}`;
}

export function toHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

export function fromHex(hex: Hex): Uint8Array {
  const s = hex.slice(2);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function keccakHex(data: Uint8Array): Hex {
  return toHex(keccak_256(data));
}

/** keccak256 of the canonical core — the artifact any third party recomputes. */
export function hashCore(core: ReceiptCore): Hex {
  return keccakHex(new TextEncoder().encode(stableStringify(core)));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Build the next receipt in a chain. prev is GENESIS for the first. */
export function makeReceipt(core: ReceiptCore, prevHash: Hex = GENESIS): EvidenceReceipt {
  const coreHash = hashCore(core);
  const receiptHash = keccakHex(concat(fromHex(coreHash), fromHex(prevHash)));
  return { ...core, prevHash, receiptHash };
}
