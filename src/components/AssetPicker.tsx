import { Check, Search, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetSummary } from '../lib/api';
import { formatUsd } from '../../shared/money';
import { AssetIcon } from './AssetIcon';

interface Props {
  open: boolean;
  title: string;
  assets: AssetSummary[];
  selectedId: string;
  /** Asset on the other side of the pair — shown as unavailable. */
  excludeId?: string;
  onSelect: (asset: AssetSummary) => void;
  onClose: () => void;
}

export const AssetPicker: React.FC<Props> = ({
  open,
  title,
  assets,
  selectedId,
  excludeId,
  onSelect,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [chainFilter, setChainFilter] = useState<string>('all');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setChainFilter('all');
      setCursor(0);
      // Delay so the element exists and the modal transition has begun.
      const timer = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const chains = useMemo(() => {
    const seen = new Map<string, string>();
    for (const asset of assets) seen.set(asset.chain, asset.chainName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [assets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets
      .filter((asset) => chainFilter === 'all' || asset.chain === chainFilter)
      .filter((asset) => {
        if (!q) return true;
        return (
          asset.symbol.toLowerCase().includes(q) ||
          asset.name.toLowerCase().includes(q) ||
          asset.chainName.toLowerCase().includes(q) ||
          asset.address?.toLowerCase() === q
        );
      })
      .sort((a, b) => {
        // Exact symbol match first, then popularity, then alphabetical.
        if (q) {
          const aExact = a.symbol.toLowerCase() === q ? 1 : 0;
          const bExact = b.symbol.toLowerCase() === q ? 1 : 0;
          if (aExact !== bExact) return bExact - aExact;
        }
        if (a.popular !== b.popular) return a.popular ? -1 : 1;
        return a.symbol.localeCompare(b.symbol);
      });
  }, [assets, query, chainFilter]);

  useEffect(() => setCursor(0), [query, chainFilter]);

  // Keep the highlighted row inside the scroll viewport.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCursor((c) => Math.min(c + 1, filtered.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (event.key === 'Enter') {
        const asset = filtered[cursor];
        if (asset && asset.id !== excludeId) {
          event.preventDefault();
          onSelect(asset);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, cursor, excludeId, onSelect, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[8vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex max-h-[76vh] w-full max-w-lg animate-slide-up flex-col overflow-hidden rounded-[16px] border border-white/[0.08] bg-[#15151a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-line-soft px-5 py-4">
          <h2 className="text-sm font-bold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/45 transition-colors hover:bg-ink-600 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 border-b border-line-soft px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a currency or ticker"
              className="w-full rounded-[10px] border border-white/[0.10] bg-ink-900 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-white/15 focus:outline-none focus:ring-2 focus:ring-white/10"
            />
          </div>

          <div className="scrollbar-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <FilterChip active={chainFilter === 'all'} onClick={() => setChainFilter('all')}>
              All networks
            </FilterChip>
            {chains.map(([id, name]) => (
              <FilterChip key={id} active={chainFilter === id} onClick={() => setChainFilter(id)}>
                {name}
              </FilterChip>
            ))}
          </div>
        </div>

        <div ref={listRef} className="scrollbar-thin flex-1 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-white/35">
              No assets match “{query}”.
            </p>
          )}
          {filtered.length > 0 && !query && chainFilter === 'all' && (
            <p className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-widest text-white/30">Popular currencies</p>
          )}
          {filtered.length > 0 && (query || chainFilter !== 'all') && (
            <p className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-widest text-white/30">All currencies</p>
          )}

          {filtered.map((asset, index) => {
            const isSelected = asset.id === selectedId;
            const isExcluded = asset.id === excludeId;
            const isPopular = asset.popular;
            return (
              <button
                key={asset.id}
                data-index={index}
                disabled={isExcluded}
                onMouseEnter={() => setCursor(index)}
                onClick={() => onSelect(asset)}
                className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                  isExcluded
                    ? 'cursor-not-allowed opacity-35'
                    : index === cursor
                      ? 'bg-white/[0.06]'
                      : isPopular && !query && chainFilter==='all'
                        ? 'bg-white/[0.02] hover:bg-white/[0.04]'
                        : 'hover:bg-white/[0.04]'
                }`}
              >
                <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full ring-1 ring-white/10"><AssetIcon asset={asset} size={32} /></span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-white">{asset.symbol}</span>
                    <span
                      className={`rounded border px-1.5 py-px font-mono text-[10px] ${asset.chainColor.bg} ${asset.chainColor.text} ${asset.chainColor.border}`}
                    >
                      {asset.chainName}
                    </span>
                    {isExcluded && (
                      <span className="text-[11px] text-white/35">already selected</span>
                    )}
                  </div>
                  <p className="truncate text-xs text-white/45">{asset.name}</p>
                </div>

                <div className="text-right">
                  <div className="font-mono text-xs text-white/70">
                    {formatUsd(asset.usdPrice)}
                  </div>
                  {isSelected && (
                    <Check className="ml-auto mt-0.5 h-3.5 w-3.5 text-brand-cyan" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="border-t border-line-soft px-5 py-2.5 text-[12px] text-white/35">
          <kbd className="rounded bg-ink-700 px-1 font-mono">↑↓</kbd> navigate ·{' '}
          <kbd className="rounded bg-ink-700 px-1 font-mono">↵</kbd> select ·{' '}
          <kbd className="rounded bg-ink-700 px-1 font-mono">esc</kbd> close
        </div>
      </div>
    </div>
  );
};

const FilterChip: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
      active
        ? 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan'
        : 'border-line bg-ink-800 text-white/45 hover:text-white/80'
    }`}
  >
    {children}
  </button>
);
