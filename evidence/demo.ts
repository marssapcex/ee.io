/**
 * evidence/demo.ts — end-to-end walk of one fulfilled agent task:
 * x402 payment -> artifact delivery -> verdict -> chained receipts ->
 * third-party audit -> grounded ERC-8004 feedback payload.
 * Run: npm run demo:evidence
 */
import { makeReceipt } from './keccakChain.js';
import { verifyChain, verifyPaymentLeg, verifyDeliveryLeg, type PaymentProvider } from './verify.js';
import { toErc8004Feedback, robustSummary } from './erc8004.js';
import { keccakHex } from './keccakChain.js';
import type { ReceiptCore } from './types.js';

const provider: PaymentProvider = {
  fetchPayment: async () => ({
    chainId: 8453,
    txHash: '0x' + 'aa'.repeat(32),
    from: '0xAGENT00000000000000000000000000000000001',
    to: '0xSERVICE000000000000000000000000000000002',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    amount: '250000',
    settled: true,
  }),
};

function task(n: number, artifact: string): ReceiptCore {
  return {
    v: 1,
    agentId: 'eip155:1:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:22',
    taskId: `quote-${n}`,
    payment: {
      scheme: 'exact',
      chainId: 8453,
      txHash: '0x' + 'aa'.repeat(32),
      from: '0xAGENT00000000000000000000000000000000001',
      to: '0xSERVICE000000000000000000000000000000002',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount: '250000',
      facilitator: 'facilitator.coinbase.example',
      verified: true,
    },
    delivery: {
      artifactHash: keccakHex(new TextEncoder().encode(artifact)),
      artifactURI: `ipfs://bafy-artifact-${n}`,
      method: 'hash-commit',
      deliveredAt: Math.floor(Date.now() / 1000),
    },
    verdict: { score: n === 3 ? 90 : 100, validator: '0x' + 'bb'.repeat(20) as '0x' },
    ts: Math.floor(Date.now() / 1000),
  };
}

export async function runDemo() {
  const artifacts = ['price-BTC/USD=61,240.12@t', 'price-ETH/USD=3,412.55@t', 'price-BNB/USD=590.20@t'];
  // build sequentially so each receipt links to the previous one
  const chain = [];
  for (let i = 0; i < artifacts.length; i++) {
    const r = makeReceipt(task(i + 1, artifacts[i]), chain[chain.length - 1]?.receiptHash);
    chain.push(r);
  }

  const audit = verifyChain(chain);
  const latest = chain[chain.length - 1];
  const payment = await verifyPaymentLeg(latest.payment, provider);
  const delivery = verifyDeliveryLeg(latest.delivery, new TextEncoder().encode(artifacts[2]));
  const feedback = toErc8004Feedback(latest, 'ipfs://bafy-receipt-3.json');
  const historicalScores = chain.map((r) => r.verdict.score);
  const summary = robustSummary(historicalScores);

  console.log(JSON.stringify({ audit, payment: payment.ok, delivery: delivery.ok, feedback, summary }, null, 2));
}

const invoked = process.argv[1]?.endsWith('demo.ts');
if (invoked) runDemo();
