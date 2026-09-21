import { Layers } from 'lucide-react';
import React from 'react';
import type { AssetSummary, HealthResponse } from '../lib/api';

interface Props {
  health: HealthResponse | null;
  assets: AssetSummary[];
  onOpenProviders: () => void;
}

export const Navbar: React.FC<Props> = ({ health, assets, onOpenProviders }) => {
  const routerCount = health
    ? [health.providers.zeroEx && '0x', health.providers.oneInch && '1inch', ...health.providers.keyless]
        .filter(Boolean).length
    : 0;

  const btc = assets.find((a) => a.symbol === 'BTC');

  return (
    <header className="sticky top-0 z-40 border-b border-line-soft bg-ink-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1040px] items-center justify-between px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-cyan text-[16px] font-bold text-ink-950">
            e
          </span>
          <span className="text-[18px] font-semibold tracking-tight text-white">ee.io</span>
        </a>

        <div className="flex items-center gap-2.5">
          {btc && btc.usdPrice > 0 && (
            <span className="hidden items-center gap-2 rounded-lg border border-line bg-ink-850 px-3 py-2 font-mono text-[12px] sm:flex">
              <span className="text-white/35">BTC</span>
              <span className="text-white/80">
                ${btc.usdPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </span>
          )}

          <button
            onClick={onOpenProviders}
            className="flex items-center gap-2 rounded-lg border border-line bg-ink-850 px-3 py-2 font-mono text-[12px] text-white/55 transition-all duration-200 hover:border-line-strong hover:bg-ink-800 hover:text-white"
          >
            <Layers className="h-3.5 w-3.5 text-brand-cyan" />
            {routerCount} routers
          </button>
        </div>
      </div>
    </header>
  );
};
