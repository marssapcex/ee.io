import {
  AlertTriangle,
  ArrowDownUp,
  Check,
  ChevronDown,
  Clipboard,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AddressValidation } from '../../shared/address';
import { formatDisplay, formatUnits, formatUsd, parseUnits } from '../../shared/money';
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
  const [flipping, setFlipping] = useState(false);

  // Validate the destination on the server so the browser and the execution
  // path agree on exactly one implementation of the rules.
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
  const showAddressError = addressTouched && destination.trim().length > 0 && validation && !validation.isValid;

  const sendUsd = quote?.sendUsd ?? estimateUsd(sendInput, fromAsset);
  const receiveUsd = quote?.receiveUsd ?? 0;

  const minAmount = useMemo(() => thresholdAmount(fromAsset, fromAsset.minUsd), [fromAsset]);
  const maxAmount = useMemo(() => thresholdAmount(fromAsset, fromAsset.maxUsd), [fromAsset]);

  const belowMin = sendUsd > 0 && sendUsd < fromAsset.minUsd;
  const aboveMax = sendUsd > fromAsset.maxUsd;

  const handleFlip = useCallback(() => {
    setFlipping(true);
    onFlip();
    setTimeout(() => setFlipping(false), 420);
  }, [onFlip]);

  const pasteAddress = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        onDestination(text.trim());
        setAddressTouched(true);
      }
    } catch {
      // Clipboard permission denied — the user can still type.
    }
  }, [onDestination]);

  const canSubmit =
    isAddressValid && !belowMin && !aboveMax && !!quote?.best && !loading && !submitting;

  return (
    <section className="w-full max-w-2xl rounded-3xl border border-line bg-ink-700/95 p-5 shadow-2xl backdrop-blur-md sm:p-6">
      <div className="space-y-2.5">
        <AmountField
          label="You send"
          asset={fromAsset}
          value={sendInput}
          onChange={onSendInput}
          onOpenPicker={onOpenFrom}
          usd={sendUsd}
          accent="orange"
          invalid={belowMin || aboveMax}
          computed={side === 'receive'}
          busy={refreshing && side === 'receive'}
        />

        <div className="relative flex h-0 items-center justify-center">
          <button
            onClick={handleFlip}
            title="Swap direction"
            aria-label="Swap direction"
            className="absolute z-10 grid h-10 w-10 place-items-center rounded-2xl border border-line-strong bg-ink-500 text-brand-cyan shadow-lg transition-all hover:border-brand-cyan hover:bg-ink-450 active:scale-90"
          >
            <ArrowDownUp
              className={`h-4 w-4 transition-transform duration-[400ms] ${flipping ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        <AmountField
          label="You receive"
          asset={toAsset}
          value={receiveInput}
          onChange={onReceiveInput}
          onOpenPicker={onOpenTo}
          usd={receiveUsd}
          accent="cyan"
          computed={side === 'send'}
          busy={refreshing && side === 'send'}
        />
      </div>

      {/* Min / max with one-tap correction, as FixedFloat does. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 font-mono text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5">
          Min <span className="text-slate-200">{minAmount} {fromAsset.symbol}</span>
          {belowMin && (
            <button
              onClick={() => onSendInput(minAmount)}
              className="font-sans font-semibold text-brand-orange underline underline-offset-2 hover:text-orange-300"
            >
              set min
            </button>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          Max <span className="text-slate-200">{maxAmount} {fromAsset.symbol}</span>
          {aboveMax && (
            <button
              onClick={() => onSendInput(maxAmount)}
              className="font-sans font-semibold text-brand-orange underline underline-offset-2 hover:text-orange-300"
            >
              set max
            </button>
          )}
        </span>
      </div>

      {/* Destination address */}
      <div className="mt-4 space-y-1.5">
        <label
          htmlFor="destination"
          className="flex items-center justify-between text-xs font-semibold text-slate-300"
        >
          <span>Destination address</span>
          <span className="font-normal text-slate-500">
            Your {toAsset.chainName} wallet
          </span>
        </label>

        <div className="relative flex items-center">
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
            className={`w-full rounded-2xl border bg-ink-800 py-3 pl-4 pr-12 font-mono text-xs text-white transition-colors placeholder:text-slate-600 focus:outline-none sm:text-sm ${
              showAddressError
                ? 'border-red-500/70 focus:border-red-500'
                : isAddressValid
                  ? 'border-emerald-500/60 focus:border-emerald-500'
                  : 'border-line focus:border-brand-cyan'
            }`}
          />
          <button
            onClick={pasteAddress}
            title="Paste from clipboard"
            aria-label="Paste address"
            className="absolute right-2.5 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-ink-500 hover:text-white"
          >
            <Clipboard className="h-4 w-4" />
          </button>
        </div>

        {showAddressError && (
          <p className="flex animate-fade-in items-center gap-1.5 pl-1 text-[11px] text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {validation?.message}
          </p>
        )}
        {isAddressValid && (
          <p className="flex animate-fade-in items-center gap-1.5 pl-1 text-[11px] text-emerald-400">
            <Check className="h-3.5 w-3.5 shrink-0" />
            Valid {toAsset.chainName} address
            {validation?.warning && (
              <span className="text-amber-400"> · {validation.warning}</span>
            )}
          </p>
        )}
      </div>

      {/* Rate type + submit */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="inline-flex rounded-2xl border border-line bg-ink-800 p-1"
          role="group"
          aria-label="Rate type"
        >
          <RateButton
            active={rateType === 'float'}
            onClick={() => onRateType('float')}
            title="Float rate"
            subtitle={`${(feeBps / 100).toFixed(2)}% fee`}
            accent="cyan"
          />
          <RateButton
            active={rateType === 'fixed'}
            onClick={() => onRateType('fixed')}
            title="Fixed rate"
            subtitle="1.00% fee"
            accent="orange"
          />
        </div>

        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 via-cyan-400 to-teal-400 px-6 py-3.5 text-sm font-extrabold tracking-wide text-ink-900 shadow-xl shadow-cyan-500/20 transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 sm:w-auto sm:min-w-[210px]"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Building route…
            </>
          ) : (
            <>
              <Zap className="h-4 w-4 fill-ink-900" />
              Exchange now
            </>
          )}
        </button>
      </div>

      {/* Status line */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3 text-[11px]">
        <div className="flex items-center gap-1.5 text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          <span>Non-custodial — ee.io never holds your funds</span>
        </div>

        <div className="flex items-center gap-3">
          {quote && (
            <span className="font-mono text-slate-500">
              1 {fromAsset.symbol} ≈ {formatRate(quote.unitRate)} {toAsset.symbol}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1 font-semibold text-slate-400 transition-colors hover:text-brand-cyan disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading || refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 flex items-center gap-2 rounded-xl border border-red-800/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {quote?.warnings.map((warning) => (
        <p
          key={warning}
          className="mt-2 flex items-start gap-2 rounded-xl border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200/90"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {warning}
        </p>
      ))}
    </section>
  );
};

/* ------------------------------------------------------------- subviews */

interface AmountFieldProps {
  label: string;
  asset: AssetSummary;
  value: string;
  onChange: (value: string) => void;
  onOpenPicker: () => void;
  usd: number;
  accent: 'cyan' | 'orange';
  invalid?: boolean;
  /** This side is derived from the other one. */
  computed?: boolean;
  busy?: boolean;
}

const AmountField: React.FC<AmountFieldProps> = ({
  label,
  asset,
  value,
  onChange,
  onOpenPicker,
  usd,
  accent,
  invalid,
  computed,
  busy,
}) => {
  const ref = useRef<HTMLInputElement>(null);
  const focusRing =
    accent === 'cyan' ? 'focus-within:border-brand-cyan' : 'focus-within:border-brand-orange';

  return (
    <div
      className={`rounded-2xl border bg-ink-800 p-4 transition-colors ${
        invalid ? 'border-red-500/60' : `border-line hover:border-line-strong ${focusRing}`
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400">{label}</span>
        <span className="truncate text-xs text-slate-500">{asset.name}</span>
      </div>

      <div className="flex items-center gap-3">
        <input
          ref={ref}
          value={value}
          onChange={(e) => {
            // Permit only a well-formed decimal while typing.
            const next = e.target.value.replace(/,/g, '.');
            if (next === '' || /^\d*\.?\d*$/.test(next)) onChange(next);
          }}
          inputMode="decimal"
          placeholder="0.0"
          aria-label={label}
          className={`w-full min-w-0 bg-transparent font-mono text-2xl font-extrabold tabular-nums outline-none placeholder:text-slate-700 sm:text-3xl ${
            accent === 'cyan' ? 'text-brand-cyan' : 'text-white'
          } ${busy ? 'opacity-60' : ''}`}
        />

        <button
          onClick={onOpenPicker}
          className="group flex shrink-0 items-center gap-2 rounded-2xl border border-line bg-ink-600 py-2 pl-2 pr-2.5 transition-all hover:border-line-strong hover:bg-ink-450"
        >
          <AssetIcon asset={asset} size={26} />
          <span className="font-mono text-sm font-bold text-white">{asset.symbol}</span>
          <span
            className={`hidden rounded border px-1 py-px font-mono text-[9px] sm:inline ${asset.chainColor.bg} ${asset.chainColor.text} ${asset.chainColor.border}`}
          >
            {asset.chainName}
          </span>
          <ChevronDown className="h-4 w-4 text-slate-400 transition-colors group-hover:text-white" />
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-line-soft pt-2 text-[11px]">
        <span className="font-mono text-slate-500">
          {computed ? 'estimated' : 'exact'}
        </span>
        <span className="font-mono font-semibold text-slate-400">≈ {formatUsd(usd)}</span>
      </div>
    </div>
  );
};

const RateButton: React.FC<{
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  accent: 'cyan' | 'orange';
}> = ({ active, onClick, title, subtitle, accent }) => (
  <button
    onClick={onClick}
    className={`rounded-xl px-3.5 py-2 text-left transition-all ${
      active
        ? accent === 'cyan'
          ? 'border border-cyan-600/50 bg-cyan-950/70 text-brand-cyan'
          : 'border border-orange-600/50 bg-orange-950/60 text-brand-orange'
        : 'border border-transparent text-slate-400 hover:text-slate-200'
    }`}
  >
    <span className="block text-xs font-bold">{title}</span>
    <span className="block font-mono text-[10px] opacity-80">{subtitle}</span>
  </button>
);

/* -------------------------------------------------------------- helpers */

function estimateUsd(input: string, asset: AssetSummary): number {
  const value = parseFloat(input);
  return Number.isFinite(value) ? value * asset.usdPrice : 0;
}

/** Convert a USD threshold into a tidy token amount for the min/max chips. */
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

export { formatUnits };
