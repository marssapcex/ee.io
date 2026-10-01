import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetPartners,
  accrueDeposit,
  allowPartnerRequest,
  authenticatePartner,
  partnerRegistry,
  partnerStats,
} from '../server/partners';
import type { DepositRecord } from '../shared/types';

function fakeDeposit(over: Partial<DepositRecord> = {}): DepositRecord {
  return {
    depositId: 'DP-111111',
    orderId: 'DP-111111',
    createdAt: Date.now(),
    expiresAt: Date.now() + 30_000,
    status: 'awaiting_funds',
    fromAssetId: 'ETH.ETHEREUM',
    toAssetId: 'USDC.ETHEREUM',
    sendAmount: '1000000000000000000',
    sendUsd: 3400,
    receiveAmount: '3350000000',
    minReceiveAmount: '3300000000',
    destinationAddress: '0x2222222222222222222222222222222222222222',
    depositAddress: '0x4444444444444444444444444444444444444444',
    factoryAddress: '0x5555555555555555555555555555555555555555',
    logicAddress: '0x6666666666666666666666666666666666666666',
    chainId: 1,
    chain: 'ethereum',
    aggregator: 'kyberswap',
    quote: {} as DepositRecord['quote'],
    fee: {
      bps: 50,
      chargedOn: 'output',
      amount: '17000000',
      assetId: 'USDC.ETHEREUM',
      recipient: '0x7777777777777777777777777777777777777777',
      amountUsd: 17,
    },
    warnings: [],
    ...over,
  };
}

describe('partners', () => {
  beforeEach(() => {
    process.env.EE_PARTNER_KEYS = 'walletx:sk_live_0123456789abcdef:2500,dashy:pk_aaaaaaaaaaaaaaaa:1000';
    __resetPartners();
  });
  afterEach(() => {
    delete process.env.EE_PARTNER_KEYS;
    __resetPartners();
  });

  it('parses the registry from the environment', () => {
    const registry = partnerRegistry();
    expect(registry).toHaveLength(2);
    expect(registry[0]).toEqual({ id: 'walletx', apiKey: 'sk_live_0123456789abcdef', shareBps: 2500 });
  });

  it('authenticates by api key and rejects unknown keys', () => {
    expect(authenticatePartner('sk_live_0123456789abcdef')?.id).toBe('walletx');
    expect(authenticatePartner('pk_aaaaaaaaaaaaaaaa')?.shareBps).toBe(1000);
    expect(authenticatePartner('wrong')).toBeUndefined();
    expect(authenticatePartner(undefined)).toBeUndefined();
  });

  it('ignores malformed entries instead of crashing boot', () => {
    process.env.EE_PARTNER_KEYS = 'okname:sk_live_0123456789abcdef:500,broken,too:shorts:1,badbps:name_key_0123456789:abc';
    __resetPartners();
    const registry = partnerRegistry();
    expect(registry).toHaveLength(1);
    expect(registry[0].id).toBe('okname');
  });

  it('rate-limits at 60 requests per minute per partner', () => {
    const partner = authenticatePartner('sk_live_0123456789abcdef')!;
    for (let i = 0; i < 60; i += 1) {
      expect(allowPartnerRequest(partner)).toBe(true);
    }
    expect(allowPartnerRequest(partner)).toBe(false);
    // A different partner has its own bucket.
    const other = authenticatePartner('pk_aaaaaaaaaaaaaaaa')!;
    expect(allowPartnerRequest(other)).toBe(true);
  });

  it('accrues volume and the partner fee share on deposit creation', () => {
    const partner = authenticatePartner('sk_live_0123456789abcdef')!; // 25%
    accrueDeposit(partner, fakeDeposit());
    accrueDeposit(partner, fakeDeposit({ depositId: 'DP-222222', sendUsd: 1000 }));
    const stats = partnerStats('walletx')!;
    expect(stats.deposits).toBe(2);
    expect(stats.volumeUsd).toBe(4400);
    // fee.amountUsd 17 × 2 × 25% = 8.5
    expect(stats.earnedUsd).toBe(8.5);
  });
});
