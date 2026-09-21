import { Layers, Wallet } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import type { HealthResponse } from '../lib/api';
import { connect, currentAccounts, getProvider, shortAddress, walletName } from '../lib/wallet';

interface Props {
  health: HealthResponse | null;
  account: string | null;
  onAccount: (account: string | null) => void;
  onOpenProviders: () => void;
}

export const Navbar: React.FC<Props> = ({ health, account, onAccount, onOpenProviders }) => {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore an existing connection silently, then follow account changes.
  useEffect(() => {
    void currentAccounts().then((accounts) => {
      if (accounts.length > 0) onAccount(accounts[0]);
    });

    const provider = getProvider();
    if (!provider?.on) return;

    const handler = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      onAccount(accounts?.length ? accounts[0] : null);
    };
    provider.on('accountsChanged', handler);
    return () => provider.removeListener?.('accountsChanged', handler);
  }, [onAccount]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const accounts = await connect();
      onAccount(accounts[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setTimeout(() => setError(null), 5000);
    } finally {
      setConnecting(false);
    }
  };

  const routerCount = health
    ? [health.providers.zeroEx && '0x', health.providers.oneInch && '1inch', ...health.providers.keyless]
        .filter(Boolean).length
    : 0;

  return (
    <header className="sticky top-0 z-40 border-b border-line-soft bg-ink-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[520px] items-center justify-between px-4">
        <a href="/" className="group flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-brand-cyan to-brand-teal font-mono text-[15px] font-black text-ink-950">
            e
          </span>
          <span className="text-[17px] font-black tracking-tight text-white">ee.io</span>
        </a>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenProviders}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-ink-800 px-2.5 py-1.5 font-mono text-[11px] text-white/55 transition-colors hover:border-line-strong hover:text-white"
          >
            <Layers className="h-3.5 w-3.5 text-brand-cyan" />
            {routerCount}
          </button>

          <button
            onClick={handleConnect}
            disabled={connecting}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-bold transition-all ${
              account
                ? 'border-brand-green/40 bg-brand-green/10 font-mono text-brand-green'
                : 'border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20'
            } disabled:opacity-50`}
          >
            <Wallet className="h-3.5 w-3.5" />
            {connecting ? '…' : account ? shortAddress(account) : `Connect ${walletName()}`}
          </button>
        </div>
      </div>

      {error && (
        <div className="border-t border-brand-red/20 bg-brand-red/10 px-4 py-1.5 text-center text-[11px] text-brand-red">
          {error}
        </div>
      )}
    </header>
  );
};
