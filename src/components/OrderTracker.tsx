import { Check, Copy, ExternalLink, Loader2, PlayCircle, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { formatDisplay } from '../../shared/money';
import type { OrderRecord } from '../../shared/types';
import { api, type AssetSummary } from '../lib/api';

interface Props {
  order: OrderRecord;
  fromAsset: AssetSummary;
  toAsset: AssetSummary;
  onClose: () => void;
}

const STAGES: { id: OrderRecord['status']; label: string }[] = [
  { id: 'awaiting_deposit', label: 'Awaiting deposit' },
  { id: 'confirming', label: 'Confirming' },
  { id: 'swapping', label: 'Swapping' },
  { id: 'settling', label: 'Settling' },
  { id: 'completed', label: 'Complete' },
];

function stageIndex(status: OrderRecord['status']): number {
  switch (status) {
    case 'awaiting_deposit':
      return 0;
    case 'detecting':
    case 'confirming':
      return 1;
    case 'swapping':
      return 2;
    case 'settling':
      return 3;
    case 'completed':
      return 4;
    default:
      return 0;
  }
}

export const OrderTracker: React.FC<Props> = ({ order: initial, fromAsset, toAsset, onClose }) => {
  const [order, setOrder] = useState(initial);
  const [copied, setCopied] = useState(false);
  const [simulating, setSimulating] = useState(false);

  // Poll while the order is in flight. Stops as soon as it settles so we do
  // not hammer the API for a finished order.
  useEffect(() => {
    if (order.status === 'completed' || order.status === 'expired') return;

    const timer = setInterval(() => {
      api
        .order(order.orderId)
        .then((res) => setOrder(res.order))
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [order.orderId, order.status]);

  const active = stageIndex(order.status);
  const isDeposit = order.plan.transaction.kind === 'deposit';

  const copyAddress = async () => {
    if (order.plan.transaction.kind !== 'deposit') return;
    await navigator.clipboard.writeText(order.plan.transaction.depositAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const simulateDeposit = async () => {
    setSimulating(true);
    try {
      const res = await api.simulateDeposit(order.orderId);
      setOrder(res.order);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-4 pt-[6vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg animate-slide-up rounded-3xl border border-line bg-ink-700 p-5 shadow-2xl">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Order {order.orderId}</h2>
            <p className="font-mono text-[11px] text-white/35">
              via {order.plan.displayName} · {order.plan.fee.bps} bps
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/45 hover:bg-ink-500 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="mb-4 flex items-center justify-between rounded-2xl border border-line bg-ink-800 p-3">
          <div>
            <p className="font-mono text-sm font-bold text-white">
              {formatDisplay(BigInt(order.plan.sendAmount), fromAsset.decimals, 8)}{' '}
              {fromAsset.symbol}
            </p>
            <p className="text-[10px] text-white/35">{fromAsset.chainName}</p>
          </div>
          <span className="text-white/25">→</span>
          <div className="text-right">
            <p className="font-mono text-sm font-bold text-brand-cyan">
              {formatDisplay(BigInt(order.plan.receiveAmount), toAsset.decimals, 8)}{' '}
              {toAsset.symbol}
            </p>
            <p className="text-[10px] text-white/35">{toAsset.chainName}</p>
          </div>
        </div>

        {/* Progress */}
        <ol className="mb-4 space-y-2">
          {STAGES.map((stage, index) => {
            const done = index < active;
            const current = index === active;
            return (
              <li key={stage.id} className="flex items-center gap-3">
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${
                    done
                      ? 'border-brand-green/40 bg-brand-green/10 text-brand-green'
                      : current
                        ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan'
                        : 'border-line bg-ink-800 text-white/25'
                  }`}
                >
                  {done ? <Check className="h-3 w-3" /> : current ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={`text-xs ${current ? 'font-bold text-white' : done ? 'text-white/45' : 'text-white/25'}`}
                >
                  {stage.label}
                  {current && stage.id === 'confirming' && (
                    <span className="ml-1.5 font-mono text-[10px] text-white/35">
                      {order.confirmations}/{order.requiredConfirmations}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        {isDeposit && order.status === 'awaiting_deposit' && (
          <div className="mb-3 rounded-2xl border border-line bg-ink-800 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-white/35">
                Send {fromAsset.symbol} to
              </span>
              <button
                onClick={copyAddress}
                className="flex items-center gap-1 font-mono text-[11px] text-brand-cyan"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? 'copied' : 'copy'}
              </button>
            </div>
            <code className="block break-all font-mono text-xs text-white">
              {(order.plan.transaction as { depositAddress: string }).depositAddress}
            </code>
          </div>
        )}

        {order.inboundTxHash && (
          <TxRow label="Inbound" hash={order.inboundTxHash} />
        )}
        {order.outboundTxHash && <TxRow label="Outbound" hash={order.outboundTxHash} />}

        {order.status === 'awaiting_deposit' && (
          <button
            onClick={simulateDeposit}
            disabled={simulating}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-line-strong bg-ink-600 px-4 py-2.5 text-xs font-bold text-white/70 transition-colors hover:bg-ink-550 disabled:opacity-50"
          >
            {simulating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            Simulate deposit detected
          </button>
        )}

        <p className="mt-3 text-center text-[10px] leading-relaxed text-white/25">
          ee.io holds no funds and stores no account. This tracker is a read-only view of a public
          on-chain process — closing it does not affect your swap.
        </p>
      </div>
    </div>
  );
};

const TxRow: React.FC<{ label: string; hash: string }> = ({ label, hash }) => (
  <div className="mt-2 flex items-center justify-between rounded-xl border border-line-soft bg-ink-800/60 px-3 py-2">
    <span className="text-[10px] font-semibold uppercase tracking-wide text-white/35">
      {label}
    </span>
    <span className="flex items-center gap-1.5 font-mono text-[10px] text-white/45">
      {hash.slice(0, 10)}…{hash.slice(-8)}
      <ExternalLink className="h-3 w-3" />
    </span>
  </div>
);
