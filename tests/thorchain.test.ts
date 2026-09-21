import { describe, expect, it } from 'vitest';
import {
  OP_RETURN_MAX_BYTES,
  THORCHAIN_MAX_AFFILIATE_BPS,
  buildSwapMemo,
  buildSwapMemoForChain,
  fromThorchain1e8,
  memoByteLength,
  parseSwapMemo,
  shortenAsset,
  toScientificNotation,
  toThorchain1e8,
} from '../shared/thorchain';

/**
 * A malformed THORChain memo does not fail loudly — the network refunds the
 * swap minus fees, or in the worst case the deposit is unrecoverable. These
 * tests treat the memo as the safety-critical surface it is.
 */

describe('toScientificNotation', () => {
  /**
   * The THORChain docs state the decoding rule unambiguously:
   *   "In memo: 1e8  -> THORChain reads: 100000000"
   *   "In memo: 51e7 -> THORChain reads: 510000000"
   * i.e. `NeM` == N x 10^M.
   *
   * The same page's two headline examples contradict that rule: it claims
   * 1612345678 reduces to `161e6` and 10012345678 to `100e7`, but those decode
   * to 161000000 and 1000000000 — ten times too small. We follow the stated
   * rule, not the erroneous examples, because a LIM that is 10x too low
   * silently disables the user's slippage protection.
   */
  it('compresses long integers per the documented decoding rule', () => {
    expect(toScientificNotation(1_612_345_678n)).toBe('161e7');
    // Trailing zeros in the mantissa fold into the exponent, so 100e8
    // is emitted as the shorter, identical-value 1e10.
    expect(toScientificNotation(10_012_345_678n)).toBe('1e10');

    const decode = (s: string) => {
      const [m, e] = s.split('e');
      return BigInt(m) * 10n ** BigInt(e ?? 0);
    };
    expect(decode(toScientificNotation(1_612_345_678n))).toBe(1_610_000_000n);
    // Sanity-check the rule itself against the doc's own worked examples.
    expect(decode('1e8')).toBe(100_000_000n);
    expect(decode('51e7')).toBe(510_000_000n);
  });

  it('ALWAYS rounds down, so the limit stays achievable', () => {
    // Rounding up would refund swaps that should have filled.
    for (const value of [1_999_999_999n, 999_999_999n, 123_456_789n, 555_555_555n]) {
      const encoded = toScientificNotation(value);
      const [mantissa, exponent] = encoded.split('e');
      const decoded = BigInt(mantissa) * 10n ** BigInt(exponent ?? 0);
      expect(decoded, `${value} → ${encoded} must not round up`).toBeLessThanOrEqual(value);
    }
  });

  it('never loses more than the stated significant digits', () => {
    const value = 1_612_345_678n;
    const decoded = 161n * 10n ** 7n; // 1610000000
    // 3 significant digits ⇒ under 1% relative error.
    const errorBps = Number(((value - decoded) * 10_000n) / value);
    expect(errorBps).toBeGreaterThanOrEqual(0);
    expect(errorBps).toBeLessThan(100);
  });

  it('leaves short values untouched', () => {
    expect(toScientificNotation(0n)).toBe('0');
    expect(toScientificNotation(5n)).toBe('5');
    expect(toScientificNotation(999n)).toBe('999');
  });

  it('collapses trailing zeros into the exponent', () => {
    // 100000000 → 1e8, not 100e6.
    expect(toScientificNotation(100_000_000n)).toBe('1e8');
    expect(toScientificNotation(120_000_000n)).toBe('12e7');
  });

  it('round-trips through the decoder for many magnitudes', () => {
    for (let exp = 1; exp <= 18; exp++) {
      const value = 7n * 10n ** BigInt(exp) + 3n;
      const encoded = toScientificNotation(value);
      const [m, e] = encoded.split('e');
      const decoded = BigInt(m) * 10n ** BigInt(e ?? 0);
      expect(decoded).toBeLessThanOrEqual(value);
      expect(decoded * 101n / 100n).toBeGreaterThanOrEqual(value);
    }
  });
});

describe('1e8 conversion', () => {
  it('normalises every asset to 1e8 regardless of native decimals', () => {
    // 1 ETH (18dp) and 1 BTC (8dp) are both 100000000 in a memo.
    expect(toThorchain1e8(10n ** 18n, 18)).toBe(100_000_000n);
    expect(toThorchain1e8(100_000_000n, 8)).toBe(100_000_000n);
    // USDC is 6dp and must scale UP.
    expect(toThorchain1e8(1_000_000n, 6)).toBe(100_000_000n);
  });

  it('round-trips without inventing precision', () => {
    expect(fromThorchain1e8(toThorchain1e8(10n ** 18n, 18), 18)).toBe(10n ** 18n);
    expect(fromThorchain1e8(toThorchain1e8(1_000_000n, 6), 6)).toBe(1_000_000n);
  });

  it('truncates sub-1e8 dust on high-decimal assets rather than rounding up', () => {
    // 1 wei cannot be expressed in 1e8 — it must floor to 0, never to 1.
    expect(toThorchain1e8(1n, 18)).toBe(0n);
    expect(toThorchain1e8(10n ** 10n - 1n, 18)).toBe(0n);
    expect(toThorchain1e8(10n ** 10n, 18)).toBe(1n);
  });
});

