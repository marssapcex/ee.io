import { describe, expect, it } from 'vitest';
import { buildExecutionPlan } from '../server/executionPlanner';
import { buildQuote } from '../server/quoteEngine';

/**
 * Calldata honesty: with EE_FORCE_SIMULATION=1 every quote is simulated, so an
 * EVM plan's calldata is a server-encoded PREVIEW. It must be flagged
 * `executable: false` — the pre-audit code let a live-sourced quote carry
 * fabricated calldata into an enabled "Sign & broadcast" button.
 */
describe('execution plan — calldata honesty', () => {
  it('marks same-chain EVM preview calldata as NOT executable', async () => {
    const quoteRes = await buildQuote({
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      amount: (10n ** 18n).toString(),
      side: 'send',
      rateType: 'float',
      destinationAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    });
    const quote = quoteRes.best!;
    expect(quote).toBeDefined();

    const plan = await buildExecutionPlan({
      quote,
      fromAssetId: 'ETH.ETHEREUM',
      toAssetId: 'USDC.ETHEREUM',
      sendAmount: quoteRes.sendAmount,
      destinationAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      slippageBps: 75,
      expiresAt: quoteRes.expiresAt,
      rateType: 'float' as const,
    });

    expect(plan.transaction.kind).toBe('evm');
    if (plan.transaction.kind === 'evm') {
      expect(plan.transaction.executable).toBe(false);
      expect(plan.transaction.data).toMatch(/^0x/);
    }
  });

  it('THORChain cross-chain plan is a deposit plan with memo, not EVM calldata', async () => {
    const quoteRes = await buildQuote({
      fromAssetId: 'BTC.BITCOIN',
      toAssetId: 'ETH.ETHEREUM',
      amount: '1000000', // 0.01 BTC
      side: 'send',
      rateType: 'float',
      destinationAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    });
    const thor = quoteRes.quotes.find((q) => q.aggregator === 'thorchain' && !q.unavailableReason);
    expect(thor).toBeDefined();

    const plan = await buildExecutionPlan({
      quote: thor!,
      fromAssetId: 'BTC.BITCOIN',
      toAssetId: 'ETH.ETHEREUM',
      sendAmount: quoteRes.sendAmount,
      destinationAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      slippageBps: 75,
      expiresAt: quoteRes.expiresAt,
      rateType: 'float' as const,
    });

    expect(plan.transaction.kind).toBe('deposit');
    if (plan.transaction.kind === 'deposit') {
      expect(plan.transaction.memo).toBeTruthy();
    }
  });
});
