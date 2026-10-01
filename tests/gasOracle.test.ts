import { afterEach, describe, expect, it } from 'vitest';
import { requireAsset } from '../shared/assets';
import {
  __resetGasOracle,
  chainGasUsd,
  nativeUsdPriceForChain,
  rpcForChain,
  STATIC_GAS_USD,
} from '../server/gasOracle';

const priceOf = (asset: { id: string; referenceUsd: number }) => {
  const resolved = requireAsset(asset.id) as unknown as { referenceUsd: number };
  return resolved.referenceUsd;
};

describe('gasOracle', () => {
  afterEach(() => {
    delete process.env.EE_RPC_ETHEREUM;
    delete process.env.EE_RPC_SOLANA;
    __resetGasOracle();
  });

  it('resolves the chain-native price — BNB gas is not priced in ETH dollars', () => {
    const bnb = nativeUsdPriceForChain('bsc', (a) => priceOf(a));
    const eth = nativeUsdPriceForChain('ethereum', (a) => priceOf(a));
    expect(bnb).toBeGreaterThan(100);
    expect(eth).toBeGreaterThan(1000);
    expect(bnb).toBeLessThan(eth);

    // UTXO chains too — the chain has exactly one native listing.
    const btc = nativeUsdPriceForChain('bitcoin', (a) => priceOf(a));
    expect(btc).toBeGreaterThan(10_000);
  });

  it('falls back to the static table when no RPC is configured', async () => {
    const price = nativeUsdPriceForChain('ethereum', (a) => priceOf(a));
    const usd = await chainGasUsd('ethereum', price);
    expect(usd).toBe(STATIC_GAS_USD.ethereum);
  });

  it('falls back cleanly when the configured RPC is unreachable', async () => {
    // Connection refused on purpose — a dead RPC must never surface to quoting.
    process.env.EE_RPC_ETHEREUM = 'http://127.0.0.1:9';
    expect(rpcForChain('ethereum')).toBe('http://127.0.0.1:9');
    const price = nativeUsdPriceForChain('ethereum', (a) => priceOf(a));
    const usd = await chainGasUsd('ethereum', price);
    expect(usd).toBe(STATIC_GAS_USD.ethereum);
  });

  it('uses the static table for non-EVM chains regardless of RPC config', async () => {
    process.env.EE_RPC_SOLANA = 'http://127.0.0.1:9';
    const price = nativeUsdPriceForChain('solana', (a) => priceOf(a));
    const usd = await chainGasUsd('solana', price);
    expect(usd).toBe(STATIC_GAS_USD.solana);
  });

  it('maps env var names correctly', () => {
    expect(rpcForChain('ethereum')).toBeUndefined();
    process.env.EE_RPC_ETHEREUM = 'https://mainnet.example/rpc';
    expect(rpcForChain('ethereum')).toBe('https://mainnet.example/rpc');
  });
});
