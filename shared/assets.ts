/**
 * Asset registry.
 *
 * Contract addresses are real mainnet addresses — they are what gets sent to
 * the aggregator APIs as sellToken/buyToken, so a wrong value here means a
 * wrong (or failing) swap.
 *
 * The EVM "native" sentinel 0xEeee…EEeE is the convention used by 0x,
 * KyberSwap, 1inch and OpenOcean to mean "the chain's gas token".
 */

import type { AddressValidator } from './address.js';
import {
  validateBitcoinAddress,
  validateBitcoinCashAddress,
  validateCosmosAddress,
  validateDogecoinAddress,
  validateEvmAddress,
  validateLitecoinAddress,
  validateMoneroAddress,
  validateRippleAddress,
  validateSolanaAddress,
  validateTronAddress,
} from './address.js';
import { CHAINS, type ChainId, type ChainInfo } from './chains.js';

/** The sentinel address every major EVM aggregator uses for the gas token. */
export const NATIVE_EVM_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export interface Asset {
  /** Stable unique key: `SYMBOL.CHAIN`. */
  id: string;
  symbol: string;
  name: string;
  chain: ChainId;
  decimals: number;
  /** Contract/mint address. Undefined for native UTXO/Monero/XRP assets. */
  address?: string;
  /** THORChain asset notation, when the asset is routable over THORChain. */
  thorchainAsset?: string;
  /** Brand colour used by the generated coin icon. */
  color: string;
  /** Secondary colour for the icon gradient. */
  colorTo: string;
  /** Rough USD reference price — refreshed at runtime by the price oracle. */
  referenceUsd: number;
  addressPlaceholder: string;
  validate: AddressValidator;
  /** Minimum swap size in USD; converted to token units at quote time. */
  minUsd: number;
  maxUsd: number;
  /** True for assets whose value should track $1. */
  stable?: boolean;
  popular?: boolean;
}

const evm = (
  symbol: string,
  name: string,
  chain: ChainId,
  decimals: number,
  address: string,
  extra: Partial<Asset> = {},
): Asset => ({
  id: `${symbol}.${CHAINS[chain].id.toUpperCase()}`,
  symbol,
  name,
  chain,
  decimals,
  address,
  color: '#627eea',
  colorTo: '#8ba3f5',
  referenceUsd: 1,
  addressPlaceholder: '0x…',
  validate: validateEvmAddress,
  minUsd: 20,
  maxUsd: 250_000,
  ...extra,
});