describe('buildSwapMemo', () => {
  const dest = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

  it('builds the canonical swap memo', () => {
    const memo = buildSwapMemo({
      asset: 'ETH.ETH',
      destination: dest,
      limit1e8: 100_000_000n,
      affiliates: [{ name: 'ee', bps: 50 }],
    });
    expect(memo).toBe(`=:ETH.ETH:${dest}:100000000:ee:50`);
  });

  it('places the LIM in field 4 — a minimum, not the expected output', () => {
    const parsed = parseSwapMemo(
      buildSwapMemo({ asset: 'ETH.ETH', destination: dest, limit1e8: 42n }),
    );
    expect(parsed?.limit).toBe('42');
  });

  it('omits the limit field when no limit is set', () => {
    const memo = buildSwapMemo({ asset: 'ETH.ETH', destination: dest });
    expect(memo).toBe(`=:ETH.ETH:${dest}`);
  });

  it('encodes streaming swaps as LIM/INTERVAL/QUANTITY', () => {
    const memo = buildSwapMemo({
      asset: 'BTC.BTC',
      destination: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      limit1e8: 500_000n,
      streamingInterval: 1,
      streamingQuantity: 0,
      affiliates: [{ name: 'ee', bps: 50 }],
    });
    expect(memo).toContain(':500000/1/0:');
    expect(parseSwapMemo(memo)?.streamingInterval).toBe('1');
    expect(parseSwapMemo(memo)?.streamingQuantity).toBe('0');
  });

  it('supports multiple affiliates with a shared or per-affiliate bps', () => {
    const shared = buildSwapMemo({
      asset: 'ETH.ETH',
      destination: dest,
      affiliates: [
        { name: 'ee', bps: 25 },
        { name: 'partner', bps: 25 },
      ],
    });
    expect(shared).toContain(':ee/partner:25');

    const split = buildSwapMemo({
      asset: 'ETH.ETH',
      destination: dest,
      affiliates: [
        { name: 'ee', bps: 40 },
        { name: 'partner', bps: 10 },
      ],
    });
    expect(split).toContain(':ee/partner:40/10');
  });

  it('refuses to exceed the 1000 bps protocol cap', () => {
    expect(() =>
      buildSwapMemo({
        asset: 'ETH.ETH',
        destination: dest,
        affiliates: [{ name: 'ee', bps: THORCHAIN_MAX_AFFILIATE_BPS + 1 }],
      }),
    ).toThrow(/1000 bps/);

    // The cap applies to the SUM across affiliates, not each one.
    expect(() =>
      buildSwapMemo({
        asset: 'ETH.ETH',
        destination: dest,
        affiliates: [
          { name: 'a', bps: 600 },
          { name: 'b', bps: 600 },
        ],
      }),
    ).toThrow();
  });

  it('accepts exactly the cap', () => {
    expect(() =>
      buildSwapMemo({
        asset: 'ETH.ETH',
        destination: dest,
        affiliates: [{ name: 'ee', bps: THORCHAIN_MAX_AFFILIATE_BPS }],
      }),
    ).not.toThrow();
  });

  it('never emits a trailing colon, which the parser would misread', () => {
    for (const memo of [
      buildSwapMemo({ asset: 'ETH.ETH', destination: dest }),
      buildSwapMemo({ asset: 'ETH.ETH', destination: dest, limit1e8: 1n }),
      buildSwapMemo({ asset: 'ETH.ETH', destination: dest, affiliates: [{ name: 'ee', bps: 50 }] }),
    ]) {
      expect(memo.endsWith(':')).toBe(false);
    }
  });

  it('keeps the affiliate fields positional when there is no limit', () => {
    // The affiliate must stay in field 5 even with an empty field 4, or the
    // network reads the affiliate name as the trade limit.
    const memo = buildSwapMemo({
      asset: 'ETH.ETH',
      destination: dest,
      affiliates: [{ name: 'ee', bps: 50 }],
    });
    const parts = memo.split(':');
    expect(parts[0]).toBe('=');
    expect(parts[3]).toBe(''); // empty LIM placeholder
    expect(parts[4]).toBe('ee');
    expect(parts[5]).toBe('50');
  });
});

