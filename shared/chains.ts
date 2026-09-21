/**
 * Chain registry.
 *
 * `thorchainChain` uses THORChain's chain identifiers (asset notation is
 * `CHAIN.SYMBOL`, see https://dev.thorchain.org/concepts/asset-notation.html).
 * `kyberSlug` is the path segment used by the KyberSwap aggregator API
 * (https://aggregator-api.kyberswap.com/{chain}/api/v1/routes).
 */

export type ChainKind = 'evm' | 'utxo' | 'solana' | 'tron' | 'cosmos' | 'monero' | 'ripple';

export interface ChainInfo {
  id: string;
  name: string;
  kind: ChainKind;
  /** EVM chain id — undefined for non-EVM chains. */
  chainId?: number;
  /** KyberSwap aggregator API path segment. */
  kyberSlug?: string;
  /** THORChain chain identifier used in asset notation and memos. */
  thorchainChain?: string;
  /** OpenOcean chain code. */
  openOceanSlug?: string;
  explorerTx: (hash: string) => string;
  explorerAddress: (address: string) => string;
  nativeSymbol: string;
  /** Typical confirmations before a deposit is considered settled. */
  confirmations: number;
  /** Approximate seconds per block, used for ETA display. */
  blockSeconds: number;
  color: { bg: string; text: string; border: string };
}