export const ASSETS: Asset[] = [
  /* ---------------------------------------------------------- native L1s */
  {
    id: 'BTC.BITCOIN',
    symbol: 'BTC',
    name: 'Bitcoin',
    chain: 'bitcoin',
    decimals: 8,
    thorchainAsset: 'BTC.BTC',
    color: '#f7931a',
    colorTo: '#ffb74d',
    referenceUsd: 97_400,
    addressPlaceholder: 'bc1q… or 1… / 3…',
    validate: validateBitcoinAddress,
    minUsd: 25,
    maxUsd: 400_000,
    popular: true,
  },
  {
    id: 'ETH.ETHEREUM',
    symbol: 'ETH',
    name: 'Ethereum',
    chain: 'ethereum',
    decimals: 18,
    address: NATIVE_EVM_SENTINEL,
    thorchainAsset: 'ETH.ETH',
    color: '#627eea',
    colorTo: '#98aef7',
    referenceUsd: 3_420,
    addressPlaceholder: '0x…',
    validate: validateEvmAddress,
    minUsd: 20,
    maxUsd: 400_000,
    popular: true,
  },
  {
    id: 'XMR.MONERO',
    symbol: 'XMR',
    name: 'Monero',
    chain: 'monero',
    decimals: 12,
    color: '#ff6600',
    colorTo: '#ff9955',
    referenceUsd: 215,
    addressPlaceholder: '4… or 8…',
    validate: validateMoneroAddress,
    minUsd: 30,
    maxUsd: 80_000,
    popular: true,
  },
  {
    id: 'SOL.SOLANA',
    symbol: 'SOL',
    name: 'Solana',
    chain: 'solana',
    decimals: 9,
    address: 'So11111111111111111111111111111111111111112',
    color: '#14f195',
    colorTo: '#9945ff',
    referenceUsd: 198,
    addressPlaceholder: 'Base58 public key',
    validate: validateSolanaAddress,
    minUsd: 15,
    maxUsd: 200_000,
    popular: true,
  },
  {
    id: 'LTC.LITECOIN',
    symbol: 'LTC',
    name: 'Litecoin',
    chain: 'litecoin',
    decimals: 8,
    thorchainAsset: 'LTC.LTC',
    color: '#a6a9aa',
    colorTo: '#d3d5d6',
    referenceUsd: 103,
    addressPlaceholder: 'ltc1… or L…',
    validate: validateLitecoinAddress,
    minUsd: 25,
    maxUsd: 100_000,
  },
  {
    id: 'DOGE.DOGECOIN',
    symbol: 'DOGE',
    name: 'Dogecoin',
    chain: 'dogecoin',
    decimals: 8,
    thorchainAsset: 'DOGE.DOGE',
    color: '#c2a633',
    colorTo: '#e3cc6a',
    referenceUsd: 0.38,
    addressPlaceholder: 'D…',
    validate: validateDogecoinAddress,
    minUsd: 25,
    maxUsd: 100_000,
  },
  {
    id: 'BCH.BITCOINCASH',
    symbol: 'BCH',
    name: 'Bitcoin Cash',
    chain: 'bitcoincash',
    decimals: 8,
    thorchainAsset: 'BCH.BCH',
    color: '#8dc351',
    colorTo: '#b3dd8a',
    referenceUsd: 455,
    addressPlaceholder: 'q… (CashAddr)',
    validate: validateBitcoinCashAddress,
    minUsd: 25,
    maxUsd: 100_000,
  },
  {
    id: 'RUNE.THORCHAIN',
    symbol: 'RUNE',
    name: 'THORChain',
    chain: 'thorchain',
    decimals: 8,
    thorchainAsset: 'THOR.RUNE',
    color: '#00ccff',
    colorTo: '#33e0ff',
    referenceUsd: 1.42,
    addressPlaceholder: 'thor1…',
    validate: validateCosmosAddress('thor'),
    minUsd: 20,
    maxUsd: 100_000,
  },
  {
    id: 'ATOM.COSMOS',
    symbol: 'ATOM',
    name: 'Cosmos Hub',
    chain: 'cosmos',
    decimals: 6,
    thorchainAsset: 'GAIA.ATOM',
    color: '#5064fb',
    colorTo: '#8492fc',
    referenceUsd: 4.35,
    addressPlaceholder: 'cosmos1…',
    validate: validateCosmosAddress('cosmos'),
    minUsd: 20,
    maxUsd: 60_000,
  },
  {
    id: 'XRP.RIPPLE',
    symbol: 'XRP',
    name: 'XRP',
    chain: 'ripple',
    decimals: 6,
    thorchainAsset: 'XRP.XRP',
    color: '#23292f',
    colorTo: '#5b6570',
    referenceUsd: 2.18,
    addressPlaceholder: 'r…',
    validate: validateRippleAddress,
    minUsd: 20,
    maxUsd: 100_000,
  },
  {
    id: 'TRX.TRON',
    symbol: 'TRX',
    name: 'TRON',
    chain: 'tron',
    decimals: 6,
    color: '#eb0029',
    colorTo: '#f5566f',
    referenceUsd: 0.26,
    addressPlaceholder: 'T…',
    validate: validateTronAddress,
    minUsd: 15,
    maxUsd: 100_000,
  },

  /* ------------------------------------------------------- Ethereum ERC-20 */
  evm('USDT', 'Tether USD', 'ethereum', 6, '0xdAC17F958D2ee523a2206206994597C13D831ec7', {
    thorchainAsset: 'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7',
    color: '#26a17b',
    colorTo: '#4fd1a5',
    referenceUsd: 1,
    stable: true,
    popular: true,
    minUsd: 20,
    maxUsd: 500_000,
  }),
  evm('USDC', 'USD Coin', 'ethereum', 6, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', {
    thorchainAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
    color: '#2775ca',
    colorTo: '#5b9ae8',
    referenceUsd: 1,
    stable: true,
    popular: true,
    minUsd: 20,
    maxUsd: 500_000,
  }),
  evm('DAI', 'Dai Stablecoin', 'ethereum', 18, '0x6B175474E89094C44Da98b954EedeAC495271d0F', {
    color: '#f5ac37',
    colorTo: '#f8c877',
    referenceUsd: 1,
    stable: true,
  }),
  evm('WBTC', 'Wrapped Bitcoin', 'ethereum', 8, '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', {
    color: '#f09242',
    colorTo: '#f7b478',
    referenceUsd: 97_300,
    minUsd: 25,
  }),
  evm('WETH', 'Wrapped Ether', 'ethereum', 18, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', {
    color: '#ec4899',
    colorTo: '#f9a8d4',
    referenceUsd: 3_420,
  }),
  evm('LINK', 'Chainlink', 'ethereum', 18, '0x514910771AF9Ca656af840dff83E8264EcF986CA', {
    color: '#2a5ada',
    colorTo: '#6b8ee8',
    referenceUsd: 22.4,
  }),
  evm('UNI', 'Uniswap', 'ethereum', 18, '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', {
    color: '#ff007a',
    colorTo: '#ff5ba7',
    referenceUsd: 13.6,
  }),
  evm('AAVE', 'Aave', 'ethereum', 18, '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', {
    color: '#b6509e',
    colorTo: '#d183c2',
    referenceUsd: 276,
  }),
  evm('PEPE', 'Pepe', 'ethereum', 18, '0x6982508145454Ce325dDbE47a25d4ec3d2311933', {
    color: '#4caf50',
    colorTo: '#81c784',
    referenceUsd: 0.0000187,
  }),
  evm('SHIB', 'Shiba Inu', 'ethereum', 18, '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', {
    color: '#ffa409',
    colorTo: '#ffc65c',
    referenceUsd: 0.0000223,
  }),

  /* ------------------------------------------------------------ BNB Chain */
  {
    ...evm('BNB', 'BNB', 'bsc', 18, NATIVE_EVM_SENTINEL, {
      thorchainAsset: 'BSC.BNB',
      color: '#f3ba2f',
      colorTo: '#f8d377',
      referenceUsd: 695,
      popular: true,
    }),
  },
  evm('USDT', 'Tether USD', 'bsc', 18, '0x55d398326f99059fF775485246999027B3197955', {
    color: '#26a17b',
    colorTo: '#4fd1a5',
    referenceUsd: 1,
    stable: true,
  }),
  evm('CAKE', 'PancakeSwap', 'bsc', 18, '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', {
    color: '#d1884f',
    colorTo: '#e3ab80',
    referenceUsd: 2.45,
  }),

  /* -------------------------------------------------------------- Polygon */
  evm('POL', 'Polygon', 'polygon', 18, NATIVE_EVM_SENTINEL, {
    thorchainAsset: 'POL.POL',
    color: '#8247e5',
    colorTo: '#a97aef',
    referenceUsd: 0.42,
  }),
  evm('USDC', 'USD Coin', 'polygon', 6, '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', {
    color: '#2775ca',
    colorTo: '#5b9ae8',
    referenceUsd: 1,
    stable: true,
  }),

  /* ------------------------------------------------------------ Arbitrum */
  evm('ETH', 'Ethereum (Arbitrum)', 'arbitrum', 18, NATIVE_EVM_SENTINEL, {
    thorchainAsset: 'ARB.ETH',
    color: '#28a0f0',
    colorTo: '#6dc0f6',
    referenceUsd: 3_420,
  }),
  evm('ARB', 'Arbitrum', 'arbitrum', 18, '0x912CE59144191C1204E64559FE8253a0e49E6548', {
    color: '#12aaff',
    colorTo: '#5cc6ff',
    referenceUsd: 0.68,
  }),
  evm('USDC', 'USD Coin', 'arbitrum', 6, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', {
    color: '#2775ca',
    colorTo: '#5b9ae8',
    referenceUsd: 1,
    stable: true,
  }),

  /* ---------------------------------------------------------------- Base */
  evm('ETH', 'Ethereum (Base)', 'base', 18, NATIVE_EVM_SENTINEL, {
    thorchainAsset: 'BASE.ETH',
    color: '#0052ff',
    colorTo: '#4d87ff',
    referenceUsd: 3_420,
    popular: true,
  }),
  evm('USDC', 'USD Coin', 'base', 6, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', {
    thorchainAsset: 'BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913',
    color: '#2775ca',
    colorTo: '#5b9ae8',
    referenceUsd: 1,
    stable: true,
    popular: true,
  }),

  /* ------------------------------------------------------------ Optimism */
  evm('ETH', 'Ethereum (OP)', 'optimism', 18, NATIVE_EVM_SENTINEL, {
    color: '#ff0420',
    colorTo: '#ff5c70',
    referenceUsd: 3_420,
  }),
  evm('OP', 'Optimism', 'optimism', 18, '0x4200000000000000000000000000000000000042', {
    color: '#ff0420',
    colorTo: '#ff5c70',
    referenceUsd: 1.62,
  }),

  /* ----------------------------------------------------------- Avalanche */
  evm('AVAX', 'Avalanche', 'avalanche', 18, NATIVE_EVM_SENTINEL, {
    thorchainAsset: 'AVAX.AVAX',
    color: '#e84142',
    colorTo: '#f07f80',
    referenceUsd: 38.2,
  }),

  /* ---------------------------------------------------------- Solana SPL */
  {
    id: 'USDC.SOLANA',
    symbol: 'USDC',
    name: 'USD Coin (Solana)',
    chain: 'solana',
    decimals: 6,
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    color: '#2775ca',
    colorTo: '#5b9ae8',
    referenceUsd: 1,
    addressPlaceholder: 'Base58 public key',
    validate: validateSolanaAddress,
    minUsd: 15,
    maxUsd: 300_000,
    stable: true,
  },
  {
    id: 'JUP.SOLANA',
    symbol: 'JUP',
    name: 'Jupiter',
    chain: 'solana',
    decimals: 6,
    address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    color: '#c7f284',
    colorTo: '#e0f8b8',
    referenceUsd: 0.86,
    addressPlaceholder: 'Base58 public key',
    validate: validateSolanaAddress,
    minUsd: 15,
    maxUsd: 100_000,
  },

  /* ------------------------------------------------------------ TRON TRC */
  {
    id: 'USDT.TRON',
    symbol: 'USDT',
    name: 'Tether USD (TRC-20)',
    chain: 'tron',
    decimals: 6,
    address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    color: '#26a17b',
    colorTo: '#4fd1a5',
    referenceUsd: 1,
    addressPlaceholder: 'T…',
    validate: validateTronAddress,
    minUsd: 15,
    maxUsd: 500_000,
    stable: true,
    popular: true,
  },
];

