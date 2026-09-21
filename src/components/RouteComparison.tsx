import { Ban, ChevronRight, Clock, Flame, Radio, TrendingUp, Zap } from 'lucide-react';
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
  providers,
  loading,
}) => {
  const available = quotes.filter((q) => !q.unavailableReason);
  const unavailable = quotes.filter((q) => q.unavailableReason);

  const providerFor = (id: string) => providers.find((p) => p.id === id);

  return (
    <section className="w-full max-w-2xl rounded-3xl border border-line bg-ink-750/90 p-5 backdrop-blur-md">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-brand-cyan" />
          <h2 className="text-sm font-bold text-white">Route comparison</h2>
          <span className="rounded-full border border-line bg-ink-800 px-2 py-0.5 font-mono text-[10px] text-slate-400">
            {available.length} routable
          </span>
        </div>
        {loading && (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Radio className="h-3 w-3 animate-pulse text-brand-cyan" />
            polling
          </span>
        )}
      </header>

      {available.length === 0 && !loading && (
        <p className="rounded-2xl border border-line bg-ink-800 px-4 py-6 text-center text-sm text-slate-500">
          No route available for this pair yet — try a different asset.
        </p>
      )}

      <div className="space-y-2">
        {available.map((quote) => {
          const isSelected = selected === quote.aggregator;
          const provider = providerFor(quote.aggregator);

          return (
            <button
              key={quote.aggregator}
              onClick={() => onSelect(quote.aggregator)}
              className={`w-full rounded-2xl border p-3 text-left transition-all ${
                isSelected
                  ? 'border-brand-cyan/70 bg-ink-550 shadow-lg shadow-cyan-950/30'
                  : 'border-line bg-ink-800/70 hover:border-line-strong hover:bg-ink-650'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold text-white">{quote.displayName}</span>

                    {quote.isBest && (
                      <span className="flex items-center gap-1 rounded border border-emerald-700/60 bg-emerald-950/80 px-1.5 py-px text-[9px] font-bold text-emerald-300">
                        <Flame className="h-2.5 w-2.5" />
                        BEST
                      </span>
                    )}

                    <SourceBadge source={quote.source} />
                  </div>

                  <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
                    {quote.route.length > 0
                      ? quote.route
                          .map((hop) => `${hop.name} ${hop.percent.toFixed(0)}%`)
                          .join(' · ')
                      : provider?.feeMechanism}
                  </p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Zap className="h-2.5 w-2.5" />
                      gas {formatUsd(quote.gasUsd)}
                    </span>
                    <span>impact {quote.priceImpactPct.toFixed(2)}%</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {formatEta(quote.etaSeconds)}
                    </span>
                    {quote.latencyMs !== undefined && <span>{quote.latencyMs}ms</span>}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm font-bold text-white">
                    {formatDisplay(BigInt(quote.netOut), toAsset.decimals, 6)}
                  </div>
                  <div className="font-mono text-[10px] text-slate-400">
                    {formatUsd(quote.netOutUsd)}
                  </div>
                  {quote.isBest && quote.advantageUsd !== undefined && quote.advantageUsd > 0.01 && (
                    <div className="font-mono text-[10px] font-semibold text-emerald-400">
                      +{formatUsd(quote.advantageUsd)}
                    </div>
                  )}
                </div>
              </div>

              {/* Fee transparency: what the user pays and what actually lands. */}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2 font-mono text-[10px]">
                <span className="text-slate-500">
                  fee {quote.fee.bps} bps on {quote.fee.chargedOn} ={' '}
                  <span className="text-brand-orange">{formatUsd(quote.fee.amountUsd)}</span>
                </span>
                {quote.fee.integratorShareBps !== undefined &&
                  quote.fee.integratorShareBps < 10_000 && (
                    <span className="text-amber-400/90">
                      operator keeps {(quote.fee.integratorShareBps / 100).toFixed(0)}% ={' '}
                      {formatUsd(quote.fee.netToOperatorUsd ?? 0)}
                    </span>
                  )}
              </div>

              {quote.notes?.map((note) => (
                <p key={note} className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  ↳ {note}
                </p>
              ))}
            </button>
          );
        })}
      </div>

      {unavailable.length > 0 && (
        <details className="group mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300">
            <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
            {unavailable.length} provider{unavailable.length === 1 ? '' : 's'} cannot route this pair
          </summary>
          <ul className="mt-2 space-y-1">
            {unavailable.map((quote) => (
              <li
                key={quote.aggregator}
                className="flex items-center gap-2 rounded-xl border border-line-soft bg-ink-800/50 px-3 py-1.5 text-[11px] text-slate-500"
              >
                <Ban className="h-3 w-3 shrink-0 text-slate-600" />
                <span className="font-semibold text-slate-400">{quote.displayName}</span>
                <span className="truncate">— {quote.unavailableReason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};

const SourceBadge: React.FC<{ source: 'live' | 'simulated' }> = ({ source }) =>
  source === 'live' ? (
    <span className="flex items-center gap-1 rounded border border-cyan-700/50 bg-cyan-950/60 px-1.5 py-px text-[9px] font-bold text-cyan-300">
      <span className="h-1 w-1 animate-pulse rounded-full bg-cyan-400" />
      LIVE
    </span>
  ) : (
    <span
      className="rounded border border-slate-600/50 bg-slate-800/60 px-1.5 py-px text-[9px] font-bold text-slate-400"
      title="Deterministic estimate — no upstream API key configured or the API is unreachable"
    >
      SIMULATED
    </span>
  );

function formatEta(seconds: number): string {
  if (seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
