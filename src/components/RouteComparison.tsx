import { Activity, Zap } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { formatDisplay, formatUsd } from '../../shared/money';
import type { AggregatorQuote } from '../../shared/types';
import type { AssetSummary } from '../lib/api';

type SortMode = 'recommended' | 'fastest' | 'cheapest';

const SORT_LABELS: Record<SortMode, string> = {
  recommended: 'Recommended',
  fastest: 'Fastest',
  cheapest: 'Lowest fee',
};

interface Props {
  quotes: AggregatorQuote[];
  toAsset: AssetSummary;
  selected: string | null;
  onSelect: (aggregator: string) => void;
  loading: boolean;
}

/**
 * Smart route board.
 *
 * Server ranking is by delivered value (netOut − gas). This component adds the
 * two things a top-tier comparison needs on top: alternative priorities
 * (fastest/cheapest) and the venue's RECENT track record — a venue whose
 * quote looks fine this second but who has dropped half its quotes lately is
 * labeled instead of hidden, the difference between information and noise.
 */
export const RouteComparison: React.FC<Props> = ({
  quotes,
  toAsset,
  selected,
  onSelect,
  loading,
}) => {
  const [sort, setSort] = useState<SortMode>('recommended');
  const available = useMemo(() => {
    const rows = quotes.filter((q) => !q.unavailableReason);
    if (sort === 'fastest') return [...rows].sort((a, b) => a.etaSeconds - b.etaSeconds);
    if (sort === 'cheapest') return [...rows].sort((a, b) => a.fee.bps - b.fee.bps || a.gasUsd - b.gasUsd);
    return rows; // server order = delivered-value ranking
  }, [quotes, sort]);

  if (available.length === 0 && !loading) return null;

  return (
    <section className="overflow-hidden rounded-[16px] border border-white/[0.06] bg-ink-850 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
      <header className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-white/90">
            Smart routes
          </h2>
          <span className="rounded-full bg-white/[0.06] px-2.5 py-1 font-mono text-[10px] font-medium text-white/45">
            {available.length} venue{available.length === 1 ? '' : 's'} quoted
          </span>
        </div>
        <div className="flex overflow-hidden rounded-full border border-white/[0.08] bg-ink-900">
          {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setSort(mode)}
              aria-pressed={sort === mode}
              className={`px-3 py-1.5 text-[10px] font-semibold transition ${
                sort === mode ? 'bg-white/[0.10] text-white' : 'text-white/35 hover:text-white/70'
              }`}
            >
              {SORT_LABELS[mode]}
            </button>
          ))}
        </div>
      </header>

      {/* Column headers — only worth showing once there is room for them. */}
      <div className="hidden grid-cols-[1fr_repeat(3,minmax(0,72px))_84px_150px] items-center gap-4 border-y border-white/[0.04] bg-ink-900/40 px-5 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-white/35 md:grid">
        <span>Venue</span>
        <span className="text-right">Gas</span>
        <span className="text-right">Fee</span>
        <span className="text-right">ETA</span>
        <span className="text-right">Health</span>
        <span className="text-right">You receive</span>
      </div>

      <div className="divide-y divide-white/[0.04]">
        {available.map((quote) => {
          const isSelected = selected === quote.aggregator;
          return (
            <button
              key={quote.aggregator}
              onClick={() => onSelect(quote.aggregator)}
              className={`relative grid w-full grid-cols-[1fr_auto] items-center gap-4 px-5 py-3.5 text-left transition-all duration-200 md:grid-cols-[1fr_repeat(3,minmax(0,72px))_84px_150px] ${
                isSelected ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
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
                {sort !== 'recommended' && fastestOrCheapest(quote, available) && (
                  <span className="shrink-0 rounded-md bg-brand-cyan/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide text-brand-cyan">
                    {sort === 'fastest' ? 'Fastest' : 'Cheapest'}
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
              <span
                className="hidden text-right font-mono text-[12px] text-white/45 md:block"
                title={`Impact ${quote.priceImpactPct.toFixed(2)}%`}
              >
                {quote.fee.bps}bps
              </span>
              <span className="hidden text-right font-mono text-[12px] text-white/45 md:block">
                {formatEta(quote.etaSeconds)}
              </span>
              <span className="hidden md:block">
                <HealthBadge quote={quote} />
              </span>

              {/* Mobile: the same metrics collapse under the venue name. */}
              <div className="col-span-2 flex items-center gap-3 font-mono text-[11px] text-white/40 md:hidden">
                <span className="flex items-center gap-1">
                  <Zap className="h-2.5 w-2.5" />
                  {formatUsd(quote.gasUsd)}
                </span>
                <span>{quote.fee.bps}bps</span>
                <span>{formatEta(quote.etaSeconds)}</span>
                <HealthBadge quote={quote} compact />
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

/**
 * Reliability chip. The venue-health window reflects the last ~30 upstream
 * calls; below 4 observations we stay gray rather than judgmental.
 */
const HealthBadge: React.FC<{ quote: AggregatorQuote; compact?: boolean }> = ({ quote, compact }) => {
  const pct = quote.reliabilityPct;
  if (pct === undefined) return <span className="font-mono text-[10px] text-white/20">—</span>;

  const tone =
    quote.health === 'down'
      ? 'text-brand-red border-brand-red/30 bg-brand-red/[0.08]'
      : quote.health === 'degraded'
        ? 'text-brand-amber border-brand-amber/30 bg-brand-amber/[0.08]'
        : 'text-brand-greenBright border-brand-greenMid/30 bg-brand-greenMid/[0.08]';

  return (
    <span
      title={`Reliability ${pct.toFixed(1)}% over recent quotes`}
      className={`inline-flex items-center justify-end gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${tone}`}
    >
      <Activity className="h-2.5 w-2.5" />
      {compact ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`}
    </span>
  );
};

function fastestOrCheapest(quote: AggregatorQuote, rows: AggregatorQuote[]): boolean {
  if (rows.length === 0) return false;
  const pick = rows[0];
  return quote.aggregator === pick.aggregator && !quote.isBest;
}

function formatEta(seconds: number): string {
  if (seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
