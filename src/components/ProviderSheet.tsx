import { CheckCircle2, ExternalLink, KeyRound, X } from 'lucide-react';
import React from 'react';
import type { HealthResponse, ProviderSummary } from '../lib/api';

interface Props {
  open: boolean;
  providers: ProviderSummary[];
  health: HealthResponse | null;
  onClose: () => void;
}

/** Which env var unlocks live quotes for each adapter. */
const KEY_REQUIREMENT: Record<string, string | null> = {
  '0x': 'ZEROX_API_KEY',
  '1inch': 'ONEINCH_API_KEY',
  jupiter: 'JUPITER_API_KEY',
  openocean: null,
  kyberswap: null,
  paraswap: null,
  thorchain: null,
};

export const ProviderSheet: React.FC<Props> = ({ open, providers, health, onClose }) => {
  if (!open) return null;

  const isLive = (id: string): boolean => {
    if (!health) return false;
    switch (id) {
      case '0x':
        return health.providers.zeroEx;
      case '1inch':
        return health.providers.oneInch;
      default:
        return health.providers.keyless.includes(id);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-4 pt-[6vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-xl animate-slide-up rounded-3xl border border-line bg-ink-700 p-5 shadow-2xl">
        <header className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Liquidity routers</h2>
            <p className="text-[11px] text-white/35">
              Every route is a public aggregator. ee.io adds an affiliate parameter — nothing else.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/45 hover:bg-ink-500 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <ul className="space-y-2">
          {providers.map((provider) => {
            const live = isLive(provider.id);
            const keyVar = KEY_REQUIREMENT[provider.id];
            return (
              <li
                key={provider.id}
                className="rounded-2xl border border-line bg-ink-800/70 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white">{provider.displayName}</span>
                  {live ? (
                    <span className="flex shrink-0 items-center gap-1 rounded border border-brand-green/40 bg-brand-green/10 px-1.5 py-px font-mono text-[9px] text-brand-green">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      LIVE
                    </span>
                  ) : (
                    <span
                      className="flex shrink-0 items-center gap-1 rounded border border-brand-amber/30 bg-brand-amber/10 px-1.5 py-px font-mono text-[9px] text-brand-amber"
                      title={keyVar ? `Set ${keyVar} to enable` : 'Upstream unreachable'}
                    >
                      <KeyRound className="h-2.5 w-2.5" />
                      {keyVar ? 'NEEDS KEY' : 'OFFLINE'}
                    </span>
                  )}
                </div>

                <p className="mt-1 font-mono text-[10px] leading-relaxed text-white/45">
                  {provider.feeMechanism}
                </p>

                <div className="mt-1.5 flex items-center justify-between">
                  <a
                    href={provider.docsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-1 text-[10px] text-white/35 hover:text-brand-cyan"
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                    documentation
                  </a>
                  {keyVar && !live && (
                    <code className="font-mono text-[10px] text-brand-amber/80">{keyVar}</code>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {health && (
          <div className="mt-3 rounded-2xl border border-line bg-ink-800 p-3 font-mono text-[10px] text-white/45">
            <div className="flex justify-between">
              <span>fee policy</span>
              <span className="text-brand-orange">
                float {health.fee.floatBps} bps · fixed {health.fee.fixedBps} bps · on{' '}
                {health.fee.chargeOn}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span>recipient (EVM)</span>
              <span className={health.fee.recipientConfigured ? 'text-brand-green' : 'text-brand-amber'}>
                {health.fee.recipientConfigured ? 'configured' : 'placeholder — set EE_FEE_RECIPIENT_EVM'}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span>THORName</span>
              <span className={health.fee.thornameConfigured ? 'text-brand-green' : 'text-brand-amber'}>
                {health.fee.thornameConfigured ? 'registered' : 'unset — affiliate fee skipped'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
