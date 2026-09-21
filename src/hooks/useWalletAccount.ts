import { useEffect, useState } from 'react';
import { currentAccounts, getProvider } from '../lib/wallet';

/**
 * Observes an already-connected injected wallet without ever prompting.
 *
 * There is no "Connect wallet" button in the UI: a swap only needs a
 * destination address, and demanding a connection up front is exactly the
 * friction this app exists to remove. But when the browser *already* has an
 * authorised account, passing it as `taker` makes aggregator quotes more
 * accurate (allowance state, balance-aware routing), so we read it silently.
 *
 * `eth_accounts` never shows a prompt — unlike `eth_requestAccounts`, which
 * the Execution Inspector calls only at broadcast time, when the user has
 * explicitly asked to sign.
 */
export function useWalletAccount(): string | null {
  const [account, setAccount] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void currentAccounts().then((accounts) => {
      if (!cancelled && accounts.length > 0) setAccount(accounts[0]);
    });

    const provider = getProvider();
    if (!provider?.on) return () => { cancelled = true; };

    const handler = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      setAccount(accounts?.length ? accounts[0] : null);
    };
    provider.on('accountsChanged', handler);

    return () => {
      cancelled = true;
      provider.removeListener?.('accountsChanged', handler);
    };
  }, []);

  return account;
}
