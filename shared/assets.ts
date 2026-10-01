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
    // v0.4 demoted from `popular`: no integrated venue can route XMR
    // (no THORChain pool, no DEX aggregator on Monero) — kept for
    // address validation until an adapter lands.
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
    // v0.4: unrouteable today (no adapter covers chain 'tron'; no
    // THORChain pool) — kept for validation only, never promoted.
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
    // THORChain lists a DAI pool on Ethereum; the notation suffix is the
    // checksummed address rendered upper-case, per their convention.
    thorchainAsset: 'ETH.DAI-0X6B175474E89094C44DA98B954EEDEAC495271D0F',
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
  evm('MKR', 'Maker', 'ethereum', 18, '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', {
    color: '#1aab9b',
    colorTo: '#57d2c3',
    referenceUsd: 1_450,
  }),
  evm('LDO', 'Lido DAO', 'ethereum', 18, '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', {
    color: '#00a3ff',
    colorTo: '#7acaff',
    referenceUsd: 1.1,
  }),
  evm('STETH', 'Lido Staked Ether', 'ethereum', 18, '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', {
    color: '#00a3ff',
    colorTo: '#9fd6ff',
    referenceUsd: 3_400,
    popular: true,
  }),
  evm('CRV', 'Curve DAO', 'ethereum', 18, '0xD533a949740bb3306d119CC777fa900bA034cd52', {
    color: '#3997ff',
    colorTo: '#7abcff',
    referenceUsd: 0.28,
  }),
  evm('ENS', 'Ethereum Name Service', 'ethereum', 18, '0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72', {
    color: '#5298ff',
    colorTo: '#8fbcff',
    referenceUsd: 14,
  }),
  evm('APE', 'ApeCoin', 'ethereum', 18, '0x4d224452801ACEd8B2F0aebE155379bb5D594381', {
    color: '#0052f2',
    colorTo: '#5b8cf7',
    referenceUsd: 1.1,
  }),
  evm('FET', 'Fetch.ai', 'ethereum', 18, '0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85', {
    color: '#1b9ad8',
    colorTo: '#6cc5e8',
    referenceUsd: 0.22,
  }),
  evm('RNDR', 'Render (RNDR)', 'ethereum', 18, '0x6De037ef9aD2725EB40118Bb1702EBb27e4Aeb24', {
    color: '#d94a2f',
    colorTo: '#f08a72',
    referenceUsd: 1.7,
  }),
  evm('MANA', 'Decentraland', 'ethereum', 18, '0x0F5D2fB29fb7d3CFeE444a200298f468908cC942', {
    color: '#ff2d55',
    colorTo: '#ff7d97',
    referenceUsd: 0.3,
  }),
  evm('SAND', 'The Sandbox', 'ethereum', 18, '0x3845badAde8e6dFF049820680d1F14bD3903a5d0', {
    color: '#04adef',
    colorTo: '#61cef7',
    referenceUsd: 0.28,
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
    // THORChain's BSC USDT pool — one of its deepest stable pools.
    thorchainAsset: 'BSC.USDT-0X55D398326F99059FF775485246999027B3197955',
    color: '#26a17b',
    colorTo: '#4fd1a5',
    referenceUsd: 1,
    stable: true,
  }),
  evm('USDC', 'USD Coin', 'bsc', 18, '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', {
    color: '#2775ca',
    colorTo: '#5b9ae8',
    referenceUsd: 1,
    stable: true,
  }),
  evm('CAKE', 'PancakeSwap', 'bsc', 18, '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', {
    color: '#d1884f',
    colorTo: '#e3ab80',
    referenceUsd: 2.45,
  }),
  evm('XVS', 'Venus', 'bsc', 18, '0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63', {
    color: '#f7d354',
    colorTo: '#f9e197',
    referenceUsd: 6.4,
  }),

  /* -------------------------------------------------------------- Polygon */
  evm('POL', 'Polygon', 'polygon', 18, NATIVE_EVM_SENTINEL, {
    // FIXED in v0.4: THORChain has no Polygon chain support — we used to tag
    // POL.POL, which silently produced quote failures at execution time.
    // Untagged: the venue check is now honest, POL trades via the EVM
    // aggregators like every other polygon asset.
    color: '#8247e5',
    colorTo: '#a97aef',
    referenceUsd: 0.42,
  }),
  evm('USDC', 'USD Coin', 'polygon', 6, '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', {
    color: '#2775ca',
    colorTo: '#5b9ae8',
    referenceUsd: 1,
    stable: true,
    popular: true,
  }),
  evm('USDT', 'Tether USD', 'polygon', 6, '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', {
    color: '#26a17b',
    colorTo: '#4fd1a5',
    referenceUsd: 1,
    stable: true,
    popular: true,
  }),
  evm('DAI', 'Dai Stablecoin', 'polygon', 18, '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', {
    color: '#f5ac37',
    colorTo: '#f8c877',
    referenceUsd: 1,
    stable: true,
  }),
  evm('WBTC', 'Wrapped BTC (Polygon)', 'polygon', 8, '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', {
    color: '#f09242',
    colorTo: '#f7b478',
    referenceUsd: 97_300,
  }),
  evm('WETH', 'Wrapped Ether (Polygon)', 'polygon', 18, '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', {
    color: '#8247e5',
    colorTo: '#b18df2',
    referenceUsd: 3_420,
  }),
  evm('AAVE', 'Aave (Polygon)', 'polygon', 18, '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', {
    color: '#b6509e',
    colorTo: '#d183c2',
    referenceUsd: 276,
  }),
  evm('LINK', 'Chainlink (Polygon)', 'polygon', 18, '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', {
    color: '#2a5ada',
    colorTo: '#6b8ee8',
    referenceUsd: 22.4,
  }),

  /* ------------------------------------------------------------ Arbitrum */
  evm('ETH', 'Ethereum (Arbitrum)', 'arbitrum', 18, NATIVE_EVM_SENTINEL, {
    // FIXED in v0.4: 'ARB.ETH' claimed a THORChain Arbitrum route that does
    // not exist (THOR has no Arbitrum chain). Untagged, EVM aggregators only.
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
    popular: true,
  }),
  evm('USDT', 'Tether USD', 'arbitrum', 6, '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', {
    color: '#26a17b',
    colorTo: '#4fd1a5',
    referenceUsd: 1,
    stable: true,
    popular: true,
  }),
  evm('DAI', 'Dai Stablecoin', 'arbitrum', 18, '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', {
    color: '#f5ac37',
    colorTo: '#f8c877',
    referenceUsd: 1,
    stable: true,
  }),
  evm('WBTC', 'Wrapped BTC (Arbitrum)', 'arbitrum', 8, '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', {
    color: '#f09242',
    colorTo: '#f7b478',
    referenceUsd: 97_300,
  }),
  evm('LINK', 'Chainlink (Arbitrum)', 'arbitrum', 18, '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', {
    color: '#2a5ada',
    colorTo: '#6b8ee8',
    referenceUsd: 22.4,
  }),
  evm('GMX', 'GMX', 'arbitrum', 18, '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', {
    color: '#2e42f2',
    colorTo: '#7081f7',
    referenceUsd: 14,
  }),
  evm('PENDLE', 'Pendle', 'arbitrum', 18, '0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8', {
    color: '#12c8b4',
    colorTo: '#6fe3d4',
    referenceUsd: 1.1,
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
  evm('USDC', 'USD Coin (OP)', 'optimism', 6, '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', {
    color: '#2775ca',
    colorTo: '#5b9ae8',
    referenceUsd: 1,
    stable: true,
    popular: true,
  }),
  evm('USDT', 'Tether USD (OP)', 'optimism', 6, '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', {
    color: '#26a17b',
    colorTo: '#4fd1a5',
    referenceUsd: 1,
    stable: true,
    popular: true,
  }),
  evm('DAI', 'Dai Stablecoin (OP)', 'optimism', 18, '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', {
    color: '#f5ac37',
    colorTo: '#f8c877',
    referenceUsd: 1,
    stable: true,
  }),
  evm('WBTC', 'Wrapped BTC (OP)', 'optimism', 8, '0x68f180fcCe6836688e9084f035309E29Bf0A2095', {
    color: '#f09242',
    colorTo: '#f7b478',
    referenceUsd: 97_300,
  }),
  evm('LINK', 'Chainlink (OP)', 'optimism', 18, '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6', {
    color: '#2a5ada',
    colorTo: '#6b8ee8',
    referenceUsd: 22.4,
  }),

  /* ----------------------------------------------------------- Avalanche */
  evm('AVAX', 'Avalanche', 'avalanche', 18, NATIVE_EVM_SENTINEL, {
    thorchainAsset: 'AVAX.AVAX',
    color: '#e84142',
    colorTo: '#f07f80',
    referenceUsd: 38.2,
  }),
  evm('USDT', 'Tether USD (Avalanche)', 'avalanche', 6, '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', {
    color: '#26a17b',
    colorTo: '#4fd1a5',
    referenceUsd: 1,
    stable: true,
    popular: true,
  }),
  evm('USDC', 'USD Coin (Avalanche)', 'avalanche', 6, '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', {
    color: '#2775ca',
    colorTo: '#5b9ae8',
    referenceUsd: 1,
    stable: true,
    popular: true,
  }),
  evm('WBTC', 'Wrapped BTC.e (Avalanche)', 'avalanche', 8, '0x50b7545627a5162F82A992c33b87aDc75187B218', {
    color: '#f09242',
    colorTo: '#f7b478',
    referenceUsd: 97_300,
  }),
  evm('JOE', 'Trader Joe', 'avalanche', 18, '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd', {
    color: '#e74242',
    colorTo: '#f58686',
    referenceUsd: 0.18,
  }),

  /* ---------------------------------------------------------------- Base */
  evm('USDBC', 'Bridged USD Coin (Base)', 'base', 6, '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', {
    color: '#2b59f7',
    colorTo: '#6f94fa',
    referenceUsd: 1,
    stable: true,
  }),
  evm('CBBTC', 'Coinbase Wrapped BTC', 'base', 8, '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', {
    color: '#1a53f0',
    colorTo: '#6f90f8',
    referenceUsd: 97_300,
    popular: true,
  }),
  evm('AERO', 'Aerodrome Finance', 'base', 18, '0x940181a94A35A4569E4529A3CDfB74e38FD98631', {
    color: '#3366ff',
    colorTo: '#7799ff',
    referenceUsd: 0.44,
  }),
  evm('DAI', 'Dai Stablecoin (Base)', 'base', 18, '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', {
    color: '#f5ac37',
    colorTo: '#f8c877',
    referenceUsd: 1,
    stable: true,
  }),
  evm('DEGEN', 'Degen (Base)', 'base', 18, '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', {
    color: '#a36efd',
    colorTo: '#cba8fe',
    referenceUsd: 0.0045,
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
  {
    id: 'USDT.SOLANA',
    symbol: 'USDT',
    name: 'Tether USD (Solana)',
    chain: 'solana',
    decimals: 6,
    address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    color: '#26a17b',
    colorTo: '#4fd1a5',
    referenceUsd: 1,
    addressPlaceholder: 'Base58 public key',
    validate: validateSolanaAddress,
    minUsd: 15,
    maxUsd: 300_000,
    stable: true,
    popular: true,
  },
  {
    id: 'BONK.SOLANA',
    symbol: 'BONK',
    name: 'Bonk',
    chain: 'solana',
    decimals: 5,
    address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    color: '#fd9e2d',
    colorTo: '#febb68',
    referenceUsd: 0.000013,
    addressPlaceholder: 'Base58 public key',
    validate: validateSolanaAddress,
    minUsd: 15,
    maxUsd: 150_000,
    popular: true,
  },
  {
    id: 'WIF.SOLANA',
    symbol: 'WIF',
    name: 'dogwifhat',
    chain: 'solana',
    decimals: 6,
    address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8bB6b3LiHBkCYpuPGh',
    color: '#b46cf2',
    colorTo: '#d3a2f7',
    referenceUsd: 0.4,
    addressPlaceholder: 'Base58 public key',
    validate: validateSolanaAddress,
    minUsd: 15,
    maxUsd: 100_000,
  },
  {
    id: 'RAY.SOLANA',
    symbol: 'RAY',
    name: 'Raydium',
    chain: 'solana',
    decimals: 6,
    address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    color: '#22d3ee',
    colorTo: '#7ce7f6',
    referenceUsd: 0.6,
    addressPlaceholder: 'Base58 public key',
    validate: validateSolanaAddress,
    minUsd: 15,
    maxUsd: 80_000,
  },
  {
    id: 'PYTH.SOLANA',
    symbol: 'PYTH',
    name: 'Pyth Network',
    chain: 'solana',
    decimals: 6,
    address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
    color: '#6a35f8',
    colorTo: '#9d7bfa',
    referenceUsd: 0.15,
    addressPlaceholder: 'Base58 public key',
    validate: validateSolanaAddress,
    minUsd: 15,
    maxUsd: 80_000,
  },
  {
    id: 'JTO.SOLANA',
    symbol: 'JTO',
    name: 'Jito',
    chain: 'solana',
    decimals: 9,
    address: 'jtojtomeepZ8k1LP2KCPYqU5rPHysXxARuPcGbz7vvvC',
    color: '#7c4dff',
    colorTo: '#ab8cff',
    referenceUsd: 2.2,
    addressPlaceholder: 'Base58 public key',
    validate: validateSolanaAddress,
    minUsd: 15,
    maxUsd: 80_000,
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
