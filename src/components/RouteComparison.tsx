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
    <section className="overflow-hidden rounded-[26px] border border-line bg-ink-900 shadow-card">
      <header className="flex items-center justify-between border-b border-line-soft px-5 py-3">
        <h2 className="text-[12px] font-bold uppercase tracking-wide text-white/70">Routes</h2>
        <span className="font-mono text-[10px] text-white/30">
          {available.length} venue{available.length === 1 ? '' : 's'} quoted
        </span>
      </header>

      {/* Column headers — only worth showing once there is room for them. */}
      <div className="hidden grid-cols-[1fr_repeat(4,minmax(0,72px))_140px] items-center gap-3 border-b border-line-soft px-5 py-2 font-mono text-[9px] uppercase tracking-wider text-white/25 md:grid">
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
              className={`relative grid w-full grid-cols-[1fr_auto] items-center gap-3 px-5 py-3 text-left transition-colors md:grid-cols-[1fr_repeat(4,minmax(0,72px))_140px] ${
                isSelected ? 'bg-brand-cyan/[0.07]' : 'hover:bg-ink-850'
              }`}
            >
              {isSelected && (
                <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-brand-cyan" />
              )}

              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[13px] font-bold text-white">
                  {quote.displayName}
                </span>
                {quote.isBest && (
                  <span className="shrink-0 rounded bg-brand-green/15 px-1.5 py-px font-mono text-[9px] font-bold text-brand-green">
                    BEST
                  </span>
                )}
                {quote.source === 'simulated' && (
                  <span
                    className="shrink-0 rounded bg-white/5 px-1.5 py-px font-mono text-[9px] text-white/35"
                    title="Deterministic estimate — no upstream API key configured"
                  >
                    SIM
                  </span>
                )}
              </div>

              {/* Desktop: one metric per column. */}
              <span className="hidden justify-end gap-0.5 font-mono text-[11px] text-white/45 md:flex">
                <Zap className="h-2.5 w-2.5 self-center" />
                {formatUsd(quote.gasUsd)}
              </span>
              <span className="hidden text-right font-mono text-[11px] text-white/45 md:block">
                {quote.priceImpactPct.toFixed(2)}%
              </span>
              <span className="hidden text-right font-mono text-[11px] text-white/45 md:block">
                {formatEta(quote.etaSeconds)}
              </span>
              <span className="hidden text-right font-mono text-[11px] text-brand-orange/80 md:block">
                {quote.fee.bps}bps
              </span>

              {/* Mobile: the same metrics collapse under the venue name. */}
              <div className="col-span-2 flex items-center gap-2.5 font-mono text-[10px] text-white/30 md:hidden">
                <span className="flex items-center gap-0.5">
                  <Zap className="h-2.5 w-2.5" />
                  {formatUsd(quote.gasUsd)}
                </span>
                <span>{quote.priceImpactPct.toFixed(2)}%</span>
                <span>{formatEta(quote.etaSeconds)}</span>
                <span className="text-brand-orange/70">{quote.fee.bps}bps</span>
              </div>

              <div className="text-right">
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
    </section>
  );
};

function formatEta(seconds: number): string {
  if (seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
