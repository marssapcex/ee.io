import React from 'react';
import type { AssetSummary } from '../lib/api';

interface Props {
  assets: AssetSummary[];
}

export const Navbar: React.FC<Props> = ({ assets }) => {
  const btc = assets.find((a) => a.symbol === 'BTC');

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink-900/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[56px] w-full max-w-[1120px] items-center justify-between px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-white text-[15px] font-bold leading-none text-black">
            e
          </span>
          <span className="text-[17px] font-bold tracking-tight text-white">ee.io</span>
          <span className="hidden rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-white/45 sm:block">
            BETA
          </span>
        </a>

        <div className="flex items-center gap-3">
          {btc && btc.usdPrice > 0 && (
            <span className="hidden items-center gap-2 rounded-full border border-line bg-ink-850 px-3 py-1.5 font-mono text-[11px] sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-greenMid shadow-[0_0_6px_rgba(39,174,96,0.6)]" />
              <span className="text-white/45">BTC</span>
              <span className="font-semibold text-white">
                ${btc.usdPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </span>
          )}
          <button className="rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-black transition hover:bg-white/90">
            Get started
          </button>
        </div>
      </div>
    </header>
  );
};
