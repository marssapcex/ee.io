import { Zap } from 'lucide-react';
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

/**
 * Route table. Only routable venues are listed — a venue that cannot serve the
 * pair at all is noise, not information.
 */
export const RouteComparison: React.FC<Props> = ({
  quotes,
  toAsset,
  selected,
  onSelect,
  loading,
}) => {
  const available = quotes.filter((q) => !q.unavailableReason);

  if (available.length === 0 && !loading) return null;

  return (
    <section className="overflow-hidden rounded-[20px] border border-line bg-ink-850 shadow-card">
      <header className="flex items-center justify-between px-6 py-5">
        <h2 className="text-[15px] font-semibold tracking-tight text-white">Routes</h2>
        <span className="font-mono text-[11px] text-white/40">
          {available.length} venue{available.length === 1 ? '' : 's'} quoted
        </span>
      </header>

      {/* Column headers — only worth showing once there is room for them. */}
      <div className="hidden grid-cols-[1fr_repeat(4,minmax(0,78px))_150px] items-center gap-4 border-y border-line-soft px-6 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-white/40 md:grid">
        <span>Venue</span>
        <span className="text-right">Gas</span>
        <span className="text-right">Impact</span>
        <span className="text-right">ETA</span>
        <span className="text-right">Fee</span>
        <span className="text-right">You receive</span>
      </div>

      <div className="divide-y divide-line-soft">
        {available.map((quote) => {
          const isSelected = selected === quote.aggregator;
          return (
            <button
              key={quote.aggregator}
              onClick={() => onSelect(quote.aggregator)}
              className={`relative grid w-full grid-cols-[1fr_auto] items-center gap-4 px-6 py-4 text-left transition-all duration-200 md:grid-cols-[1fr_repeat(4,minmax(0,78px))_150px] ${
                isSelected ? 'bg-brand-cyan/[0.06]' : 'hover:bg-white/[0.025]'
              }`}
            >
              {isSelected && (
                <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-brand-cyan" />
              )}

              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[14px] font-medium text-white">
                  {quote.displayName}
                </span>
                {quote.isBest && (
                  <span className="shrink-0 rounded-md bg-brand-greenMid/15 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-brand-greenBright">
                    Best
                  </span>
                )}
                {quote.source === 'simulated' && (
                  <span
                    className="shrink-0 rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-white/35"
                    title="Deterministic estimate — no upstream API key configured"
                  >
                    Sim
                  </span>
                )}
              </div>

              {/* Desktop: one metric per column. */}
              <span className="hidden items-center justify-end gap-1 font-mono text-[12px] text-white/45 md:flex">
                <Zap className="h-2.5 w-2.5" />
                {formatUsd(quote.gasUsd)}
              </span>
              <span className="hidden text-right font-mono text-[12px] text-white/45 md:block">
                {quote.priceImpactPct.toFixed(2)}%
              </span>
              <span className="hidden text-right font-mono text-[12px] text-white/45 md:block">
                {formatEta(quote.etaSeconds)}
              </span>
              <span className="hidden text-right font-mono text-[12px] text-white/45 md:block">
                {quote.fee.bps}bps
              </span>

              {/* Mobile: the same metrics collapse under the venue name. */}
              <div className="col-span-2 flex items-center gap-3 font-mono text-[11px] text-white/40 md:hidden">
                <span className="flex items-center gap-1">
                  <Zap className="h-2.5 w-2.5" />
                  {formatUsd(quote.gasUsd)}
                </span>
                <span>{quote.priceImpactPct.toFixed(2)}%</span>
                <span>{formatEta(quote.etaSeconds)}</span>
                <span>{quote.fee.bps}bps</span>
              </div>

              <div className="text-right">
                <div className="tabular text-[15px] font-semibold tracking-tight text-white">
                  {formatDisplay(BigInt(quote.netOut), toAsset.decimals, 4)}
                </div>
                <div className="font-mono text-[11px] text-white/40">
                  {quote.isBest && quote.advantageUsd !== undefined && quote.advantageUsd > 0.01 ? (
                    <span className="text-brand-greenBright">+{formatUsd(quote.advantageUsd)}</span>
                  ) : (
                    formatUsd(quote.netOutUsd)
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};

function formatEta(seconds: number): string {
  if (seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
