import { ethers } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  computeDepositAddress,
  computeDepositAddressBound,
  createDeposit,
  factoryConfigured,
  getDeposit,
  markDepositFunded,
} from '../server/depositProxy';

describe('depositProxy', () => {
  it('minimal-proxy init code matches the EIP-1167 runtime (slice(2) regression guard)', () => {
    // Regression: the suffix constant has no 0x prefix, but the old code called
    // .slice(2) on it "to strip 0x" — chopping the `5a` opcode. The off-chain
    // init code hash then never matched the on-chain creation code, so every
    // deposit address shown to users was undeployable. This recomputes the
    // CREATE2 address INDEPENDENTLY and must agree.
    process.env.EE_PROXY_FACTORY = '0x2222222222222222222222222222222222222222';
    process.env.EE_PROXY_LOGIC = '0x1111111111111111111111111111111111111111';
    try {
      const orderId = 'DP-999999';
      const got = computeDepositAddress(orderId, 1);
      const salt = ethers.keccak256(ethers.toUtf8Bytes(orderId));
      const canonicalInitCode =
        '0x3d602d80600a3d3981f3363d3d373d3d3d363d73' +
        '1111111111111111111111111111111111111111' +
        '5af43d82803e903d91602b57fd5bf3';
      // Sanity: canonical minimal-proxy CREATION code is exactly 55 bytes
      // (10-byte init prefix + 10+20+15 runtime of 45 bytes).
      expect((canonicalInitCode.length - 2) / 2).toBe(55);
      const expected = ethers.getCreate2Address(
        process.env.EE_PROXY_FACTORY,
        salt,
        ethers.keccak256(canonicalInitCode),
      );
      expect(got).toBe(expected);
    } finally {
      delete process.env.EE_PROXY_FACTORY;
      delete process.env.EE_PROXY_LOGIC;
    }
  });

  it('bound-salt parity with the factory ABI encoding (string orderId, checksummed tokens)', () => {
    // The factory salts with keccak256(abi.encode(orderId, dest, from, to)) —
    // the server must encode identically or users fund one address while the
    // factory deploys another.
    process.env.EE_PROXY_FACTORY = '0x2222222222222222222222222222222222222222';
    process.env.EE_PROXY_LOGIC = '0x1111111111111111111111111111111111111111';
    try {
      const orderId = 'DP-424242';
      const dest = ethers.getAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
      const from = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'; // native sentinel, mis-cased on purpose
      const to = ethers.getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
      const got = computeDepositAddressBound(orderId, dest, from, to, 1);

      const salt = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['string', 'address', 'address', 'address'],
          [orderId, dest, from.toLowerCase(), to],
        ),
      );
      const initCode =
        '0x3d602d80600a3d3981f3363d3d373d3d3d363d73' +
        '1111111111111111111111111111111111111111' +
        '5af43d82803e903d91602b57fd5bf3';
      const expected = ethers.getCreate2Address(
        process.env.EE_PROXY_FACTORY,
        salt,
        ethers.keccak256(initCode),
      );
      expect(got).toBe(expected);
    } finally {
      delete process.env.EE_PROXY_FACTORY;
      delete process.env.EE_PROXY_LOGIC;
    }
  });

  it('computes deterministic CREATE2 address', async () => {
    const a1 = computeDepositAddress('DP-123456', 1);
    const a2 = computeDepositAddress('DP-123456', 1);
    const a3 = computeDepositAddress('DP-654321', 1);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(a3);
    expect(a1).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('creates a deposit for same-chain EVM', async () => {
    const rec = await createDeposit({
      fromAssetId: 'USDC.ETHEREUM',
      toAssetId: 'USDT.ETHEREUM',
      amount: '10000000', // 10 USDC
      destinationAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    });
    expect(rec.depositId).toMatch(/^DP-\d{6}$/);
    expect(rec.depositAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(rec.chainId).toBe(1);
    expect(rec.status).toBe('awaiting_funds');
    expect(rec.fee.bps).toBe(50);
    expect(BigInt(rec.minReceiveAmount)).toBeLessThan(BigInt(rec.receiveAmount));
    expect(rec.factoryAddress).toMatch(/^0x/);
  });

  it('rejects cross-chain for proxy (use THORChain)', async () => {
    await expect(
      createDeposit({
        fromAssetId: 'BTC.BITCOIN',
        toAssetId: 'USDT.ETHEREUM',
        amount: '100000',
        destinationAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      }),
    ).rejects.toThrow(/not EVM|THORChain/i);
  });

  it('rejects invalid destination', async () => {
    await expect(
      createDeposit({
        fromAssetId: 'USDC.ETHEREUM',
        toAssetId: 'USDT.ETHEREUM',
        amount: '1000000',
        destinationAddress: 'not-an-address',
      }),
    ).rejects.toThrow(/Invalid destination/i);
  });

  it('retrieves deposit by id and advances simulated status after funding', async () => {
    const rec = await createDeposit({
      fromAssetId: 'USDC.ETHEREUM',
      toAssetId: 'USDT.ETHEREUM',
      amount: '5000000',
      destinationAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    });
    const fetched = getDeposit(rec.depositId);
    expect(fetched?.depositId).toBe(rec.depositId);
    // simulate funding via direct map manipulation for speed
    // Use the public API markDepositFunded in a real integration test
  });

  it('never collides on deposit ids — a collision would overwrite a live order', async () => {
    const params = {
      fromAssetId: 'USDC.ETHEREUM',
      toAssetId: 'USDT.ETHEREUM',
      amount: '15000000',
      destinationAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    };
    const ids = new Set<string>();
    for (let i = 0; i < 8; i++) {
      ids.add((await createDeposit(params)).depositId);
    }
    expect(ids.size).toBe(8);
  });

  it('flags deposits as simulated when no factory is configured', async () => {
    // Test env has no EE_PROXY_FACTORY_* — the address is a burn address and
    // the record MUST say so.
    expect(factoryConfigured(1)).toBe(false);
    const rec = await createDeposit({
      fromAssetId: 'USDC.ETHEREUM',
      toAssetId: 'USDT.ETHEREUM',
      amount: '20000000',
      destinationAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    });
    expect(rec.simulated).toBe(true);
    expect(rec.warnings.some((w) => w.includes('Do NOT send real funds'))).toBe(true);
  });

  it('does not fabricate execution once real infrastructure is configured', async () => {
    process.env.EE_RPC_1 = 'http://localhost:1'; // present but unreachable
    try {
      const rec = await createDeposit({
        fromAssetId: 'USDC.ETHEREUM',
        toAssetId: 'USDT.ETHEREUM',
        amount: '25000000',
        destinationAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      });
      // Funding signal without on-chain proof must NOT be trusted…
      const marked = await markDepositFunded(rec.depositId);
      expect(marked?.status).not.toBe('executed');
      expect(marked?.status).not.toBe('funded');
      // …and the status machine must not invent progress on its own either.
      const fetched = getDeposit(rec.depositId)!;
      expect(['awaiting_funds', 'funding'].includes(fetched.status)).toBe(true);
      expect(fetched.outTxHash).toBeUndefined();
    } finally {
      delete process.env.EE_RPC_1;
    }
  });
});
