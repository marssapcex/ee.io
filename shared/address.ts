/**
 * Destination address validation.
 *
 * A wrong destination address on a non-custodial swap means permanently lost
 * funds — there is no support desk that can claw it back. So validation here
 * verifies real checksums (bech32 polymod, base58check double-SHA256, EIP-55)
 * instead of doing a shallow regex length test.
 */

import { keccak_256 } from './keccak.js';
import { sha256 } from './sha256.js';

export interface AddressValidation {
  isValid: boolean;
  /** Set when the address is structurally valid but deserves a warning. */
  warning?: string;
  message?: string;
  /** Normalised form (e.g. EIP-55 checksummed) when validation succeeds. */
  normalized?: string;
}

const ok = (normalized?: string, warning?: string): AddressValidation => ({
  isValid: true,
  normalized,
  warning,
});
const fail = (message: string): AddressValidation => ({ isValid: false, message });

/* ------------------------------------------------------------------ bech32 */

const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
/** BIP-173 hard limit on a full bech32 string, including hrp and checksum. */
const BECH32_MAX_LENGTH = 90;
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= BECH32_GENERATOR[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const high: number[] = [];
  const low: number[] = [];
  for (const ch of hrp) {
    high.push(ch.charCodeAt(0) >> 5);
    low.push(ch.charCodeAt(0) & 31);
  }
  return [...high, 0, ...low];
}

type Bech32Variant = 'bech32' | 'bech32m';

/** Decode a bech32/bech32m string, verifying the checksum. */
export function bech32Decode(
  input: string,
): { hrp: string; words: number[]; variant: Bech32Variant } | null {
  // BIP-173 caps an address at 90 characters. The previous 120 accepted
  // over-long strings that the reference implementation rejects (BIP-173
  // invalid vector "an84characters…bio1569pvx", 91 chars).
  if (input.length < 8 || input.length > BECH32_MAX_LENGTH) return null;

  const hasLower = input !== input.toUpperCase();
  const hasUpper = input !== input.toLowerCase();
  if (hasLower && hasUpper) return null;

  const value = input.toLowerCase();
  const separator = value.lastIndexOf('1');
  if (separator < 1 || separator + 7 > value.length) return null;

  const hrp = value.slice(0, separator);
  const dataPart = value.slice(separator + 1);

  // Every HRP character must be printable US-ASCII (33–126). Without this the
  // BIP-173 invalid vectors "\x201nwldj5" (space) and "\x7f1axkwrx" (DEL) are
  // wrongly accepted, because a control character still hashes cleanly through
  // the polymod.
  for (const ch of hrp) {
    const code = ch.charCodeAt(0);
    if (code < 33 || code > 126) return null;
  }

  const words: number[] = [];
  for (const ch of dataPart) {
    const index = BECH32_ALPHABET.indexOf(ch);
    if (index === -1) return null;
    words.push(index);
  }

  const checksum = bech32Polymod([...bech32HrpExpand(hrp), ...words]);
  const variant: Bech32Variant | null =
    checksum === 1 ? 'bech32' : checksum === 0x2bc830a3 ? 'bech32m' : null;
  if (!variant) return null;

  return { hrp, words: words.slice(0, -6), variant };
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const maxv = (1 << to) - 1;

  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      result.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) result.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    return null;
  }
  return result;
}

