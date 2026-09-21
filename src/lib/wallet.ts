/**
 * Minimal EIP-1193 wallet bridge.
 *
 * Deliberately dependency-free: no WalletConnect project id, no analytics SDK.
 * We only need accounts, chain switching, and sending a transaction the server
 * already described.
 */

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
  isRabby?: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function getProvider(): Eip1193Provider | null {
  if (typeof window === 'undefined') return null;
  return window.ethereum ?? null;
}

export function walletName(): string {
  const provider = getProvider();
  if (!provider) return 'Wallet';
  if (provider.isRabby) return 'Rabby';
  if (provider.isMetaMask) return 'MetaMask';
  return 'Wallet';
}

export async function connect(): Promise<string[]> {
  const provider = getProvider();
  if (!provider) {
    throw new Error('No EVM wallet detected. Install MetaMask or Rabby, or use a deposit address.');
  }
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  return accounts ?? [];
}

export async function currentAccounts(): Promise<string[]> {
  const provider = getProvider();
  if (!provider) return [];
  try {
    return ((await provider.request({ method: 'eth_accounts' })) as string[]) ?? [];
  } catch {
    return [];
  }
}

export async function currentChainId(): Promise<number | null> {
  const provider = getProvider();
  if (!provider) return null;
  try {
    const hex = (await provider.request({ method: 'eth_chainId' })) as string;
    return parseInt(hex, 16);
  } catch {
    return null;
  }
}

/** Switch networks, adding the chain first if the wallet does not know it. */
export async function switchChain(chainId: number, chainName: string): Promise<void> {
  const provider = getProvider();
  if (!provider) throw new Error('No wallet connected');

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  } catch (error) {
    const code = (error as { code?: number })?.code;
    // 4902 = chain not added to the wallet.
    if (code === 4902) {
      throw new Error(`Add ${chainName} (chain ${chainId}) to your wallet, then retry.`);
    }
    throw error;
  }
}

export interface SendTxParams {
  to: string;
  data: string;
  value: string;
  gas?: string;
  from: string;
}

export async function sendTransaction(params: SendTxParams): Promise<string> {
  const provider = getProvider();
  if (!provider) throw new Error('No wallet connected');

  const tx: Record<string, string> = {
    from: params.from,
    to: params.to,
    data: params.data,
    value: `0x${BigInt(params.value || '0').toString(16)}`,
  };
  if (params.gas) tx.gas = `0x${BigInt(params.gas).toString(16)}`;

  return (await provider.request({
    method: 'eth_sendTransaction',
    params: [tx],
  })) as string;
}

/** ERC-20 approve(spender, amount) — selector 0x095ea7b3. */
export function encodeApprove(spender: string, amount: bigint): string {
  const paddedSpender = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const paddedAmount = amount.toString(16).padStart(64, '0');
  return `0x095ea7b3${paddedSpender}${paddedAmount}`;
}

export function shortAddress(address: string): string {
  if (!address) return '';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
