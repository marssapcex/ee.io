import {
  ArrowDown,
  Check,
  ChevronDown,
  Clipboard,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AddressValidation } from '../../shared/address';
import { formatDisplay, formatUsd, parseUnits } from '../../shared/money';
import type { QuoteResponse, RateType } from '../../shared/types';
import type { AssetSummary } from '../lib/api';
import { api } from '../lib/api';
import { AssetIcon } from './AssetIcon';

interface Props {
  fromAsset: AssetSummary;
  toAsset: AssetSummary;
  quote: QuoteResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  sendInput: string;
  receiveInput: string;
  side: 'send' | 'receive';
  rateType: RateType;
  destination: string;
  feeBps: number;
  onSendInput: (value: string) => void;
  onReceiveInput: (value: string) => void;
  onRateType: (value: RateType) => void;
  onDestination: (value: string) => void;
  onOpenFrom: () => void;
  onOpenTo: () => void;
  onFlip: () => void;
  onRefresh: () => void;
  onSubmit: () => void;
  submitting: boolean;
}

export const SwapCard: React.FC<Props> = ({
  fromAsset,
  toAsset,
  quote,
  loading,
  refreshing,
  error,
  sendInput,
  receiveInput,
  side,
  rateType,
  destination,
  feeBps,
  onSendInput,
  onReceiveInput,
  onRateType,
  onDestination,
  onOpenFrom,
  onOpenTo,
  onFlip,
  onRefresh,
  onSubmit,
  submitting,
}) => {
  const [addressTouched, setAddressTouched] = useState(false);
  const [validation, setValidation] = useState<AddressValidation | null>(null);
  const [spin, setSpin] = useState(false);

  // Validate server-side so the browser and the execution path share one
  // implementation of the rules.
  useEffect(() => {
    const value = destination.trim();
    if (!value) {
      setValidation(null);
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => {
      api
        .validateAddress(toAsset.id, value, ac.signal)
        .then(setValidation)
        .catch(() => undefined);
    }, 180);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [destination, toAsset.id]);

  const isAddressValid = Boolean(destination.trim() && validation?.isValid);
  const showAddressError =
    addressTouched && destination.trim().length > 0 && validation && !validation.isValid;

  const sendUsd = quote?.sendUsd ?? estimateUsd(sendInput, fromAsset);
  const receiveUsd = quote?.receiveUsd ?? 0;

  const minAmount = useMemo(() => thresholdAmount(fromAsset, fromAsset.minUsd), [fromAsset]);
  const maxAmount = useMemo(() => thresholdAmount(fromAsset, fromAsset.maxUsd), [fromAsset]);

  const belowMin = sendUsd > 0 && sendUsd < fromAsset.minUsd;
  const aboveMax = sendUsd > fromAsset.maxUsd;

  const handleFlip = useCallback(() => {
    setSpin(true);
    onFlip();
    setTimeout(() => setSpin(false), 400);
  }, [onFlip]);

  const paste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        onDestination(text.trim());
        setAddressTouched(true);
      }
    } catch {
      /* clipboard blocked — typing still works */
    }
  }, [onDestination]);

  const canSubmit =
    isAddressValid && !belowMin && !aboveMax && !!quote?.best && !loading && !submitting;

  return (
    <section className="overflow-hidden rounded-3xl border border-line bg-ink-850 shadow-card">
      {/* Amount boxes */}
      <div className="relative p-2">
        <AmountBox
          label="Send"
          asset={fromAsset}
          value={sendInput}
          onChange={onSendInput}
          onPick={onOpenFrom}
          usd={sendUsd}
          invalid={belowMin || aboveMax}
          busy={refreshing && side === 'receive'}
          accent="orange"
        />

        <div className="relative z-10 -my-2.5 flex justify-center">
          <button
            onClick={handleFlip}
            aria-label="Swap direction"
            className="group grid h-9 w-9 place-items-center rounded-xl border-2 border-ink-850 bg-ink-600 text-white/70 transition-all hover:bg-ink-500 hover:text-brand-cyan active:scale-90"
          >
            <ArrowDown
              className={`h-4 w-4 transition-transform duration-[400ms] ${spin ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        <AmountBox
          label="Receive"
          asset={toAsset}
          value={receiveInput}
          onChange={onReceiveInput}
          onPick={onOpenTo}
          usd={receiveUsd}
          busy={refreshing && side === 'send'}
          accent="cyan"
        />
      </div>

      {/* Limits */}
      <div className="flex items-center justify-between px-5 pb-3 font-mono text-[10px] text-white/30">
        <span>
          min{' '}
          <button
            onClick={() => onSendInput(minAmount)}
            className={belowMin ? 'font-bold text-brand-orange underline' : 'text-white/45'}
          >
            {minAmount}
          </button>
        </span>
        <span>
          max{' '}
          <button
            onClick={() => onSendInput(maxAmount)}
            className={aboveMax ? 'font-bold text-brand-orange underline' : 'text-white/45'}
          >
            {maxAmount}
          </button>
        </span>
      </div>

      {/* Destination */}
      <div className="px-2 pb-2">
        <div
          className={`rounded-2xl border bg-ink-800 transition-colors ${
            showAddressError
              ? 'border-brand-red/50'
              : isAddressValid
                ? 'border-brand-green/40'
                : 'border-line focus-within:border-line-glow'
          }`}
        >
          <div className="flex items-center justify-between px-4 pt-3">
            <label htmlFor="destination" className="text-[11px] font-semibold text-white/40">
              Destination
            </label>
            <span className="font-mono text-[10px] text-white/25">
              {toAsset.chainName}
            </span>
          </div>
          <div className="flex items-center gap-1 px-4 pb-3 pt-1">
            <input
              id="destination"
              value={destination}
              onChange={(e) => {
                onDestination(e.target.value);
                setAddressTouched(true);
              }}
              onBlur={() => setAddressTouched(true)}
              placeholder={toAsset.addressPlaceholder}
              spellCheck={false}
              autoComplete="off"
              className="w-full bg-transparent font-mono text-[13px] text-white outline-none placeholder:text-white/20"
            />
            {isAddressValid ? (
              <Check className="h-4 w-4 shrink-0 text-brand-green" />
            ) : (
              <button
                onClick={paste}
                aria-label="Paste address"
                className="shrink-0 rounded-lg p-1 text-white/30 transition-colors hover:bg-ink-600 hover:text-white"
              >
                <Clipboard className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {showAddressError && (
          <p className="animate-fade-in px-4 pt-1.5 text-[11px] text-brand-red">
            {validation?.message}
          </p>
        )}
      </div>

      {/* Rate toggle */}
      <div className="grid grid-cols-2 gap-2 px-2 pb-2">
        <RatePill
          active={rateType === 'float'}
          onClick={() => onRateType('float')}
          title="Float"
          sub={`${(feeBps / 100).toFixed(2)}%`}
          accent="cyan"
        />
        <RatePill
          active={rateType === 'fixed'}
          onClick={() => onRateType('fixed')}
          title="Fixed"
          sub="1.00%"
          accent="orange"
        />
      </div>

      {/* Submit */}
      <div className="px-2 pb-2">
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className="w-full rounded-2xl bg-gradient-to-r from-brand-cyan to-brand-teal py-4 text-[15px] font-extrabold tracking-tight text-ink-950 transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-ink-700 disabled:bg-none disabled:text-white/25"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Building route
            </span>
          ) : !isAddressValid && destination.trim().length === 0 ? (
            'Enter destination address'
          ) : belowMin ? (
            `Minimum ${minAmount} ${fromAsset.symbol}`
          ) : aboveMax ? (
            `Maximum ${maxAmount} ${fromAsset.symbol}`
          ) : (
            'Exchange now'
          )}
        </button>
      </div>

      {/* Rate strip */}
      <div className="flex items-center justify-between border-t border-line-soft px-5 py-2.5 font-mono text-[10px]">
        <span className="text-white/35">
          {quote ? (
            <>
              1 {fromAsset.symbol} ={' '}
              <span className="text-white/70">{formatRate(quote.unitRate)}</span> {toAsset.symbol}
            </>
          ) : (
            '—'
          )}
        </span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-white/35 transition-colors hover:text-brand-cyan disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${loading || refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <p className="flex items-start gap-2 border-t border-brand-red/20 bg-brand-red/5 px-5 py-2.5 text-[11px] text-brand-red">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {quote?.warnings.map((warning) => (
        <p
          key={warning}
          className="flex items-start gap-2 border-t border-brand-amber/20 bg-brand-amber/5 px-5 py-2.5 text-[11px] text-brand-amber"
        >
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          {warning}
        </p>
      ))}
    </section>
  );
};

/* ------------------------------------------------------------- subviews */

const AmountBox: React.FC<{
  label: string;
  asset: AssetSummary;
  value: string;
  onChange: (v: string) => void;
  onPick: () => void;
  usd: number;
  invalid?: boolean;
  busy?: boolean;
  accent: 'cyan' | 'orange';
}> = ({ label, asset, value, onChange, onPick, usd, invalid, busy, accent }) => (
  <div
    className={`rounded-2xl border bg-ink-800 p-4 transition-colors ${
      invalid ? 'border-brand-red/50' : 'border-line focus-within:border-line-glow'
    }`}
  >
    <div className="mb-1.5 flex items-center justify-between">
      <span className="text-[11px] font-semibold text-white/40">{label}</span>
      <span className="font-mono text-[10px] text-white/25">
        {usd > 0 ? formatUsd(usd) : ''}
      </span>
    </div>

    <div className="flex items-center gap-3">
      <input
        value={value}
        onChange={(e) => {
          const next = e.target.value.replace(/,/g, '.');
          if (next === '' || /^\d*\.?\d*$/.test(next)) onChange(next);
        }}
        inputMode="decimal"
        placeholder="0"
        aria-label={label === 'Send' ? 'You send' : 'You receive'}
        className={`tabular w-full min-w-0 bg-transparent font-mono text-[30px] font-bold leading-none outline-none placeholder:text-white/15 ${
          accent === 'cyan' ? 'text-brand-cyan' : 'text-white'
        } ${busy ? 'opacity-50' : ''}`}
      />

      <button
        onClick={onPick}
        className="flex shrink-0 items-center gap-2 rounded-xl border border-line bg-ink-700 py-1.5 pl-1.5 pr-2.5 transition-all hover:border-line-strong hover:bg-ink-600"
      >
        <AssetIcon asset={asset} size={24} />
        <div className="text-left leading-tight">
          <div className="font-mono text-[13px] font-bold text-white">{asset.symbol}</div>
          <div className="font-mono text-[9px] text-white/35">{asset.chainName}</div>
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-white/35" />
      </button>
    </div>
  </div>
);

const RatePill: React.FC<{
  active: boolean;
  onClick: () => void;
  title: string;
  sub: string;
  accent: 'cyan' | 'orange';
}> = ({ active, onClick, title, sub, accent }) => (
  <button
    onClick={onClick}
    className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 transition-all ${
      active
        ? accent === 'cyan'
          ? 'border-brand-cyan/50 bg-brand-cyan/10'
          : 'border-brand-orange/50 bg-brand-orange/10'
        : 'border-line bg-ink-800 hover:border-line-strong'
    }`}
  >
    <span
      className={`text-[12px] font-bold ${
        active ? (accent === 'cyan' ? 'text-brand-cyan' : 'text-brand-orange') : 'text-white/45'
      }`}
    >
      {title}
    </span>
    <span className={`font-mono text-[10px] ${active ? 'text-white/55' : 'text-white/25'}`}>
      {sub}
    </span>
  </button>
);

/* -------------------------------------------------------------- helpers */

function estimateUsd(input: string, asset: AssetSummary): number {
  const value = parseFloat(input);
  return Number.isFinite(value) ? value * asset.usdPrice : 0;
}

function thresholdAmount(asset: AssetSummary, usd: number): string {
  if (asset.usdPrice <= 0) return '0';
  const raw = usd / asset.usdPrice;
  const base = parseUnits(raw.toFixed(Math.min(asset.decimals, 8)), asset.decimals);
  return formatDisplay(base, asset.decimals, asset.usdPrice > 1000 ? 6 : 4);
}

function formatRate(rate: number): string {
  if (rate === 0) return '—';
  if (rate >= 1000) return rate.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (rate >= 1) return rate.toFixed(4);
  if (rate >= 0.0001) return rate.toFixed(8);
  return rate.toExponential(4);
}