/* -------------------------------------------------------------- base58check */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(input: string): Uint8Array | null {
  let num = 0n;
  for (const ch of input) {
    const index = BASE58_ALPHABET.indexOf(ch);
    if (index === -1) return null;
    num = num * 58n + BigInt(index);
  }

  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  for (const ch of input) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** Verify a base58check payload (4-byte double-SHA256 checksum suffix). */
export function base58CheckDecode(input: string): Uint8Array | null {
  const decoded = base58Decode(input);
  if (!decoded || decoded.length < 5) return null;

  const payload = decoded.slice(0, -4);
  const checksum = decoded.slice(-4);
  const hash = sha256(sha256(payload));

  for (let i = 0; i < 4; i++) {
    if (hash[i] !== checksum[i]) return null;
  }
  return payload;
}

/* ------------------------------------------------------------------- EVM */

export function isHexAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** Apply the EIP-55 mixed-case checksum. */
export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const hash = keccak_256(new TextEncoder().encode(lower));
  const hex = Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hex[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

export function validateEvmAddress(value: string): AddressValidation {
  const address = value.trim();
  if (!address) return fail('Address is required');
  if (!address.startsWith('0x')) return fail('EVM addresses start with 0x');
  if (address.length !== 42) {
    return fail(`Expected 42 characters, got ${address.length}`);
  }
  if (!isHexAddress(address)) return fail('Address contains non-hexadecimal characters');
  if (/^0x0{40}$/.test(address)) return fail('Cannot send to the zero address');

  const checksummed = toChecksumAddress(address);
  const isAllOneCase = address === address.toLowerCase() || address === address.toUpperCase();
  if (!isAllOneCase && address !== checksummed) {
    return fail('EIP-55 checksum mismatch — this address has a typo');
  }
  return ok(checksummed);
}

/* --------------------------------------------------------------- Bitcoin */

export function validateBitcoinAddress(value: string): AddressValidation {
  const address = value.trim();
  if (!address) return fail('Address is required');

  if (address.startsWith('bc1') || address.startsWith('BC1')) {
    const decoded = bech32Decode(address);
    if (!decoded) return fail('Invalid bech32 checksum');
    if (decoded.hrp !== 'bc') return fail(`Wrong network prefix "${decoded.hrp}" — expected "bc"`);

    const version = decoded.words[0];
    const program = convertBits(decoded.words.slice(1), 5, 8, false);
    if (program === null) return fail('Invalid witness program encoding');

    if (version === 0) {
      if (decoded.variant !== 'bech32') return fail('SegWit v0 must use bech32, not bech32m');
      if (program.length !== 20 && program.length !== 32) {
        return fail('SegWit v0 program must be 20 or 32 bytes');
      }
      return ok(address.toLowerCase());
    }
    if (decoded.variant !== 'bech32m') return fail('SegWit v1+ must use bech32m');
    if (program.length < 2 || program.length > 40) return fail('Invalid witness program length');
    return ok(address.toLowerCase(), version === 1 ? 'Taproot (P2TR) address' : undefined);
  }

  if (/^[13]/.test(address)) {
    const payload = base58CheckDecode(address);
    if (!payload) return fail('Invalid base58check checksum');
    if (payload.length !== 21) return fail('Invalid payload length');
    const versionByte = payload[0];
    if (versionByte !== 0x00 && versionByte !== 0x05) {
      return fail('Not a Bitcoin mainnet address version');
    }
    return ok(address, 'Legacy address — higher network fees than bech32');
  }

  return fail('Bitcoin addresses start with bc1, 1, or 3');
}

export function validateLitecoinAddress(value: string): AddressValidation {
  const address = value.trim();
  if (!address) return fail('Address is required');

  if (address.toLowerCase().startsWith('ltc1')) {
    const decoded = bech32Decode(address);
    if (!decoded) return fail('Invalid bech32 checksum');
    if (decoded.hrp !== 'ltc') return fail('Wrong network prefix — expected "ltc"');
    return ok(address.toLowerCase());
  }
  if (/^[LM3]/.test(address)) {
    const payload = base58CheckDecode(address);
    if (!payload) return fail('Invalid base58check checksum');
    return ok(address);
  }
  return fail('Litecoin addresses start with ltc1, L, or M');
}

export function validateDogecoinAddress(value: string): AddressValidation {
  const address = value.trim();
  if (!address) return fail('Address is required');
  if (!/^[DA9]/.test(address)) return fail('Dogecoin addresses start with D, A, or 9');
  const payload = base58CheckDecode(address);
  if (!payload) return fail('Invalid base58check checksum');
  if (payload.length !== 21) return fail('Invalid payload length');
  return ok(address);
}

export function validateBitcoinCashAddress(value: string): AddressValidation {
  const address = value.trim();
  if (!address) return fail('Address is required');
  const withoutPrefix = address.replace(/^bitcoincash:/i, '');
  if (/^[qp][0-9a-z]{40,}$/i.test(withoutPrefix)) return ok(withoutPrefix.toLowerCase());
  if (/^[13]/.test(withoutPrefix)) {
    const payload = base58CheckDecode(withoutPrefix);
    if (!payload) return fail('Invalid base58check checksum');
    return ok(withoutPrefix, 'Legacy format — CashAddr (q...) is preferred');
  }
  return fail('Expected a CashAddr (q…) or legacy address');
}

/* ---------------------------------------------------------------- Monero */

export function validateMoneroAddress(value: string): AddressValidation {
  const address = value.trim();
  if (!address) return fail('Address is required');
  if (!/^[48]/.test(address)) {
    return fail('Monero addresses start with 4 (standard) or 8 (subaddress)');
  }
  if (address.length !== 95 && address.length !== 106) {
    return fail(`Expected 95 or 106 characters, got ${address.length}`);
  }
  for (const ch of address) {
    if (!BASE58_ALPHABET.includes(ch)) return fail('Contains invalid base58 characters');
  }
  return ok(address, address.length === 106 ? 'Integrated address (includes payment ID)' : undefined);
}

/* ----------------------------------------------------------------- Solana */

export function validateSolanaAddress(value: string): AddressValidation {
  const address = value.trim();
  if (!address) return fail('Address is required');
  if (address.length < 32 || address.length > 44) {
    return fail(`Expected 32–44 characters, got ${address.length}`);
  }
  const decoded = base58Decode(address);
  if (!decoded) return fail('Contains invalid base58 characters');
  if (decoded.length !== 32) return fail('Solana addresses decode to 32 bytes');
  return ok(address);
}

/* ------------------------------------------------------------------- TRON */

export function validateTronAddress(value: string): AddressValidation {
  const address = value.trim();
  if (!address) return fail('Address is required');
  if (!address.startsWith('T')) return fail('TRON addresses start with T');
  if (address.length !== 34) return fail(`Expected 34 characters, got ${address.length}`);
  const payload = base58CheckDecode(address);
  if (!payload) return fail('Invalid base58check checksum');
  if (payload[0] !== 0x41) return fail('Not a TRON mainnet address');
  return ok(address);
}

/* ------------------------------------------------------------------ Cosmos */

export function validateCosmosAddress(prefix: string) {
  return (value: string): AddressValidation => {
    const address = value.trim();
    if (!address) return fail('Address is required');
    const decoded = bech32Decode(address);
    if (!decoded) return fail('Invalid bech32 checksum');
    if (decoded.hrp !== prefix) {
      return fail(`Wrong prefix "${decoded.hrp}" — expected "${prefix}"`);
    }
    return ok(address.toLowerCase());
  };
}

/* -------------------------------------------------------------------- XRP */

export function validateRippleAddress(value: string): AddressValidation {
  const address = value.trim();
  if (!address) return fail('Address is required');
  if (!address.startsWith('r')) return fail('XRP addresses start with r');
  if (address.length < 25 || address.length > 35) return fail('Invalid length for an XRP address');
  const RIPPLE_ALPHABET = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';
  for (const ch of address) {
    if (!RIPPLE_ALPHABET.includes(ch)) return fail('Contains invalid characters');
  }
  return ok(address, 'Exchange deposits usually need a destination tag');
}

export type AddressValidator = (value: string) => AddressValidation;
