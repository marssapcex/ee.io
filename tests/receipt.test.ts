import { describe, expect, it } from 'vitest';
import { depositReceipt } from '../server/receipt';
import { keccak_256 } from '../shared/keccak';
import type { DepositRecord } from '../shared/types';

function fakeDeposit(): DepositRecord {
  return {
    depositId: 'DP-424242',
    orderId: 'DP-424242',
    createdAt: 1758000000000,
    expiresAt: 1758001800000,
    status: 'awaiting_funds',
    fromAssetId: 'ETH.ETHEREUM',
    toAssetId: 'USDC.ETHEREUM',
    sendAmount: '1000000000000000000',
    sendUsd: 3400,
    receiveAmount: '3350000000',
    minReceiveAmount: '3290000000',
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
    rateType: 'fixed',
    failureMode: 'atomic-refund',
    warnings: [],
  };
}

describe('evidence receipt', () => {
  it('is deterministic — same terms, same hash, forever', () => {
    const r1 = depositReceipt(fakeDeposit());
    const r2 = depositReceipt(fakeDeposit());
    expect(r1.evidenceHash).toBe(r2.evidenceHash);
    expect(r1.schema).toBe('ee.io/receipt-v1');
  });

  it('independently recomputes from the exported terms', () => {
    const receipt = depositReceipt(fakeDeposit());
    const keys = Object.keys(receipt.terms).sort();
    const canonical = JSON.stringify(keys.map((k) => [k, (receipt.terms as Record<string, unknown>)[k] ?? null]));
    const digest = keccak_256(new TextEncoder().encode(canonical));
    const recomputed = '0x' + Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(receipt.evidenceHash).toBe(recomputed);
  });

  it('volatile state never enters the terms hash', () => {
    const settled = { ...fakeDeposit(), status: 'executed' as const, txHash: '0xabc', outTxHash: '0xdef' };
    expect(depositReceipt(settled).evidenceHash).toBe(depositReceipt(fakeDeposit()).evidenceHash);
    // …but volatile state IS still exported, outside the digest.
    expect(depositReceipt(settled).state.txHash).toBe('0xabc');
  });

  it('pins the lock-or-refund promise into the terms (fixed rateType + minOut)', () => {
    const receipt = depositReceipt(fakeDeposit());
    expect(receipt.terms.rateType).toBe('fixed');
    expect(receipt.terms.minReceiveAmount).toBe('3290000000');
    // Any single byte of the terms moving changes the digest.
    const tampered = depositReceipt({ ...fakeDeposit(), minReceiveAmount: '3290000001' });
    expect(tampered.evidenceHash).not.toBe(receipt.evidenceHash);
  });
});
