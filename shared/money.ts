/**
 * Base-unit money math.
 *
 * Every amount that can ever touch a transaction is carried as a bigint of
 * token base units (wei / satoshi / atomic units). Floating point is only ever
 * used for display and for USD estimates, never for an amount that is encoded
 * into calldata or a memo.
 *
 * This is a deliberate departure from the prototype, which multiplied
 * `Number`s and then called `toFixed(6)` — that silently loses precision for
 * 18-decimal tokens and produces amounts that do not round-trip.
 */

export const BPS_DENOMINATOR = 10_000n;

/** Parse a human decimal string into base units. Throws on malformed input. */
export function parseUnits(value: string | number, decimals: number): bigint {
  const raw = typeof value === 'number' ? numberToPlainString(value) : value.trim();
  if (raw === '' || raw === '.' || raw === '-') return 0n;
  if (!/^-?\d*(\.\d*)?$/.test(raw)) {
    throw new Error(`parseUnits: "${raw}" is not a decimal number`);
  }

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = '0', fractionRaw = ''] = unsigned.split('.');

  // Truncate (never round up) — rounding up could ask for more than a user has.
  const fraction = fractionRaw.slice(0, decimals).padEnd(decimals, '0');
  const digits = `${whole || '0'}${fraction}`.replace(/^0+(?=\d)/, '');
  const result = BigInt(digits === '' ? '0' : digits);
  return negative ? -result : result;
}

/** Format base units as a plain (non-exponential) decimal string. */
export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = abs % base;

  if (fraction === 0n) return `${negative ? '-' : ''}${whole}`;

  const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}.${fractionStr}`;
}

/**
 * Format for humans: caps significant decimals so a UI never renders
 * `0.000000000000000001` in a 2-line input box.
 */
export function formatDisplay(value: bigint, decimals: number, maxDecimals = 8): string {
  const full = formatUnits(value, decimals);
  if (!full.includes('.')) return full;

  const [whole, fraction] = full.split('.');
  // Keep more precision for sub-1 amounts (BTC-like), less for large balances.
  const budget = whole === '0' ? maxDecimals : Math.min(maxDecimals, 6);
  const trimmed = fraction.slice(0, budget).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/** Convert base units to a float. Only safe for USD estimates and display. */
export function toNumber(value: bigint, decimals: number): number {
  return Number(formatUnits(value, decimals));
}

/** amount * bps / 10000, truncated. */
export function applyBps(amount: bigint, bps: number): bigint {
  if (bps <= 0) return 0n;
  return (amount * BigInt(Math.round(bps))) / BPS_DENOMINATOR;
}

/** amount * (10000 - bps) / 10000 — the portion left after a bps skim. */
export function subtractBps(amount: bigint, bps: number): bigint {
  return amount - applyBps(amount, bps);
}

/**
 * Inverse of `subtractBps`: the gross amount required so that after a `bps`
 * skim exactly `net` remains. Rounds up so the user is never short.
 */
export function grossUpBps(net: bigint, bps: number): bigint {
  if (bps <= 0) return net;
  const remaining = BPS_DENOMINATOR - BigInt(Math.round(bps));
  if (remaining <= 0n) throw new Error('grossUpBps: fee cannot be 100%');
  return ceilDiv(net * BPS_DENOMINATOR, remaining);
}

export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error('ceilDiv: division by zero');
  return (a + b - 1n) / b;
}

export function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/** Convert an amount between two tokens using a USD price for each. */
export function convertByUsd(
  amount: bigint,
  fromDecimals: number,
  fromUsdPrice: number,
  toDecimals: number,
  toUsdPrice: number,
): bigint {
  if (amount <= 0n || fromUsdPrice <= 0 || toUsdPrice <= 0) return 0n;

  // Scale each price to a bigint independently, then do ONE fused
  // multiply-divide so the decimal rescale and the price ratio share a single
  // rounding step.
  //
  // The obvious implementation — Math.round((from / to) * 1e12) — is wrong for
  // wide price ratios. Converting 1 BTC at $64,213.77 into a token worth
  // $0.0000412 needs a ratio of 1.5e9; multiplying that by 1e12 gives 1.5e21,
  // which is past Number.MAX_SAFE_INTEGER, so the float silently truncates and
  // the round-trip loses ~0.06% (61k satoshi per BTC). Going through the
  // decimal string keeps both prices exact.
  const fromScaled = parseUnits(numberToPlainString(fromUsdPrice), PRICE_DECIMALS);
  const toScaled = parseUnits(numberToPlainString(toUsdPrice), PRICE_DECIMALS);
  if (fromScaled <= 0n || toScaled <= 0n) return 0n;

  // amount * (fromPrice / toPrice) * 10^(toDecimals - fromDecimals).
  // The PRICE_DECIMALS scaling cancels between numerator and denominator.
  return (
    (amount * fromScaled * 10n ** BigInt(toDecimals)) / (toScaled * 10n ** BigInt(fromDecimals))
  );
}

/**
 * Digits of precision retained when a float USD price is lifted into bigint
 * space. 18 comfortably covers both $100k assets and sub-micro-cent tokens.
 */
const PRICE_DECIMALS = 18;

export function rescaleDecimals(amount: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return amount;
  if (fromDecimals < toDecimals) return amount * 10n ** BigInt(toDecimals - fromDecimals);
  return amount / 10n ** BigInt(fromDecimals - toDecimals);
}

/** USD value of a base-unit amount, as a float (display only). */
export function usdValue(amount: bigint, decimals: number, usdPrice: number): number {
  return toNumber(amount, decimals) * usdPrice;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '$0.00';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1000) {
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  if (abs < 0.01 && abs > 0) return `<$0.01`;
  return `$${value.toFixed(2)}`;
}

/** Avoid `1e-7` style output when a JS number reaches the parser. */
function numberToPlainString(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1e-6 && Math.abs(value) < 1e21) return String(value);
  return value.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

export function bpsToPercent(bps: number): number {
  return bps / 100;
}

export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}
