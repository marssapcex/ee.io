import { Loader2, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, parseUnits } from '../shared/money';
import type { DepositRecord, OrderRecord, QuoteRequest } from '../shared/types';
import { AssetPicker } from './components/AssetPicker';
import { ExecutionInspector } from './components/ExecutionInspector';
import { RocketLaunch } from './components/RocketLaunch';
import { Navbar } from './components/Navbar';
import { OrderTracker } from './components/OrderTracker';
import { RouteComparison } from './components/RouteComparison';
import { DepositFlow } from './components/DepositFlow';
import { SwapCard } from './components/SwapCard';
import { useQuote } from './hooks/useQuote';
import { useWalletAccount } from './hooks/useWalletAccount';
import { api, type AssetSummary, type HealthResponse } from './lib/api';

type Side = 'send' | 'receive';

export default function App() {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const [fromId, setFromId] = useState('BTC.BITCOIN');
  const [toId, setToId] = useState('USDT.ETHEREUM');
  const [sendInput, setSendInput] = useState('0.05');
  const [receiveInput, setReceiveInput] = useState('');
  const [side, setSide] = useState<Side>('send');
  const [destination, setDestination] = useState('');
  const [selectedAggregator, setSelectedAggregator] = useState<string | null>(null);

  const [pickerSide, setPickerSide] = useState<Side | null>(null);
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [deposit, setDeposit] = useState<DepositRecord | null>(null);
  const [mode, setMode] = useState<'connect' | 'deposit'>('deposit');
  const [submitting, setSubmitting] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [launch, setLaunch] = useState(0);

  // Read-only: improves quote accuracy when a wallet is already authorised,
  // never prompts. See useWalletAccount.
  const account = useWalletAccount();

  useEffect(() => {
    Promise.all([api.assets(), api.health()])
      .then(([assetRes, healthRes]) => {
        setAssets(assetRes.assets);
        setHealth(healthRes);
      })
      .catch((error) =>
        setBootError(error instanceof Error ? error.message : 'Could not reach the quote API'),
      );
  }, []);

  const fromAsset = useMemo(() => assets.find((a) => a.id === fromId), [assets, fromId]);
  const toAsset = useMemo(() => assets.find((a) => a.id === toId), [assets, toId]);

  const feeBps = health?.fee.floatBps ?? 50;

  const quoteRequest: QuoteRequest | null = useMemo(() => {
    if (!fromAsset || !toAsset) return null;

    const asset = side === 'send' ? fromAsset : toAsset;
    const raw = side === 'send' ? sendInput : receiveInput;
    const value = parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) return null;

    let amount: string;
    try {
      amount = parseUnits(raw, asset.decimals).toString();
    } catch {
      return null;
    }
    if (amount === '0') return null;

    return {
      fromAssetId: fromId,
      toAssetId: toId,
      amount,
      side,
      rateType: 'float' as const,
      destinationAddress: destination.trim() || undefined,
      takerAddress: account ?? undefined,
    };
  }, [fromAsset, toAsset, side, sendInput, receiveInput, fromId, toId, destination, account]);

  const { quote, loading, refreshing, error, refresh } = useQuote(quoteRequest);

  // Mirror the derived side back into its box, never the one being typed in.
  const lastApplied = useRef<string>('');
  useEffect(() => {
    if (!quote || !fromAsset || !toAsset) return;
    const stamp = `${quote.requestId}:${side}`;
    if (lastApplied.current === stamp) return;
    lastApplied.current = stamp;

    if (side === 'send') {
      setReceiveInput(trimZeros(formatUnits(BigInt(quote.receiveAmount), toAsset.decimals)));
    } else {
      setSendInput(trimZeros(formatUnits(BigInt(quote.sendAmount), fromAsset.decimals)));
    }
  }, [quote, side, fromAsset, toAsset]);

  useEffect(() => {
    if (!quote) return;
    const stillRoutable = quote.quotes.some(
      (q) => q.aggregator === selectedAggregator && !q.unavailableReason,
    );
    if (!stillRoutable) setSelectedAggregator(quote.best?.aggregator ?? null);
  }, [quote, selectedAggregator]);

  const activeQuote = useMemo(() => {
    if (!quote) return null;
    return (
      quote.quotes.find((q) => q.aggregator === selectedAggregator && !q.unavailableReason) ??
      quote.best ??
      null
    );
  }, [quote, selectedAggregator]);

  const handleSendInput = useCallback((value: string) => {
    setSide('send');
    setSendInput(value);
  }, []);

  const handleReceiveInput = useCallback((value: string) => {
    setSide('receive');
    setReceiveInput(value);
  }, []);

  const flip = useCallback(() => {
    setFromId(toId);
    setToId(fromId);
    setSendInput(receiveInput);
    setReceiveInput(sendInput);
    setDestination('');
    setSide('send');
  }, [fromId, toId, sendInput, receiveInput]);

  const pickAsset = useCallback(
    (asset: AssetSummary) => {
      if (pickerSide === 'send') {
        setFromId(asset.id);
      } else {
        setToId(asset.id);
        setDestination('');
      }
      setPickerSide(null);
    },
    [pickerSide],
  );

  const submit = useCallback(async () => {
    if (!quote || !activeQuote || !fromAsset || !toAsset) return;
    setSubmitting(true);
    setPlanError(null);
    try {
      const isEvmSameChain = fromAsset.chainKind === 'evm' && toAsset.chainKind === 'evm' && fromAsset.chain === toAsset.chain;
      if (mode === 'deposit' && isEvmSameChain) {
        const res = await api.deposit({
          fromAssetId: fromId,
          toAssetId: toId,
          amount: quote.sendAmount,
          destinationAddress: destination.trim(),
          aggregator: activeQuote.aggregator,
        });
        setDeposit(res.deposit);
        setLaunch((n) => n + 1);
      } else {
        const res = await api.plan({
          fromAssetId: fromId,
          toAssetId: toId,
          sendAmount: quote.sendAmount,
          destinationAddress: destination.trim(),
          takerAddress: account ?? undefined,
          rateType: 'float' as const,
          aggregator: activeQuote.aggregator,
        });
        setOrder(res.order);
        setLaunch((n) => n + 1);
      }
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Could not build the execution plan');
    } finally {
      setSubmitting(false);
    }
  }, [quote, activeQuote, fromAsset, toAsset, fromId, toId, destination, account, mode]);

  if (bootError) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="max-w-md rounded-2xl border border-brand-red/30 bg-brand-red/5 p-6 text-center">
          <TriangleAlert className="mx-auto mb-3 h-7 w-7 text-brand-red" />
          <h1 className="mb-1 text-sm font-bold text-white">Quote API unreachable</h1>
          <p className="text-xs leading-relaxed text-white/60">{bootError}</p>
          <p className="mt-3 font-mono text-[11px] text-white/40">npm run dev</p>
        </div>
      </div>
    );
  }

  if (!fromAsset || !toAsset) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand-cyan" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar assets={assets} />

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        {/* Mode toggle — connect vs deposit (ff.io-style) */}
        <div className="mb-3 flex items-center justify-center gap-1 rounded-full border border-white/[0.06] bg-ink-850 p-1 text-[12px] font-semibold">
          <button
            onClick={() => setMode('deposit')}
            className={`flex-1 rounded-full px-4 py-2 transition ${mode==='deposit' ? 'bg-white text-black shadow' : 'text-white/50 hover:text-white'}`}
          >
            No wallet — copy address
          </button>
          <button
            onClick={() => setMode('connect')}
            className={`flex-1 rounded-full px-4 py-2 transition ${mode==='connect' ? 'bg-white text-black shadow' : 'text-white/50 hover:text-white'}`}
          >
            Connect & swap
          </button>
        </div>
        <div className="mb-2 px-1 text-center font-mono text-[10px] leading-relaxed text-white/30">
          {mode==='deposit' ? 'Deposit proxy (CREATE2) — non-custodial, fee 0.5% in calldata, gas from fee. No private key custody.' : 'Atomic swap via your wallet — fee 0.5% in one transaction, reverts if anything fails.'}
        </div>
        <SwapCard
          fromAsset={fromAsset}
          toAsset={toAsset}
          quote={quote}
          loading={loading}
          refreshing={refreshing}
          error={error ?? planError}
          sendInput={sendInput}
          receiveInput={receiveInput}
          side={side}
          destination={destination}
          feeBps={feeBps}
          onSendInput={handleSendInput}
          onReceiveInput={handleReceiveInput}
          onDestination={setDestination}
          onOpenFrom={() => setPickerSide('send')}
          onOpenTo={() => setPickerSide('receive')}
          onFlip={flip}
          onRefresh={refresh}
          onSubmit={submit}
          submitting={submitting}
          mode={mode}
        />

        {quote && quote.quotes.length > 0 && (
          <div className="mt-4">
            <RouteComparison
              quotes={quote.quotes}
              toAsset={toAsset}
              selected={activeQuote?.aggregator ?? null}
              onSelect={setSelectedAggregator}
              loading={loading || refreshing}
            />
          </div>
        )}

        {order && (
          <div className="mt-4">
            <ExecutionInspector plan={order.plan} fromAsset={fromAsset} toAsset={toAsset} />
          </div>
        )}
      </main>

      {/* Plays as the page opens, and again on every order built. */}
      <RocketLaunch trigger={launch} playOnMount />

      <AssetPicker
        open={pickerSide !== null}
        title={pickerSide === 'send' ? 'Select asset to send' : 'Select asset to receive'}
        assets={assets}
        selectedId={pickerSide === 'send' ? fromId : toId}
        excludeId={pickerSide === 'send' ? toId : fromId}
        onSelect={pickAsset}
        onClose={() => setPickerSide(null)}
      />


      {order && (
        <OrderTracker
          order={order}
          fromAsset={fromAsset}
          toAsset={toAsset}
          onClose={() => setOrder(null)}
        />
      )}
      {deposit && fromAsset && toAsset && (
        <DepositFlow deposit={deposit} fromAsset={fromAsset} toAsset={toAsset} onClose={() => setDeposit(null)} />
      )}
    </div>
  );
}

/** `formatUnits` keeps full precision; trim the noise for an input box. */
function trimZeros(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/0+$/, '').replace(/\.$/, '');
}
