import { Layers } from 'lucide-react';
import React from 'react';
import type { HealthResponse } from '../lib/api';

interface Props {
  health: HealthResponse | null;
  onOpenProviders: () => void;
}

export const Navbar: React.FC<Props> = ({ health, onOpenProviders }) => {
  const routerCount = health
    ? [health.providers.zeroEx && '0x', health.providers.oneInch && '1inch', ...health.providers.keyless]
        .filter(Boolean).length
    : 0;

  return (
    <header className="sticky top-0 z-40 border-b border-line-soft bg-ink-950/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-[1040px] items-center justify-between px-4">
        <a href="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-brand-cyan to-brand-teal font-mono text-[15px] font-black text-ink-950">
            e
          </span>
          <span className="text-[17px] font-black tracking-tight text-white">ee.io</span>
        </a>

        <button
          onClick={onOpenProviders}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-ink-850 px-2.5 py-1.5 font-mono text-[11px] text-white/55 transition-colors hover:border-line-strong hover:text-white"
        >
          <Layers className="h-3.5 w-3.5 text-brand-cyan" />
          {routerCount} routers
        </button>
      </div>
    </header>
  );
};