describe('asset shorthand', () => {
  it('maps native assets to their single-letter aliases', () => {
    const expected: [string, string][] = [
      ['THOR.RUNE', 'r'],
      ['BTC.BTC', 'b'],
      ['ETH.ETH', 'e'],
      ['BASE.ETH', 'f'],
      ['AVAX.AVAX', 'a'],
      ['BCH.BCH', 'c'],
      ['DOGE.DOGE', 'd'],
      ['GAIA.ATOM', 'g'],
      ['LTC.LTC', 'l'],
      ['POL.POL', 'p'],
      ['BSC.BNB', 's'],
      ['TRON.TRX', 'tr'],
      ['XRP.XRP', 'x'],
    ];
    for (const [asset, alias] of expected) {
      expect(shortenAsset(asset, true), asset).toBe(alias);
    }
  });

  it('abbreviates ERC-20s to the last 3 contract characters', () => {
    expect(shortenAsset('ETH.USDT-0xdac17f958d2ee523a2206206994597c13d831ec7', true)).toBe(
      'ETH.USDT-ec7',
    );
  });

  it('is a no-op when compaction is off', () => {
    expect(shortenAsset('ETH.ETH', false)).toBe('ETH.ETH');
    expect(shortenAsset('ETH.USDT-0xdac17f958d2ee523a2206206994597c13d831ec7', false)).toBe(
      'ETH.USDT-0xdac17f958d2ee523a2206206994597c13d831ec7',
    );
  });
});

describe('OP_RETURN fitting', () => {
  it('uses the full form when it already fits', () => {
    const result = buildSwapMemoForChain(
      { asset: 'ETH.ETH', destination: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
      'utxo',
    );
    expect(result.compacted).toBe(false);
    expect(result.fitsOpReturn).toBe(true);
  });

  it('compacts a memo that would overflow a Bitcoin OP_RETURN', () => {
    // ERC-20 destination + full contract id + limit + affiliate is > 80 bytes.
    const params = {
      asset: 'ETH.USDT-0xdac17f958d2ee523a2206206994597c13d831ec7',
      destination: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      limit1e8: 1_612_345_678n,
      affiliates: [{ name: 'ee', bps: 50 }],
    };

    const full = buildSwapMemo({ ...params, compact: false });
    expect(memoByteLength(full)).toBeGreaterThan(OP_RETURN_MAX_BYTES);

    const fitted = buildSwapMemoForChain(params, 'utxo');
    expect(fitted.compacted).toBe(true);
    expect(fitted.bytes).toBeLessThanOrEqual(OP_RETURN_MAX_BYTES);
    expect(fitted.fitsOpReturn).toBe(true);
    // Compaction must preserve meaning: same destination, same affiliate.
    const parsed = parseSwapMemo(fitted.memo)!;
    expect(parsed.destination).toBe(params.destination);
    expect(parsed.affiliates).toEqual(['ee']);
    expect(parsed.affiliateBps).toEqual(['50']);
  });

  it('warns instead of silently truncating when even compaction is too long', () => {
    const result = buildSwapMemoForChain(
      {
        asset: 'ETH.SOMETOKEN-0xdac17f958d2ee523a2206206994597c13d831ec7',
        // A long Monero-style destination that cannot be shortened.
        destination: '4'.repeat(95),
        limit1e8: 1_612_345_678n,
        affiliates: [{ name: 'averylongthornamehere', bps: 50 }],
      },
      'utxo',
    );
    expect(result.fitsOpReturn).toBe(false);
    expect(result.warning).toBeTruthy();
    // The memo is still returned intact — never cut mid-field.
    expect(parseSwapMemo(result.memo)).not.toBeNull();
  });

  it('allows the larger 250-byte budget on non-UTXO chains', () => {
    const params = {
      asset: 'ETH.USDT-0xdac17f958d2ee523a2206206994597c13d831ec7',
      destination: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      limit1e8: 1_612_345_678n,
      affiliates: [{ name: 'ee', bps: 50 }],
    };
    const result = buildSwapMemoForChain(params, 'other');
    expect(result.compacted).toBe(false);
    expect(result.fitsThorchain).toBe(true);
  });

  it('measures bytes, not characters', () => {
    // A multi-byte character must count as its UTF-8 length.
    expect(memoByteLength('abc')).toBe(3);
    expect(memoByteLength('é')).toBe(2);
    expect(memoByteLength('🚀')).toBe(4);
  });
});

describe('parseSwapMemo', () => {
  it('round-trips everything the builder emits', () => {
    const memo = buildSwapMemo({
      asset: 'BTC.BTC',
      destination: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      limit1e8: 123_456n,
      streamingInterval: 3,
      streamingQuantity: 7,
      affiliates: [{ name: 'ee', bps: 50 }],
    });
    const parsed = parseSwapMemo(memo)!;

    expect(parsed.function).toBe('=');
    expect(parsed.asset).toBe('BTC.BTC');
    expect(parsed.destination).toBe('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    expect(parsed.limit).toBe('123456');
    expect(parsed.streamingInterval).toBe('3');
    expect(parsed.streamingQuantity).toBe('7');
    expect(parsed.affiliates).toEqual(['ee']);
    expect(parsed.affiliateBps).toEqual(['50']);
  });

  it('rejects a memo with too few fields', () => {
    expect(parseSwapMemo('=:ETH.ETH')).toBeNull();
    expect(parseSwapMemo('')).toBeNull();
  });
});
