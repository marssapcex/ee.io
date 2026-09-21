import { describe, expect, it } from 'vitest';
import {
  applyBps,
  convertByUsd,
  formatDisplay,
  formatUnits,
  formatUsd,
  grossUpBps,
  parseUnits,
  toNumber,
} from '../shared/money';

describe('parseUnits', () => {
  it('parses whole and fractional values at any precision', () => {
    expect(parseUnits('1', 18)).toBe(10n ** 18n);
    expect(parseUnits('0.5', 18)).toBe(5n * 10n ** 17n);
    expect(parseUnits('1234.5678', 6)).toBe(1_234_567_800n);
    expect(parseUnits('0.00000001', 8)).toBe(1n);
  });

  it('handles the forms users actually type', () => {
    expect(parseUnits('.5', 8)).toBe(50_000_000n);
    expect(parseUnits('5.', 8)).toBe(500_000_000n);
    expect(parseUnits('', 8)).toBe(0n);
    expect(parseUnits('0', 8)).toBe(0n);
  });

  it('truncates rather than rounds beyond the asset precision', () => {
    // Rounding up could make us promise more than the chain can represent.
    expect(parseUnits('1.999999999', 6)).toBe(1_999_999n);
  });

  it('survives amounts far beyond Number.MAX_SAFE_INTEGER', () => {
    // 1e9 ETH in wei is ~1e27 — a float would have silently lost precision.
    const huge = parseUnits('1000000000.000000000000000001', 18);
    expect(huge).toBe(1_000_000_000_000_000_000_000_000_001n);
  });

  it('rejects malformed input', () => {
    expect(() => parseUnits('abc', 18)).toThrow();
    expect(() => parseUnits('1.2.3', 18)).toThrow();
    expect(() => parseUnits('1e18', 18)).toThrow();
  });

  it('parses signed values (callers reject negatives at the schema layer)', () => {
    expect(parseUnits('-1', 18)).toBe(-(10n ** 18n));
    expect(formatUnits(-(10n ** 18n), 18)).toBe('-1');
  });
});

describe('formatUnits round-trip', () => {
  it('is lossless for representable values', () => {
    for (const [value, decimals] of [
      ['1', 18],
      ['0.000000000000000001', 18],
      ['123456.789', 6],
      ['0.00000001', 8],
    ] as const) {
      expect(formatUnits(parseUnits(value, decimals), decimals)).toBe(value);
    }
  });
});

describe('basis-point maths', () => {
  it('applyBps takes the stated share', () => {
    expect(applyBps(10_000n, 50)).toBe(50n); // 0.5%
    expect(applyBps(10_000n, 100)).toBe(100n); // 1.0%
    expect(applyBps(1n, 50)).toBe(0n); // rounds down, never invents dust
  });

  it('grossUpBps inverts applyBps so the user still nets the target', () => {
    const target = 1_000_000n;
    const gross = grossUpBps(target, 50);
    const net = gross - applyBps(gross, 50);
    // Grossing up must never *undershoot*: the user asked to receive `target`.
    expect(net).toBeGreaterThanOrEqual(target);
    // And it must not overshoot by more than rounding dust.
    expect(net - target).toBeLessThanOrEqual(1n);
  });

  it('is exact at zero fee', () => {
    expect(grossUpBps(12_345n, 0)).toBe(12_345n);
    expect(applyBps(12_345n, 0)).toBe(0n);
  });
});

describe('convertByUsd', () => {
  it('converts across differing decimals', () => {
    // 1 ETH @ $3000 → USDC (6 dp) @ $1 = 3000 USDC
    const out = convertByUsd(parseUnits('1', 18), 18, 3000, 6, 1);
    expect(formatDisplay(out, 6, 2)).toBe('3000');
  });

  it('is symmetric within rounding', () => {
    const eth = parseUnits('2.5', 18);
    const usdc = convertByUsd(eth, 18, 3000, 6, 1);
    expect(usdc).toBe(7_500_000_000n);
    expect(convertByUsd(usdc, 6, 1, 18, 3000)).toBe(eth);
  });

  // Regression: the original implementation computed
  // Math.round((fromUsd / toUsd) * 1e12), which overflows the float's 53-bit
  // mantissa once the price ratio exceeds ~1e9. Round-tripping 1 BTC through a
  // sub-cent token silently lost 61,262 satoshi (0.06%).
  it('keeps precision across extreme price ratios', () => {
    const btc = parseUnits('1', 8);
    const out = convertByUsd(btc, 8, 64_213.77, 18, 0.0000412);
    const back = convertByUsd(out, 18, 0.0000412, 8, 64_213.77);
    const driftSats = btc - back;
    expect(driftSats >= -1n && driftSats <= 1n).toBe(true);
  });

  it('returns zero when a price is missing rather than dividing by zero', () => {
    expect(convertByUsd(parseUnits('1', 18), 18, 0, 6, 1)).toBe(0n);
    expect(convertByUsd(parseUnits('1', 18), 18, 3000, 6, 0)).toBe(0n);
  });
});

describe('display helpers', () => {
  it('formatDisplay trims trailing zeros and respects precision', () => {
    expect(formatDisplay(parseUnits('1.50000', 18), 18, 6)).toBe('1.5');
    expect(formatDisplay(parseUnits('1', 18), 18, 6)).toBe('1');
    expect(formatDisplay(parseUnits('0.123456789', 18), 18, 4)).toBe('0.1234');
  });

  it('formatUsd stays readable across magnitudes', () => {
    expect(formatUsd(0)).toMatch(/\$0/);
    expect(formatUsd(1234.5)).toBe('$1,235'); // whole dollars above $1k
    expect(formatUsd(2_500_000)).toBe('$2.50M');
    expect(formatUsd(0.004)).toBe('<$0.01');
  });

  it('toNumber is only used for display-scale values', () => {
    expect(toNumber(parseUnits('1.5', 18), 18)).toBeCloseTo(1.5, 12);
  });
});
