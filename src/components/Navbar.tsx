import React from 'react';
import type { AssetSummary } from '../lib/api';

interface Props {
  assets: AssetSummary[];
}

export const Navbar: React.FC<Props> = ({ assets }) => {
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

        {btc && btc.usdPrice > 0 && (
          <span className="flex items-center gap-2 rounded-lg border border-line bg-ink-850 px-3 py-2 font-mono text-[12px]">
            <span className="text-white/40">BTC</span>
            <span className="text-white/80">
              ${btc.usdPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </span>
          </span>
        )}
      </div>
    </header>
  );
};