const CHAIN_DEFS = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    kind: 'evm',
    chainId: 1,
    kyberSlug: 'ethereum',
    thorchainChain: 'ETH',
    openOceanSlug: 'eth',
    explorerTx: (h) => `https://etherscan.io/tx/${h}`,
    explorerAddress: (a) => `https://etherscan.io/address/${a}`,
    nativeSymbol: 'ETH',
    confirmations: 2,
    blockSeconds: 12,
    color: { bg: 'bg-indigo-500/10', text: 'text-indigo-300', border: 'border-indigo-500/30' },
  },
  bsc: {
    id: 'bsc',
    name: 'BNB Chain',
    kind: 'evm',
    chainId: 56,
    kyberSlug: 'bsc',
    thorchainChain: 'BSC',
    openOceanSlug: 'bsc',
    explorerTx: (h) => `https://bscscan.com/tx/${h}`,
    explorerAddress: (a) => `https://bscscan.com/address/${a}`,
    nativeSymbol: 'BNB',
    confirmations: 6,
    blockSeconds: 3,
    color: { bg: 'bg-yellow-500/10', text: 'text-yellow-300', border: 'border-yellow-500/30' },
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    kind: 'evm',
    chainId: 137,
    kyberSlug: 'polygon',
    thorchainChain: 'POL',
    openOceanSlug: 'polygon',
    explorerTx: (h) => `https://polygonscan.com/tx/${h}`,
    explorerAddress: (a) => `https://polygonscan.com/address/${a}`,
    nativeSymbol: 'POL',
    confirmations: 30,
    blockSeconds: 2,
    color: { bg: 'bg-purple-500/10', text: 'text-purple-300', border: 'border-purple-500/30' },
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum One',
    kind: 'evm',
    chainId: 42161,
    kyberSlug: 'arbitrum',
    thorchainChain: 'ARB',
    openOceanSlug: 'arbitrum',
    explorerTx: (h) => `https://arbiscan.io/tx/${h}`,
    explorerAddress: (a) => `https://arbiscan.io/address/${a}`,
    nativeSymbol: 'ETH',
    confirmations: 5,
    blockSeconds: 1,
    color: { bg: 'bg-sky-500/10', text: 'text-sky-300', border: 'border-sky-500/30' },
  },
  base: {
    id: 'base',
    name: 'Base',
    kind: 'evm',
    chainId: 8453,
    kyberSlug: 'base',
    thorchainChain: 'BASE',
    openOceanSlug: 'base',
    explorerTx: (h) => `https://basescan.org/tx/${h}`,
    explorerAddress: (a) => `https://basescan.org/address/${a}`,
    nativeSymbol: 'ETH',
    confirmations: 5,
    blockSeconds: 2,
    color: { bg: 'bg-blue-500/10', text: 'text-blue-300', border: 'border-blue-500/30' },
  },
  optimism: {
    id: 'optimism',
    name: 'OP Mainnet',
    kind: 'evm',
    chainId: 10,
    kyberSlug: 'optimism',
    openOceanSlug: 'optimism',
    explorerTx: (h) => `https://optimistic.etherscan.io/tx/${h}`,
    explorerAddress: (a) => `https://optimistic.etherscan.io/address/${a}`,
    nativeSymbol: 'ETH',
    confirmations: 5,
    blockSeconds: 2,
    color: { bg: 'bg-red-500/10', text: 'text-red-300', border: 'border-red-500/30' },
  },
  avalanche: {
    id: 'avalanche',
    name: 'Avalanche C-Chain',
    kind: 'evm',
    chainId: 43114,
    kyberSlug: 'avalanche',
    thorchainChain: 'AVAX',
    openOceanSlug: 'avax',
    explorerTx: (h) => `https://snowtrace.io/tx/${h}`,
    explorerAddress: (a) => `https://snowtrace.io/address/${a}`,
    nativeSymbol: 'AVAX',
    confirmations: 5,
    blockSeconds: 2,
    color: { bg: 'bg-rose-500/10', text: 'text-rose-300', border: 'border-rose-500/30' },
  },
  bitcoin: {
    id: 'bitcoin',
    name: 'Bitcoin',
    kind: 'utxo',
    thorchainChain: 'BTC',
    explorerTx: (h) => `https://mempool.space/tx/${h}`,
    explorerAddress: (a) => `https://mempool.space/address/${a}`,
    nativeSymbol: 'BTC',
    confirmations: 1,
    blockSeconds: 600,
    color: { bg: 'bg-orange-500/10', text: 'text-orange-300', border: 'border-orange-500/30' },
  },
  litecoin: {
    id: 'litecoin',
    name: 'Litecoin',
    kind: 'utxo',
    thorchainChain: 'LTC',
    explorerTx: (h) => `https://blockchair.com/litecoin/transaction/${h}`,
    explorerAddress: (a) => `https://blockchair.com/litecoin/address/${a}`,
    nativeSymbol: 'LTC',
    confirmations: 2,
    blockSeconds: 150,
    color: { bg: 'bg-slate-400/10', text: 'text-slate-300', border: 'border-slate-400/30' },
  },
  dogecoin: {
    id: 'dogecoin',
    name: 'Dogecoin',
    kind: 'utxo',
    thorchainChain: 'DOGE',
    explorerTx: (h) => `https://blockchair.com/dogecoin/transaction/${h}`,
    explorerAddress: (a) => `https://blockchair.com/dogecoin/address/${a}`,
    nativeSymbol: 'DOGE',
    confirmations: 10,
    blockSeconds: 60,
    color: { bg: 'bg-amber-500/10', text: 'text-amber-300', border: 'border-amber-500/30' },
  },
  bitcoincash: {
    id: 'bitcoincash',
    name: 'Bitcoin Cash',
    kind: 'utxo',
    thorchainChain: 'BCH',
    explorerTx: (h) => `https://blockchair.com/bitcoin-cash/transaction/${h}`,
    explorerAddress: (a) => `https://blockchair.com/bitcoin-cash/address/${a}`,
    nativeSymbol: 'BCH',
    confirmations: 2,
    blockSeconds: 600,
    color: { bg: 'bg-lime-500/10', text: 'text-lime-300', border: 'border-lime-500/30' },
  },
  solana: {
    id: 'solana',
    name: 'Solana',
    kind: 'solana',
    openOceanSlug: 'solana',
    explorerTx: (h) => `https://solscan.io/tx/${h}`,
    explorerAddress: (a) => `https://solscan.io/account/${a}`,
    nativeSymbol: 'SOL',
    confirmations: 32,
    blockSeconds: 0.4,
    color: { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-300', border: 'border-fuchsia-500/30' },
  },
  tron: {
    id: 'tron',
    name: 'TRON',
    kind: 'tron',
    thorchainChain: 'TRON',
    explorerTx: (h) => `https://tronscan.org/#/transaction/${h}`,
    explorerAddress: (a) => `https://tronscan.org/#/address/${a}`,
    nativeSymbol: 'TRX',
    confirmations: 19,
    blockSeconds: 3,
    color: { bg: 'bg-red-600/10', text: 'text-red-300', border: 'border-red-600/30' },
  },
  monero: {
    id: 'monero',
    name: 'Monero',
    kind: 'monero',
    explorerTx: (h) => `https://xmrchain.net/tx/${h}`,
    explorerAddress: () => '',
    nativeSymbol: 'XMR',
    confirmations: 10,
    blockSeconds: 120,
    color: { bg: 'bg-orange-600/10', text: 'text-orange-300', border: 'border-orange-600/30' },
  },
  thorchain: {
    id: 'thorchain',
    name: 'THORChain',
    kind: 'cosmos',
    thorchainChain: 'THOR',
    explorerTx: (h) => `https://runescan.io/tx/${h}`,
    explorerAddress: (a) => `https://runescan.io/address/${a}`,
    nativeSymbol: 'RUNE',
    confirmations: 1,
    blockSeconds: 6,
    color: { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/30' },
  },
  cosmos: {
    id: 'cosmos',
    name: 'Cosmos Hub',
    kind: 'cosmos',
    thorchainChain: 'GAIA',
    explorerTx: (h) => `https://www.mintscan.io/cosmos/txs/${h}`,
    explorerAddress: (a) => `https://www.mintscan.io/cosmos/account/${a}`,
    nativeSymbol: 'ATOM',
    confirmations: 1,
    blockSeconds: 7,
    color: { bg: 'bg-violet-500/10', text: 'text-violet-300', border: 'border-violet-500/30' },
  },
  ripple: {
    id: 'ripple',
    name: 'XRP Ledger',
    kind: 'ripple',
    thorchainChain: 'XRP',
    explorerTx: (h) => `https://xrpscan.com/tx/${h}`,
    explorerAddress: (a) => `https://xrpscan.com/account/${a}`,
    nativeSymbol: 'XRP',
    confirmations: 1,
    blockSeconds: 4,
    color: { bg: 'bg-cyan-500/10', text: 'text-cyan-300', border: 'border-cyan-500/30' },
  },
} satisfies Record<string, ChainInfo>;

export type ChainId = keyof typeof CHAIN_DEFS;

/**
 * Widen each entry to `ChainInfo` so optional fields (chainId, kyberSlug…) stay
 * accessible. `satisfies` above still enforces the shape of every definition,
 * and `ChainId` still gives us the exact union of valid keys.
 */
export const CHAINS: Record<ChainId, ChainInfo> = CHAIN_DEFS;

export const EVM_CHAINS = Object.values(CHAINS).filter(
  (c): c is ChainInfo & { chainId: number } => c.kind === 'evm' && c.chainId !== undefined,
);

export function getChain(id: ChainId): ChainInfo {
  return CHAINS[id];
}

export function chainByEvmId(chainId: number): ChainInfo | undefined {
  return EVM_CHAINS.find((c) => c.chainId === chainId);
}
