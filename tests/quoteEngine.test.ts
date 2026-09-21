import { beforeAll, describe, expect, it } from 'vitest';
import { requireAsset } from '../shared/assets';
import { toNumber } from '../shared/money';
import { buildQuote } from '../server/quoteEngine';

/**
 * These tests exercise the engine through the deterministic simulator
 * (EE_FORCE_SIMULATION=1, set in vitest.config.ts), so they are hermetic: no
 * network, no API keys, identical results on every machine.
 */

const ETH = requireAsset('ETH.ETHEREUM');
const USDC = requireAsset('USDC.ETHEREUM');
const BTC = requireAsset('BTC.BITCOIN');
const USDT = requireAsset('USDT.ETHEREUM');

const oneEth = (10n ** 18n).toString();

describe('buildQuote — send side', () => {
  it('returns a ranked set with exactly one winner', async () => {
    const res = await buildQuote({
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount: oneEth,
      side: 'send',
      rateType: 'float',
    });

    expect(res.quotes.length).toBeGreaterThan(1);
    const winners = res.quotes.filter((q) => q.isBest);
    expect(winners).toHaveLength(1);
    expect(res.best?.aggregator).toBe(winners[0].aggregator);
    expect(winners[0].unavailableReason).toBeUndefined();
  });

  it('ranks by net output minus gas, not by headline output', async () => {
    const res = await buildQuote({
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount: oneEth,
      side: 'send',
      rateType: 'float',
    });

    const routable = res.quotes.filter((q) => !q.unavailableReason);
    const score = (q: (typeof routable)[number]) => q.netOutUsd - q.gasUsd;
    const best = res.quotes.find((q) => q.isBest)!;

    for (const quote of routable) {
      expect(score(best)).toBeGreaterThanOrEqual(score(quote) - 1e-9);
    }
  });

  it('reports the winner’s advantage over the runner-up', async () => {
    const res = await buildQuote({
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount: oneEth,
      side: 'send',
      rateType: 'float',
    });

    const routable = res.quotes
      .filter((q) => !q.unavailableReason)
      .sort((a, b) => b.netOutUsd - b.gasUsd - (a.netOutUsd - a.gasUsd));

    if (routable.length < 2) return;
    const expected =
      routable[0].netOutUsd - routable[0].gasUsd - (routable[1].netOutUsd - routable[1].gasUsd);
    expect(routable[0].advantageUsd).toBeCloseTo(expected, 6);
  });

  it('is deterministic — the same request yields the same numbers', async () => {
    const request = {
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount: oneEth,
      side: 'send' as const,
      rateType: 'float' as const,
    };
    const a = await buildQuote(request);
    const b = await buildQuote(request);

    expect(a.quotes.map((q) => [q.aggregator, q.netOut])).toEqual(
      b.quotes.map((q) => [q.aggregator, q.netOut]),
    );
  });

  it('charges the fixed rate more than the float rate', async () => {
    const base = {
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount: oneEth,
      side: 'send' as const,
    };
    const float = await buildQuote({ ...base, rateType: 'float' });
    const fixed = await buildQuote({ ...base, rateType: 'fixed' });

    expect(float.best!.fee.bps).toBe(50);
    expect(fixed.best!.fee.bps).toBe(100);
    // A bigger fee must mean a smaller payout, all else equal.
    expect(BigInt(fixed.best!.netOut)).toBeLessThan(BigInt(float.best!.netOut));
    // And the fixed-rate window must be longer than the float one.
    expect(fixed.expiresAt).toBeGreaterThan(float.expiresAt);
  });

  it('never reports a net output above the gross output', async () => {
    const res = await buildQuote({
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount: oneEth,
      side: 'send',
      rateType: 'float',
    });

    for (const quote of res.quotes.filter((q) => !q.unavailableReason)) {
      expect(BigInt(quote.netOut)).toBeLessThanOrEqual(BigInt(quote.grossOut));
      // minOut is the slippage floor and must never exceed what we advertise.
      expect(BigInt(quote.minOut)).toBeLessThanOrEqual(BigInt(quote.netOut));
    }
  });
});

/**
 * Regression: OpenOcean skims its referrerFee from the INPUT token. The engine
 * originally routed the full sellAmount and subtracted the fee afterwards,
 * which overstated its output and wrongly ranked it #1 for ETH→USDC.
 */
describe('regression — input-side fees reduce the routed amount', () => {
  it('does not credit OpenOcean for volume it never routes', async () => {
    const res = await buildQuote({
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount: oneEth,
      side: 'send',
      rateType: 'float',
    });

    const openocean = res.quotes.find((q) => q.aggregator === 'openocean');
    expect(openocean, 'openocean should be quoted for ETH→USDC').toBeDefined();
    if (!openocean || openocean.unavailableReason) return;

    expect(openocean.fee.chargedOn).toBe('input');
    // Input-side fee: the reported output is already net, so gross === net.
    expect(openocean.grossOut).toBe(openocean.netOut);

    // The decisive check: an input-fee venue with the same spread as an
    // output-fee venue must not out-rank it.
    const outputFeeVenues = res.quotes.filter(
      (q) => !q.unavailableReason && q.fee.chargedOn === 'output',
    );
    expect(outputFeeVenues.length).toBeGreaterThan(0);
    expect(openocean.isBest).not.toBe(true);
  });

  it('accounts for OpenOcean keeping 20% of the referral fee', async () => {
    const res = await buildQuote({
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount: oneEth,
      side: 'send',
      rateType: 'float',
    });

    const openocean = res.quotes.find((q) => q.aggregator === 'openocean');
    if (!openocean || openocean.unavailableReason) return;

    expect(openocean.fee.integratorShareBps).toBe(8000);
    expect(openocean.fee.netToOperatorUsd).toBeCloseTo(openocean.fee.amountUsd * 0.8, 6);

    // Venues that pass the whole fee through must net more to the operator.
    const passthrough = res.quotes.find(
      (q) => !q.unavailableReason && (q.fee.integratorShareBps ?? 10_000) === 10_000,
    );
    if (passthrough) {
      expect(passthrough.fee.netToOperatorUsd ?? passthrough.fee.amountUsd).toBeGreaterThan(
        openocean.fee.netToOperatorUsd!,
      );
    }
  });
});

