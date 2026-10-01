import { History, ExternalLink, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import type { AssetSummary } from '../lib/api';

interface Props {
  assets: AssetSummary[];
  /** Resume a tracker by id; the app fetches the record and reopens the flow. */
  onResume?: (id: string, kind: 'order' | 'deposit') => void;
}

interface RecentEntry {
  id: string;
  kind: 'order' | 'deposit';
  pair: string;
  at: number;
}

export const Navbar: React.FC<Props> = ({ assets, onResume }) => {
  const btc = assets.find((a) => a.symbol === 'BTC');
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [open, setOpen] = useState(false);

  // localStorage is the account — reread on every navigation-level update.
  useEffect(() => {
    const read = () => {
      try {
        setRecent(JSON.parse(localStorage.getItem('ee:recent') ?? '[]') as RecentEntry[]);
      } catch {
        setRecent([]);
      }
    };
    read();
    window.addEventListener('ee:recent-updated', read);
    return () => window.removeEventListener('ee:recent-updated', read);
  }, []);

  const remove = (id: string) => {
    const next = recent.filter((e) => e.id !== id);
    try {
      localStorage.setItem('ee:recent', JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setRecent(next);
  };

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

          {recent.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setOpen((v) => !v)}
                aria-label="Recent orders"
                className="flex items-center gap-2 rounded-full border border-line bg-ink-850 px-3 py-1.5 text-[11px] font-semibold text-white/55 hover:text-white"
              >
                <History className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Recent</span>
                <span className="grid h-4 w-4 place-items-center rounded-full bg-brand-cyan/15 font-mono text-[9px] font-bold text-brand-cyan">
                  {recent.length}
                </span>
              </button>

              {open && (
                <div className="absolute right-0 mt-2 w-[300px] overflow-hidden rounded-[14px] border border-line bg-ink-800 shadow-2xl">
                  <div className="border-b border-line px-3.5 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">
                    Recent swaps
                  </div>
                  <ul className="max-h-[280px] divide-y divide-white/[0.04] overflow-y-auto">
                    {recent.map((entry) => (
                      <li key={entry.id} className="group flex items-center gap-1 px-3.5 py-2.5">
                        <button
                          onClick={() => {
                            setOpen(false);
                            // A shareable link survives browser restarts.
                            onResume?.(entry.id, entry.kind);
                          }}
                          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-mono text-[12px] font-semibold text-white">
                              {entry.id}
                            </div>
                            <div className="truncate text-[10px] text-white/35">{entry.pair}</div>
                          </div>
                          <ExternalLink className="h-3 w-3 shrink-0 text-white/20 group-hover:text-brand-cyan" />
                        </button>
                        <button
                          onClick={() => remove(entry.id)}
                          aria-label={`Remove ${entry.id}`}
                          className="rounded-md p-1 text-white/15 opacity-0 transition group-hover:opacity-100 hover:text-white/60"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <button className="rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-black transition hover:bg-white/90">
            Get started
          </button>
        </div>
      </div>
    </header>
  );
};
