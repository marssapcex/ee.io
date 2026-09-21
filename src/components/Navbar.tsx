import { Percent, Plug, ShieldCheck, Wallet } from 'lucide-react';
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

  // Restore an existing connection without prompting, and follow account changes.
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

  const liveProviders = health
    ? [
        health.providers.zeroEx && '0x',
        health.providers.oneInch && '1inch',
        ...health.providers.keyless,
      ].filter(Boolean).length
    : 0;

  return (
    <header className="sticky top-0 z-40 border-b border-line-soft bg-ink-850/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <a href="/" className="group flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-brand-orange via-amber-400 to-brand-cyan p-[1.5px] shadow-lg shadow-cyan-500/10 transition-transform group-hover:scale-105">
              <div className="grid h-full w-full place-items-center rounded-[14px] bg-ink-850">
                <span className="font-mono text-base font-black text-brand-cyan">e</span>
              </div>
            </div>
            <div className="leading-none">
              <div className="flex items-baseline font-black tracking-tight">
                <span className="text-xl text-brand-orange">ee</span>
                <span className="text-xl text-brand-cyan">.io</span>
              </div>
              <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-slate-500">
                non-custodial · e &gt; f
              </span>
            </div>
          </a>

          <span className="hidden items-center gap-1.5 rounded-full border border-emerald-800/50 bg-emerald-950/40 px-2.5 py-1 font-mono text-[10px] text-emerald-300 lg:inline-flex">
            <ShieldCheck className="h-3 w-3" />
            no custody · no KYC · no freeze
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenProviders}
            className="hidden items-center gap-1.5 rounded-xl border border-line bg-ink-600 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-brand-cyan/50 hover:text-white sm:flex"
          >
            <Plug className="h-3.5 w-3.5 text-brand-cyan" />
            <span>{liveProviders} routers</span>
          </button>

          {health && (
            <div className="hidden items-center gap-1.5 rounded-xl border border-line bg-ink-600 px-3 py-2 text-xs font-semibold text-slate-300 md:flex">
              <Percent className="h-3.5 w-3.5 text-brand-orange" />
              <span className="font-mono text-brand-orange">
                {(health.fee.floatBps / 100).toFixed(2)}–{(health.fee.fixedBps / 100).toFixed(2)}%
              </span>
            </div>
          )}

          <button
            onClick={handleConnect}
            disabled={connecting}
            className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition-all ${
              account
                ? 'border-emerald-700/60 bg-emerald-950/70 font-mono text-emerald-300'
                : 'border-cyan-700/60 bg-cyan-950/70 text-cyan-300 hover:bg-cyan-900/70'
            } disabled:opacity-60`}
          >
            <Wallet className="h-3.5 w-3.5" />
            {connecting
              ? 'Connecting…'
              : account
                ? shortAddress(account)
                : `Connect ${walletName()}`}
          </button>
        </div>
      </div>

      {error && (
        <div className="border-t border-red-900/40 bg-red-950/40 px-4 py-1.5 text-center text-[11px] text-red-300">
          {error}
        </div>
      )}
    </header>
  );
};
