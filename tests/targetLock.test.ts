import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * TARGET LOCK (v0.4) — limit order without an orderbook.
 *
 * The user pins an execution condition ABOVE the current quote floor; the
 * deposit-proxy escrow holds the input until a fresh aggregated route can
 * pay the target, else auto-refund at expiry. These tests pin down:
 *   1. the pure lock-gate math (execute / slippage pin),
 *   2. creation validation (target requires fixed; > floor; ≤ +50% cap),
 *   3. the receipt: the execution CONDITION lives in the evidence digest,
 *      while the volatile market observation stays in state only.
 */

vi.mock('../server/quoteEngine.js', () => ({
  defaultSlippageBps: () => 100,
  buildQuote: vi.fn(async () => {
    const quote = {
      aggregator: 'kyberswap',
      minOut: '950',
      netOut: '1000',
      grossOut: '1010',
      gasUsd: 2,
      netOutUsd: 100,
      unavailableReason: undefined,
      warnings: [],
      fee: {
        bps: 100,
        chargedOn: 'output',
        amount: '10',
        assetId: 'USDC.ETHEREUM',
        recipient: '0x8829C3516E8E67f5B6aC815F89a50aE68840a664',
        amountUsd: 10,
      },
    };
    return {
      requestId: 'req-1',
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      sendAmount: '1000000000000000000',
      receiveAmount: '1000',
      rateType: 'fixed',
      unitRate: 1000,
      sendUsd: 100,
      receiveUsd: 100,
      quotes: [quote],
      best: quote,
      expiresAt: Date.now() + 600_000,
      warnings: [],
      anyLive: false,
    };
  }),
}));

const { createDeposit, lockGate } = await import('../server/depositProxy.js');
const { depositReceipt } = await import('../server/receipt.js');

const BASE = {
  fromAssetId: 'ETH.ETHEREUM',
  toAssetId: 'USDC.ETHEREUM',
  amount: '1000000000000000000',
  destinationAddress: '0x8829C3516E8E67f5B6aC815F89a50aE68840a664',
};

describe('lockGate (pure)', () => {
  it('refuses execution below the pinned floor', () => {
    const g = lockGate(1000n, 999n, 100);
    expect(g.execute).toBe(false);
  });

  it('executes at-or-above the floor and pins slippage to the spread', () => {
    // fresh 1050 vs floor 1000 → pin 476bps → clamped to default 100.
    const g = lockGate(1000n, 1050n, 100);
    expect(g.execute).toBe(true);
    expect(g.slippageBps).toBe(100);
  });

  it('pin math: small spread → tight slippage, never below 15bps dust floor', () => {
    // fresh 1010 vs floor 1000 → pin ≈ 99bps → 99-5=94.
    expect(lockGate(1000n, 1010n, 100).slippageBps).toBe(94);
    // fresh 1010 vs floor 1010 → pin 0 → floored at 15.
    expect(lockGate(1010n, 1010n, 100).slippageBps).toBe(15);
  });

  it('zero lock means no gate (float path)', () => {
    expect(lockGate(0n, 1n, 100).execute).toBe(true);
  });
});

describe('target lock creation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects target without fixed rateType', async () => {
    await expect(
      createDeposit({ ...BASE, rateType: 'float', targetMinReceive: '990' }),
    ).rejects.toThrow(/rateType "fixed"/);
  });

  it('rejects a target already reachable now', async () => {
    await expect(createDeposit({ ...BASE, rateType: 'fixed', targetMinReceive: '950' }))
      .rejects.toThrow(/already reachable/);
    await expect(createDeposit({ ...BASE, rateType: 'fixed', targetMinReceive: '900' }))
      .rejects.toThrow(/already reachable/);
  });

  it('rejects an unreachably high target (>+50% cap on netOut)', async () => {
    // netOut 1000 → cap 1500.
    await expect(createDeposit({ ...BASE, rateType: 'fixed', targetMinReceive: '1501' }))
      .rejects.toThrow(/unreachably high/);
  });

  it('creates a watching target lock with extended expiry and honest warnings', async () => {
    const rec = await createDeposit({ ...BASE, rateType: 'fixed', targetMinReceive: '1100' });
    expect(rec.lockKind).toBe('target');
    expect(rec.targetMinReceive).toBe('1100');
    // default target window = 24h
    expect(rec.expiresAt - rec.createdAt).toBe(1440 * 60 * 1000);
    expect(rec.warnings.some((w) => w.includes('TARGET LOCK'))).toBe(true);
    expect(rec.minReceiveAmount).toBe('950'); // contract floor unchanged
  });

  it('honours an explicit window and clamps beyond 72h', async () => {
    const rec = await createDeposit({
      ...BASE,
      rateType: 'fixed',
      targetMinReceive: '1100',
      expiresInMinutes: 360,
    });
    expect(rec.expiresAt - rec.createdAt).toBe(360 * 60 * 1000);
    const clamped = await createDeposit({
      ...BASE,
      rateType: 'fixed',
      targetMinReceive: '1100',
      expiresInMinutes: 99_999,
    });
    expect(clamped.expiresAt - clamped.createdAt).toBe(4320 * 60 * 1000);
  });

  it('plain fixed deposits stay rate-kind 30-minute locks', async () => {
    const rec = await createDeposit({ ...BASE, rateType: 'fixed' });
    expect(rec.lockKind).toBe('rate');
    expect(rec.targetMinReceive).toBeUndefined();
    expect(rec.expiresAt - rec.createdAt).toBe(30 * 60 * 1000);
  });
});

describe('receipt evidence for target locks', () => {
  it('pins the execution CONDITION in the digest, keeps observation volatile', async () => {
    const rec = await createDeposit({ ...BASE, rateType: 'fixed', targetMinReceive: '1100' });
    const r1 = depositReceipt(rec);
    expect(r1.terms.lockKind).toBe('target');
    expect(r1.terms.targetMinReceive).toBe('1100');

    // Market observation (state) moves — evidence hash MUST NOT.
    rec.lastObservedOut = '1050';
    rec.observedAt = Date.now();
    const r2 = depositReceipt(rec);
    expect(r2.evidenceHash).toBe(r1.evidenceHash);
    expect(r2.state.lastObservedOut).toBe('1050');

    // But a 1-unit target tamper MUST change the digest.
    const tampered = { ...rec, targetMinReceive: '1101' };
    expect(depositReceipt(tampered).evidenceHash).not.toBe(r1.evidenceHash);
  });

  it('legacy (rate-kind) deposits keep the new fields nullable', async () => {
    const rec = await createDeposit({ ...BASE, rateType: 'fixed' });
    const r = depositReceipt(rec);
    expect(r.terms.lockKind).toBe('rate');
    expect(r.terms.targetMinReceive).toBeNull();
  });
});