const ASSET_BY_ID = new Map(ASSETS.map((a) => [a.id, a]));

export function getAsset(id: string): Asset | undefined {
  return ASSET_BY_ID.get(id);
}

export function requireAsset(id: string): Asset {
  const asset = ASSET_BY_ID.get(id);
  if (!asset) throw new Error(`Unknown asset: ${id}`);
  return asset;
}

export function assetChain(asset: Asset): ChainInfo {
  return CHAINS[asset.chain];
}

export function isEvmAsset(asset: Asset): boolean {
  return CHAINS[asset.chain].kind === 'evm';
}

export function isNativeEvm(asset: Asset): boolean {
  return isEvmAsset(asset) && asset.address?.toLowerCase() === NATIVE_EVM_SENTINEL.toLowerCase();
}

/** Assets THORChain can route natively (has an asset notation string). */
export function isThorchainRoutable(asset: Asset): boolean {
  return Boolean(asset.thorchainAsset);
}

export function searchAssets(query: string): Asset[] {
  const q = query.trim().toLowerCase();
  if (!q) return ASSETS;
  return ASSETS.filter((a) => {
    const chain = CHAINS[a.chain];
    return (
      a.symbol.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      chain.name.toLowerCase().includes(q) ||
      a.address?.toLowerCase() === q
    );
  });
}
