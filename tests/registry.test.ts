import { describe, expect, it } from 'vitest';
import { getAddress } from 'ethers';
import { ADAPTERS } from '../server/quoteEngine';
import { COINGECKO_IDS } from '../server/prices';
import {
  ASSETS,
  isEvmAsset,
  isThorchainRoutable,
  NATIVE_EVM_SENTINEL,
  type Asset,
} from '../shared/assets';
import { CHAINS } from '../shared/chains';

/**
 * Registry integrity gate.
 *
 * With ~80 assets and more added every release, a single fat-fingered
 * contract address or wrong decimals silently turns into failing swaps or
 * misprinted amounts. Schema-level checks live here instead of eyeballs.
 */

const THOR_CHAIN_PREFIX: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  bsc: 'BSC',
  avalanche: 'AVAX',
  base: 'BASE',
  litecoin: 'LTC',
  dogecoin: 'DOGE',
  bitcoincash: 'BCH',
  thorchain: 'THOR',
  cosmos: 'GAIA',
  ripple: 'XRP',
};

/**
 * Assets with a chain listed but no upstream venue that serves them TODAY.
 * Tron entries exist so the picker can render the chain; nothing routes them
 * (no THOR pool, no EVM adapter covers kind:'tron'). The whitelist makes that
 * gap explicit and visible in CI rather than a slow surprise.
 */
const KNOWN_ORPHAN_ASSETS: string[] = ['TRX.TRON', 'USDT.TRON', 'XMR.MONERO'];

describe('asset registry integrity', () => {
  it('has a substantial catalogue after the expansion', () => {
    expect(ASSETS.length).toBeGreaterThan(60);
  });

  it('every id is unique and matches SYMBOL.CHAINID', () => {
    const ids = new Set<string>();
    for (const asset of ASSETS) {
      expect(ids.has(asset.id), `duplicate id ${asset.id}`).toBe(false);
      ids.add(asset.id);
      expect(asset.id).toBe(`${asset.symbol}.${CHAINS[asset.chain].id.toUpperCase()}`);
    }
  });

  it('EVM contract addresses are EIP-55 checksummed (not lowercase paste-ins)', () => {
    for (const asset of ASSETS) {
      if (!isEvmAsset(asset) || !asset.address) continue;
      if (asset.address === NATIVE_EVM_SENTINEL) continue;
      expect(
        getAddress(asset.address),
        `${asset.id} is not checksummed — encode it with getAddress()`,
      ).toBe(asset.address);
    }
  });

  it('decimals stay within ERC20 plausibility and stables are flagged', () => {
    for (const asset of ASSETS) {
      expect(asset.decimals, asset.id).toBeGreaterThanOrEqual(0);
      expect(asset.decimals, asset.id).toBeLessThanOrEqual(18);
      if (['USDT', 'USDC', 'DAI', 'USDBC'].includes(asset.symbol)) {
        expect(asset.stable, `${asset.id} should be stable:true`).toBe(true);
      }
      expect(asset.referenceUsd, asset.id).toBeGreaterThan(0);
      expect(asset.minUsd, asset.id).toBeLessThan(asset.maxUsd);
      expect(asset.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(asset.colorTo).toMatch(/^#[0-9a-f]{6}$/i);
      expect(asset.addressPlaceholder.length).toBeGreaterThan(0);
    }
  });

  it('THORChain notations are well-formed, on a supported chain, and self-consistent', () => {
    for (const asset of ASSETS.filter(isThorchainRoutable)) {
      const tag = asset.thorchainAsset!;
      const prefix = THOR_CHAIN_PREFIX[asset.chain];
      expect(prefix, `${asset.id}: ${asset.chain} has no THORChain support — drop the tag`).toBeDefined();
      expect(tag.startsWith(`${prefix}.`), `${asset.id}: ${tag}`).toBe(true);
      // EVM pools carry the contract address in the tag, upper-cased.
      if (isEvmAsset(asset) && asset.address && asset.address !== NATIVE_EVM_SENTINEL) {
        const suffix = tag.split('-')[1] ?? '';
        if (suffix) {
          expect(suffix.toLowerCase()).toBe(asset.address.toLowerCase());
        }
      }
    }
  });

  it('every non-stable symbol has a CoinGecko id, with no orphan keys', () => {
    const symbols = new Set(ASSETS.map((a) => a.symbol));
    for (const asset of ASSETS) {
      if (asset.stable) continue;
      expect(
        COINGECKO_IDS[asset.symbol],
        `${asset.symbol} has no live price mapping`,
      ).toBeDefined();
    }
    for (const symbol of Object.keys(COINGECKO_IDS)) {
      expect(symbols.has(symbol), `COINGECKO_IDS.${symbol} maps an asset that no longer exists`).toBe(true);
    }
  });

  it('every asset can actually be routed by at least one venue (pair probes)', () => {
    for (const asset of ASSETS) {
      if (KNOWN_ORPHAN_ASSETS.includes(asset.id)) continue;
      const routable = ASSETS.some(
        (other) => other.id !== asset.id && canPair(asset, other),
      );
      expect(routable, `${asset.id} is unrouteable on every venue — dead entry`).toBe(true);
    }
  });

  it('thorchain bondage: every tagged asset pairs with RUNE or a UTXO major', () => {
    const rune = ASSETS.find((a) => a.id === 'RUNE.THORCHAIN')!;
    const btc = ASSETS.find((a) => a.id === 'BTC.BITCOIN')!;
    for (const asset of ASSETS.filter(isThorchainRoutable)) {
      const viaRun = ADAPTERS.find((a) => a.id === 'thorchain')!.supports(
        asset,
        asset.id === 'BTC.BITCOIN' ? rune : btc,
      );
      expect(viaRun.ok, `${asset.id} should probe against THORChain`).toBe(true);
    }
  });

  it('deprecated THORChain claims stay deleted (case sensitivity: POL/ARB)', () => {
    expect(ASSETS.find((a) => a.id === 'POL.POLYGON')?.thorchainAsset).toBeUndefined();
    expect(ASSETS.find((a) => a.id === 'ETH.ARBITRUM')?.thorchainAsset).toBeUndefined();
    expect(ASSETS.find((a) => a.id === 'ARB.ARBITRUM')?.thorchainAsset).toBeUndefined();
  });
});

function canPair(from: Asset, to: Asset): boolean {
  return ADAPTERS.some((adapter) => adapter.supports(from, to).ok);
}
