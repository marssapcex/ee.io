import {
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Lock,
  ShieldCheck,
  Terminal,
  Unlock,
} from 'lucide-react';
import React, { useState } from 'react';
import { formatDisplay } from '../../shared/money';
import type { ExecutionPlan } from '../../shared/types';
import type { AssetSummary } from '../lib/api';
import {
  connect,
  currentAccounts,
  encodeApprove,
  sendTransaction,
  switchChain,
} from '../lib/wallet';

interface Props {
  plan: ExecutionPlan;
  fromAsset: AssetSummary;
  toAsset: AssetSummary;
}

type TxState =
  | { kind: 'idle' }
  | { kind: 'pending'; label: string }
  | { kind: 'sent'; hash: string }
  | { kind: 'error'; message: string };

export const ExecutionInspector: React.FC<Props> = ({ plan, fromAsset, toAsset }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const [txState, setTxState] = useState<TxState>({ kind: 'idle' });
  const [showRaw, setShowRaw] = useState(false);

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  const runApproval = async () => {
    if (plan.transaction.kind !== 'evm' || !plan.transaction.approval) return;
    const approval = plan.transaction.approval;
    if (approval.mechanism === 'none') return;

    setTxState({ kind: 'pending', label: 'Awaiting approval signature…' });
    try {
      const accounts = (await currentAccounts()).length ? await currentAccounts() : await connect();
      await switchChain(plan.transaction.chainId, fromAsset.chainName);
      const hash = await sendTransaction({
        from: accounts[0],
        to: approval.token,
        data: encodeApprove(approval.spender, BigInt(approval.amount)),
        value: '0',
      });
      setTxState({ kind: 'sent', hash });
    } catch (error) {
      setTxState({ kind: 'error', message: readableError(error) });
    }
  };

  const runSwap = async () => {
    if (plan.transaction.kind !== 'evm') return;
    const tx = plan.transaction;

    setTxState({ kind: 'pending', label: 'Awaiting swap signature…' });
    try {
      const existing = await currentAccounts();
      const accounts = existing.length ? existing : await connect();
      await switchChain(tx.chainId, fromAsset.chainName);
      const hash = await sendTransaction({
        from: accounts[0],
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gas: tx.gas,
      });
      setTxState({ kind: 'sent', hash });
    } catch (error) {
      setTxState({ kind: 'error', message: readableError(error) });
    }
  };

  return (
    <section className="w-full max-w-2xl rounded-3xl border border-line bg-ink-750/90 p-5 backdrop-blur-md">
      <header className="mb-4 flex items-center justify-between border-b border-line-soft pb-3">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-brand-cyan" />
          <h2 className="text-sm font-bold text-white">Execution inspector</h2>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-brand-green/40 bg-brand-green/10 px-2.5 py-0.5 font-mono text-[10px] text-brand-green">
          <ShieldCheck className="h-3 w-3" />
          {plan.source === 'live' ? 'live route' : 'simulated route'}
        </span>
      </header>

      {/* Custody model — the central claim, stated plainly. */}
      <div className="mb-4 rounded-2xl border border-brand-green/40 bg-brand-green/10 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          <Lock className="h-3 w-3" />
          Custody model
        </div>
        <p className="text-xs leading-relaxed text-white/70">{plan.custodyModel}</p>
      </div>

      {/* Fee split */}
      <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Panel label="You receive">
          <span className="font-mono text-sm font-bold text-brand-cyan">
            {formatDisplay(BigInt(plan.receiveAmount), toAsset.decimals, 8)} {toAsset.symbol}
          </span>
          <span className="block font-mono text-[10px] text-white/35">
            min {formatDisplay(BigInt(plan.minReceiveAmount), toAsset.decimals, 8)} after slippage
          </span>
          <span className="mt-1 block truncate font-mono text-[10px] text-white/45">
            → {plan.destinationAddress}
          </span>
        </Panel>

        <Panel label={`Affiliate fee · ${plan.fee.bps} bps`}>
          <span className="font-mono text-sm font-bold text-brand-orange">
            {formatDisplay(
              BigInt(plan.fee.amount),
              plan.fee.assetId === toAsset.id ? toAsset.decimals : fromAsset.decimals,
              8,
            )}{' '}
            {plan.fee.assetId === toAsset.id ? toAsset.symbol : fromAsset.symbol}
          </span>
          <span className="block font-mono text-[10px] text-white/35">
            charged on {plan.fee.chargedOn}
          </span>
          <span className="mt-1 block truncate font-mono text-[10px] text-white/45">
            → {plan.fee.recipient || '(unset)'}
          </span>
        </Panel>
      </div>

      {/* Steps */}
      <div className="mb-4 space-y-2">
        <h3 className="text-xs font-semibold text-white/70">Settlement trace</h3>
        {plan.steps.map((step) => (
          <div key={step.index} className="rounded-2xl border border-line bg-ink-800/70 p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-bold text-white/80">
                {step.index}. {step.title}
              </span>
              <span
                className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-px font-mono text-[9px] ${
                  step.atomic
                    ? 'border-brand-green/40 bg-brand-green/10 text-brand-green'
                    : 'border-white/10 bg-white/5 text-white/45'
                }`}
              >
                {step.atomic ? <Lock className="h-2.5 w-2.5" /> : <Unlock className="h-2.5 w-2.5" />}
                {step.atomic ? 'atomic' : 'sequential'}
              </span>
            </div>
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-white/45">{step.detail}</p>
            <p className="mt-1.5 text-[10px] leading-relaxed text-white/35">
              <span className="text-white/45">Guarantee:</span> {step.guarantee}
            </p>
          </div>
        ))}
      </div>

      {/* Transaction payload */}
      {plan.transaction.kind === 'evm' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Panel label="Router contract">
              <code className="block break-all font-mono text-[10px] text-white/70">
                {plan.transaction.to}
              </code>
            </Panel>
            <Panel label="Value / chain">
              <code className="font-mono text-[10px] text-white/70">
                {plan.transaction.value} wei · chain {plan.transaction.chainId}
              </code>
            </Panel>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="text-[11px] font-semibold text-white/45 hover:text-brand-cyan"
              >
                {showRaw ? 'Hide' : 'Show'} raw calldata ({(plan.transaction.data.length - 2) / 2} bytes)
              </button>
              <button
                onClick={() => copy('calldata', (plan.transaction as { data: string }).data)}
                className="flex items-center gap-1 font-mono text-[11px] text-brand-cyan hover:text-brand-cyan"
              >
                {copied === 'calldata' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied === 'calldata' ? 'copied' : 'copy'}
              </button>
            </div>
            {showRaw && (
              <pre className="scrollbar-thin max-h-32 select-all overflow-auto rounded-xl border border-line-soft bg-ink-950 p-3 font-mono text-[10px] leading-relaxed text-white/45">
                {plan.transaction.data}
              </pre>
            )}
          </div>

          {plan.source !== 'live' && (
            <p className="rounded-xl border border-brand-amber/30 bg-brand-amber/10 px-3 py-2 text-[11px] leading-relaxed text-brand-amber/80">
              This calldata is an ABI-encoded <em>preview</em> showing where the fee recipient and
              amount sit in the call. Configure an aggregator API key to fetch executable calldata
              signed off by the router itself — never broadcast preview calldata.
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            {plan.transaction.approval && plan.transaction.approval.mechanism !== 'none' && (
              <button
                onClick={runApproval}
                disabled={txState.kind === 'pending'}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-line-strong bg-ink-600 px-4 py-2.5 text-xs font-bold text-white/80 transition-colors hover:bg-ink-550 disabled:opacity-50"
              >
                1. Approve {fromAsset.symbol}
              </button>
            )}
            <button
              onClick={runSwap}
              disabled={txState.kind === 'pending' || plan.source !== 'live'}
              title={plan.source !== 'live' ? 'Live calldata required before broadcasting' : undefined}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-brand-cyan/40 bg-brand-cyan/10 px-4 py-2.5 text-xs font-bold text-brand-cyan transition-colors hover:bg-brand-cyan/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {txState.kind === 'pending' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUpRight className="h-3.5 w-3.5" />
              )}
              {plan.transaction.approval?.mechanism !== 'none' ? '2. ' : ''}Sign &amp; broadcast
            </button>
          </div>
        </div>
      ) : (
        <DepositPanel plan={plan} fromAsset={fromAsset} onCopy={copy} copied={copied} />
      )}

      {txState.kind === 'sent' && (
        <p className="mt-3 break-all rounded-xl border border-brand-green/40 bg-brand-green/10 px-3 py-2 font-mono text-[11px] text-brand-green">
          Broadcast: {txState.hash}
        </p>
      )}
      {txState.kind === 'error' && (
        <p className="mt-3 rounded-xl border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-[11px] text-brand-red">
          {txState.message}
        </p>
      )}
      {txState.kind === 'pending' && (
        <p className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-ink-800 px-3 py-2 text-[11px] text-white/70">
          <Loader2 className="h-3 w-3 animate-spin" />
          {txState.label}
        </p>
      )}

      {plan.references.length > 0 && (
        <footer className="mt-4 border-t border-line-soft pt-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-white/35">
            Protocol documentation
          </p>
          <ul className="space-y-1">
            {plan.references.map((ref) => (
              <li key={ref.url}>
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-1.5 text-[11px] text-white/45 transition-colors hover:text-brand-cyan"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate">{ref.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </footer>
      )}
    </section>
  );
};

const DepositPanel: React.FC<{
  plan: ExecutionPlan;
  fromAsset: AssetSummary;
  onCopy: (label: string, value: string) => void;
  copied: string | null;
}> = ({ plan, fromAsset, onCopy, copied }) => {
  if (plan.transaction.kind !== 'deposit') return null;
  const tx = plan.transaction;

  return (
    <div className="space-y-3">
      <Panel label={`Send exactly · ${fromAsset.chainName}`}>
        <span className="font-mono text-sm font-bold text-white">
          {formatDisplay(BigInt(tx.amount), fromAsset.decimals, 8)} {fromAsset.symbol}
        </span>
      </Panel>

      <div className="rounded-2xl border border-line bg-ink-800 p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-white/35">
            Inbound vault address
          </span>
          <button
            onClick={() => onCopy('address', tx.depositAddress)}
            className="flex items-center gap-1 font-mono text-[11px] text-brand-cyan hover:text-brand-cyan"
          >
            {copied === 'address' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied === 'address' ? 'copied' : 'copy'}
          </button>
        </div>
        <code className="block break-all font-mono text-xs text-white">{tx.depositAddress}</code>
      </div>

      {tx.memo && (
        <div className="rounded-2xl border border-brand-amber/30 bg-brand-amber/10 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-amber">
              Required memo — {tx.memoEncoding}
            </span>
            <button
              onClick={() => onCopy('memo', tx.memo!)}
              className="flex items-center gap-1 font-mono text-[11px] text-brand-amber hover:text-brand-amber"
            >
              {copied === 'memo' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied === 'memo' ? 'copied' : 'copy'}
            </button>
          </div>
          <code className="block break-all font-mono text-xs text-brand-amber">{tx.memo}</code>
          <p className="mt-2 text-[10px] leading-relaxed text-brand-amber/80">
            Without this memo THORChain cannot tell where to send the output, and the deposit will
            be refunded minus fees. The memo encodes your destination, the minimum acceptable
            output, and the affiliate fee.
          </p>
        </div>
      )}

      <p className="rounded-xl border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-[11px] leading-relaxed text-brand-red/90">
        Vault addresses rotate. Always re-fetch the inbound address immediately before sending —
        never reuse a cached one, and never send after the quote expires.
      </p>
    </div>
  );
};

const Panel: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="rounded-2xl border border-line bg-ink-800 p-3">
    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/35">
      {label}
    </div>
    {children}
  </div>
);

function readableError(error: unknown): string {
  const err = error as { code?: number; message?: string };
  if (err?.code === 4001) return 'Signature rejected in the wallet.';
  if (err?.code === -32002) return 'A wallet request is already pending — check your extension.';
  return err?.message ?? 'Transaction failed.';
}
