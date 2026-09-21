import { ChevronRight, Zap } from 'lucide-react';
import React from 'react';
import { formatDisplay, formatUsd } from '../../shared/money';
import type { AggregatorQuote } from '../../shared/types';
import type { AssetSummary, ProviderSummary } from '../lib/api';

interface Props {
  quotes: AggregatorQuote[];
  toAsset: AssetSummary;
  selected: string | null;
  onSelect: (aggregator: string) => void;
  providers: ProviderSummary[];
  loading: boolean;
}

export const RouteComparison: React.FC<Props> = ({
  quotes,
  toAsset,
  selected,
  onSelect,
  loading,
}) => {
  const available = quotes.filter((q) => !q.unavailableReason);
  const unavailable = quotes.filter((q) => q.unavailableReason);

  if (available.length === 0 && !loading) return null;

  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-ink-850 shadow-card">
      <header className="flex items-center justify-between border-b border-line-soft px-4 py-3">
        <h2 className="text-[12px] font-bold text-white/80">Routes</h2>
        <span className="font-mono text-[10px] text-white/30">{available.length} available</span>
      </header>

      <div className="divide-y divide-line-soft">
        {available.map((quote) => {
          const isSelected = selected === quote.aggregator;
          return (
            <button
              key={quote.aggregator}
              onClick={() => onSelect(quote.aggregator)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                isSelected ? 'bg-brand-cyan/[0.06]' : 'hover:bg-ink-800'
              }`}
            >
              {/* Selection rail */}
              <span
                className={`h-8 w-[3px] shrink-0 rounded-full transition-colors ${
                  isSelected ? 'bg-brand-cyan' : 'bg-transparent'
                }`}
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-bold text-white">
                    {quote.displayName}
                  </span>
                  {quote.isBest && (
                    <span className="rounded bg-brand-green/15 px-1.5 py-px font-mono text-[9px] font-bold text-brand-green">
                      BEST
                    </span>
                  )}
                  {quote.source === 'simulated' && (
                    <span
                      className="rounded bg-white/5 px-1.5 py-px font-mono text-[9px] text-white/35"
                      title="Deterministic estimate — no upstream API key configured"
                    >
                      SIM
                    </span>
                  )}
                </div>

                <div className="mt-0.5 flex items-center gap-2.5 font-mono text-[10px] text-white/30">
                  <span className="flex items-center gap-0.5">
                    <Zap className="h-2.5 w-2.5" />
                    {formatUsd(quote.gasUsd)}
                  </span>
                  <span>{quote.priceImpactPct.toFixed(2)}%</span>
                  <span>{formatEta(quote.etaSeconds)}</span>
                  <span className="text-brand-orange/70">{quote.fee.bps}bps</span>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="tabular font-mono text-[14px] font-bold text-white">
                  {formatDisplay(BigInt(quote.netOut), toAsset.decimals, 4)}
                </div>
                <div className="font-mono text-[10px] text-white/30">
                  {quote.isBest && quote.advantageUsd !== undefined && quote.advantageUsd > 0.01 ? (
                    <span className="text-brand-green">+{formatUsd(quote.advantageUsd)}</span>
                  ) : (
                    formatUsd(quote.netOutUsd)
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {unavailable.length > 0 && (
        <details className="group border-t border-line-soft">
          <summary className="flex cursor-pointer list-none items-center gap-1 px-4 py-2.5 font-mono text-[10px] text-white/25 hover:text-white/50">
            <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
            {unavailable.length} unavailable
          </summary>
          <ul className="space-y-1 px-4 pb-3">
            {unavailable.map((quote) => (
              <li key={quote.aggregator} className="font-mono text-[10px] text-white/25">
                <span className="text-white/45">{quote.displayName}</span> — {quote.unavailableReason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};

function formatEta(seconds: number): string {
  if (seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