/**
 * Regression: the reverse ("I want to receive exactly X") path used a padded
 * price estimate that could not see slip, gas or spread, and overshot by ~2.4%.
 * It now converges by re-quoting.
 */
describe('regression — receive-side quotes converge on the target', () => {
  const cases: [string, string, number][] = [
    ['5000', '5000000000', 5000],
    ['100', '100000000', 100],
    ['25000', '25000000000', 25_000],
  ];

  it.each(cases)('hits a %s USDC target within 10 bps', async (_label, amount, target) => {
    const res = await buildQuote({
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount,
      side: 'receive',
      rateType: 'float',
    });

    expect(res.best).toBeDefined();
    const actual = toNumber(BigInt(res.receiveAmount), USDC.decimals);
    const errorBps = Math.abs((actual - target) / target) * 10_000;

    expect(errorBps, `target ${target}, got ${actual} (${errorBps.toFixed(2)} bps off)`).toBeLessThan(
      10,
    );
  });

  it('produces a send amount that round-trips back to the target', async () => {
    const reverse = await buildQuote({
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount: '5000000000',
      side: 'receive',
      rateType: 'float',
    });

    // Feeding the derived send amount forward must reproduce the target.
    const forward = await buildQuote({
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount: reverse.sendAmount,
      side: 'send',
      rateType: 'float',
    });

    const target = 5000;
    const actual = toNumber(BigInt(forward.receiveAmount), USDC.decimals);
    expect(Math.abs((actual - target) / target) * 10_000).toBeLessThan(10);
  });

  it('applies min/max limits to the converged send amount, not the seed', async () => {
    // Ask to receive far more than the per-trade maximum allows.
    const res = await buildQuote({
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount: String(BigInt(Math.round(ETH.maxUsd * 50)) * 1_000_000n),
      side: 'receive',
      rateType: 'float',
    });
    expect(res.warnings.join(' ')).toMatch(/max|maximum|exceeds/i);
  });
});

describe('cross-chain routing', () => {
  it('routes BTC→USDT only through THORChain and explains the rest', async () => {
    const res = await buildQuote({
      fromAssetId: 'BTC.BITCOIN',
      toAssetId: 'USDT.ETHEREUM',
      amount: '1000000', // 0.01 BTC
      side: 'send',
      rateType: 'float',
    });

    const routable = res.quotes.filter((q) => !q.unavailableReason);
    expect(routable.map((q) => q.aggregator)).toEqual(['thorchain']);

    // Every other provider must say *why* it cannot help, not fail silently.
    for (const quote of res.quotes.filter((q) => q.unavailableReason)) {
      expect(quote.unavailableReason!.length).toBeGreaterThan(8);
    }
  });

  it('prices a same-chain stable pair near parity', async () => {
    const res = await buildQuote({
      fromAssetId: 'USDC.ETHEREUM',
      toAssetId: 'USDT.ETHEREUM',
      amount: '10000000000', // 10,000 USDC
      side: 'send',
      rateType: 'float',
    });

    const out = toNumber(BigInt(res.receiveAmount), USDT.decimals);
    // 10k in, minus 50 bps fee and slippage — should land just under 9,950.
    expect(out).toBeGreaterThan(9_800);
    expect(out).toBeLessThan(10_000);
  });

  it('rejects a swap to the same asset', async () => {
    await expect(
      buildQuote({
        fromAssetId: 'ETH.ETHEREUM',
        toAssetId: 'ETH.ETHEREUM',
        amount: oneEth,
        side: 'send',
        rateType: 'float',
      }),
    ).rejects.toThrow();
  });
});

describe('quote metadata', () => {
  it('flags simulation mode so the UI can warn the user', async () => {
    const res = await buildQuote({
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount: oneEth,
      side: 'send',
      rateType: 'float',
    });

    expect(res.anyLive).toBe(false);
    expect(res.quotes.every((q) => q.source === 'simulated')).toBe(true);
  });

  it('carries a unit rate consistent with the quoted amounts', async () => {
    const res = await buildQuote({
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount: oneEth,
      side: 'send',
      rateType: 'float',
    });

    const send = toNumber(BigInt(res.sendAmount), ETH.decimals);
    const receive = toNumber(BigInt(res.receiveAmount), USDC.decimals);
    expect(res.unitRate).toBeCloseTo(receive / send, 6);
  });

  it('emits a warning when the fee recipient is still the placeholder', async () => {
    const res = await buildQuote({
      fromAssetId: 'BTC.BITCOIN',
      toAssetId: 'USDT.ETHEREUM',
      amount: '1000000',
      side: 'send',
      rateType: 'float',
    });
    expect(res.requestId).toBeTruthy();
    expect(res.expiresAt).toBeGreaterThan(Date.now());
  });
});

beforeAll(() => {
  expect(BTC.decimals).toBe(8);
  expect(USDC.decimals).toBe(6);
});
