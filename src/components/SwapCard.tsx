import {
  ArrowRight,
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
    <section className="overflow-hidden rounded-[20px] border border-line bg-ink-850 shadow-card">
      {/* ---- Row 1: Send | flip | Receive, side by side ---- */}
      <div className="relative grid items-stretch gap-4 p-5 md:grid-cols-[1fr_auto_1fr] md:gap-5 md:p-6">
        <AmountBox
          label="You send"
          asset={fromAsset}
          value={sendInput}
          onChange={onSendInput}
          onPick={onOpenFrom}
          usd={sendUsd}
          invalid={belowMin || aboveMax}
          busy={refreshing && side === 'receive'}
          accent="plain"
          footer={
            <div className="flex items-center gap-2 font-mono text-[11px] text-white/35">
              <button
                onClick={() => onSendInput(minAmount)}
                className={`rounded-md px-1.5 py-0.5 transition-colors hover:bg-white/5 hover:text-white/70 ${
                  belowMin ? 'font-semibold text-brand-red' : ''
                }`}
              >
                min {minAmount}
              </button>
              <button
                onClick={() => onSendInput(maxAmount)}
                className={`rounded-md px-1.5 py-0.5 transition-colors hover:bg-white/5 hover:text-white/70 ${
                  aboveMax ? 'font-semibold text-brand-red' : ''
                }`}
              >
                max {maxAmount}
              </button>
            </div>
          }
        />

        {/* Flip control: between the boxes on desktop, between rows on mobile. */}
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center md:static md:inset-auto md:self-center">
          <button
            onClick={handleFlip}
            aria-label="Swap direction"
            className="pointer-events-auto grid h-11 w-11 place-items-center rounded-full border-4 border-ink-850 bg-ink-700 text-white/55 transition-all duration-200 hover:bg-ink-600 hover:text-brand-cyan hover:shadow-glow-mint active:scale-90"
          >
            <ArrowRight
              className={`h-4 w-4 rotate-90 transition-transform duration-[400ms] md:rotate-0 ${
                spin ? 'rotate-[270deg] md:rotate-180' : ''
              }`}
            />
          </button>
        </div>

        <AmountBox
          label="You get"
          asset={toAsset}
          value={receiveInput}
          onChange={onReceiveInput}
          onPick={onOpenTo}
          usd={receiveUsd}
          busy={refreshing && side === 'send'}
          accent="mint"
          footer={
            <div className="flex items-center gap-2 font-mono text-[11px] text-white/35">
              {quote ? (
                <>
                  <span className="truncate">
                    1 {fromAsset.symbol} ={' '}
                    <span className="text-white/65">{formatRate(quote.unitRate)}</span>{' '}
                    {toAsset.symbol}
                  </span>
                  <button
                    onClick={onRefresh}
                    disabled={loading}
                    aria-label="Refresh quote"
                    className="shrink-0 rounded-md p-1 transition-colors hover:bg-white/5 hover:text-brand-cyan disabled:opacity-40"
                  >
                    <RefreshCw className={`h-3 w-3 ${loading || refreshing ? 'animate-spin' : ''}`} />
                  </button>
                </>
              ) : (
                <span>—</span>
              )}
            </div>
          }
        />
      </div>

      {/* ---- Row 2: destination, full width ---- */}
      <div className="px-5 pb-5 md:px-6 md:pb-6">
        <div
          className={`flex items-center gap-3 rounded-2xl border bg-ink-800 px-5 py-4 transition-all duration-200 ${
            showAddressError
              ? 'border-brand-red/45'
              : isAddressValid
                ? 'border-brand-greenMid/45'
                : 'border-line hover:border-line-strong focus-within:border-line-glow'
          }`}
        >
          <label htmlFor="destination" className="shrink-0 text-[12px] font-medium text-white/45">
            Destination
          </label>
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
            className="w-full min-w-0 bg-transparent font-mono text-[14px] text-white outline-none placeholder:text-white/20"
          />
          <span className="hidden shrink-0 font-mono text-[11px] text-white/40 sm:block">
            {toAsset.chainName}
          </span>
          {isAddressValid ? (
            <Check className="h-4 w-4 shrink-0 text-brand-greenBright" />
          ) : (
            <button
              onClick={paste}
              aria-label="Paste address"
              className="shrink-0 rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white"
            >
              <Clipboard className="h-4 w-4" />
            </button>
          )}
        </div>

        {showAddressError && (
          <p className="animate-fade-in px-1 pt-2 text-[12px] text-brand-red">
            {validation?.message}
          </p>
        )}
      </div>

      {/* ---- Row 3: rate type + submit ---- */}
      <div className="grid gap-3 px-5 pb-5 md:grid-cols-[minmax(260px,auto)_1fr] md:px-6 md:pb-6">
        <div className="grid grid-cols-2 gap-2">
          <RatePill
            active={rateType === 'float'}
            onClick={() => onRateType('float')}
            title="Float"
            sub={`${(feeBps / 100).toFixed(2)}%`}
            tone="green"
          />
          <RatePill
            active={rateType === 'fixed'}
            onClick={() => onRateType('fixed')}
            title="Fixed"
            sub="1.00%"
            tone="red"
          />
        </div>

        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className="group rounded-xl bg-brand-green py-4 text-[15px] font-semibold tracking-tight text-white transition-all duration-200 hover:bg-brand-greenMid hover:shadow-glow-green active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-ink-750 disabled:text-white/40 disabled:shadow-none"
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

      {error && (
        <p className="flex items-start gap-2 border-t border-brand-red/20 bg-brand-red/[0.07] px-6 py-3.5 text-[12px] text-brand-red">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {quote?.warnings.map((warning) => (
        <p
          key={warning}
          className="flex items-start gap-2 border-t border-brand-amber/20 bg-brand-amber/[0.07] px-6 py-3.5 text-[12px] text-brand-amber"
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
  accent: 'mint' | 'plain';
  footer: React.ReactNode;
}> = ({ label, asset, value, onChange, onPick, usd, invalid, busy, accent, footer }) => (
  <div
    className={`flex flex-col justify-between rounded-2xl border bg-ink-800 p-5 transition-all duration-200 ${
      invalid
        ? 'border-brand-red/45'
        : 'border-line hover:border-line-strong focus-within:border-line-glow'
    }`}
  >
    <div className="mb-5 flex items-center justify-between gap-3">
      <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-white/40">
        {label}
      </span>
      <button
        onClick={onPick}
        aria-label={`${label === 'You send' ? 'Change send asset' : 'Change receive asset'} — currently ${asset.symbol} on ${asset.chainName}`}
        className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-ink-700 py-1.5 pl-1.5 pr-3 transition-all duration-200 hover:border-line-strong hover:bg-ink-650"
      >
        <AssetIcon asset={asset} size={26} showChain />
        <span className="text-[14px] font-semibold text-white">{asset.symbol}</span>
        <ChevronDown className="h-3.5 w-3.5 text-white/35" />
      </button>
    </div>

    <input
      value={value}
      onChange={(e) => {
        const next = e.target.value.replace(/,/g, '.');
        if (next === '' || /^\d*\.?\d*$/.test(next)) onChange(next);
      }}
      inputMode="decimal"
      placeholder="0"
      aria-label={label === 'You send' ? 'You send' : 'You receive'}
      className={`tabular w-full min-w-0 bg-transparent text-[38px] font-semibold leading-none tracking-tight outline-none placeholder:text-white/15 ${
        accent === 'mint' ? 'text-brand-cyan' : 'text-white'
      } ${busy ? 'opacity-50' : ''}`}
    />

    <div className="mt-4 flex items-center justify-between gap-2">
      <span className="font-mono text-[11px] text-white/40">{usd > 0 ? formatUsd(usd) : ''}</span>
      {footer}
    </div>
  </div>
);

/**
 * Float / Fixed, styled as Polymarket's Yes / No pair — muted green and red
 * that read instantly without glowing.
 */
const RatePill: React.FC<{
  active: boolean;
  onClick: () => void;
  title: string;
  sub: string;
  tone: 'green' | 'red';
}> = ({ active, onClick, title, sub, tone }) => (
  <button
    onClick={onClick}
    className={`flex items-center justify-center gap-2 rounded-xl border py-4 transition-all duration-200 ${
      active
        ? tone === 'green'
          ? 'border-brand-greenMid/50 bg-brand-greenMid/15 text-brand-greenBright'
          : 'border-brand-red/50 bg-brand-red/15 text-brand-redBright'
        : tone === 'green'
          ? 'border-line bg-ink-800 text-white/45 hover:border-brand-greenMid/35 hover:bg-brand-greenMid/[0.08] hover:text-brand-greenBright'
          : 'border-line bg-ink-800 text-white/45 hover:border-brand-red/35 hover:bg-brand-red/[0.08] hover:text-brand-redBright'
    }`}
  >
    <span className="text-[14px] font-semibold">{title}</span>
    <span className={`font-mono text-[11px] ${active ? 'opacity-70' : 'opacity-50'}`}>{sub}</span>
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
