import { Check, Clipboard, ExternalLink, Loader2, ShieldCheck, Timer } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { formatDisplay } from '../../shared/money';
import type { DepositRecord } from '../../shared/types';
import type { AssetSummary } from '../lib/api';
import { api } from '../lib/api';

interface Props {
  deposit: DepositRecord;
  fromAsset: AssetSummary;
  toAsset: AssetSummary;
  onClose: () => void;
  onSimulateFunded?: () => void;
}

export const DepositFlow: React.FC<Props> = ({ deposit: initial, fromAsset, toAsset, onClose }) => {
  const [deposit, setDeposit] = useState<DepositRecord>(initial);
  const [qr, setQr] = useState<string>('');
  const [copied, setCopied] = useState<string | null>(null);

  // Generate QR for deposit address (+ amount for EVM? we encode address only)
  useEffect(() => {
    QRCode.toDataURL(deposit.depositAddress, { margin: 1, width: 180, color: { dark: '#ffffff', light: '#09090b' } })
      .then(setQr)
      .catch(() => {});
  }, [deposit.depositAddress]);

  // Poll status every 3s
  useEffect(() => {
    let alive = true;
    const id = setInterval(async () => {
      try {
        const res = await api.depositStatus(deposit.depositId);
        if (alive) setDeposit(res.deposit);
      } catch {}
    }, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [deposit.depositId]);

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const amountHuman = formatDisplay(BigInt(deposit.sendAmount), fromAsset.decimals, 6);
  const receiveHuman = formatDisplay(BigInt(deposit.receiveAmount), toAsset.decimals, 6);
  const isNative = fromAsset.address?.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

  const statusLabel: Record<string, { label: string; color: string; desc: string }> = {
    awaiting_funds: { label: 'Awaiting funds', color: 'text-white/60', desc: 'Send exactly the amount below to the address. Funds are safe in a one-time contract.' },
    funding: { label: 'Funding detected', color: 'text-brand-amber', desc: 'Partial amount seen — waiting for full amount.' },
    funded: { label: 'Funds received', color: 'text-brand-cyan', desc: 'Relayer will execute the swap. Fee 0.5% is inside the calldata.' },
    executing: { label: 'Swapping', color: 'text-brand-cyan', desc: 'Proxy is swapping via the best router. Output will go straight to your destination.' },
    executed: { label: 'Completed', color: 'text-brand-greenBright', desc: `Sent ${receiveHuman} ${toAsset.symbol} to your address.` },
    expired: { label: 'Expired', color: 'text-brand-red', desc: 'Deposit window closed. No funds were lost — refund if needed.' },
    refunded: { label: 'Refunded', color: 'text-brand-red', desc: 'Swap failed or slippage exceeded. Input refunded to depositor.' },
  };
  const st = statusLabel[deposit.status] ?? statusLabel.awaiting_funds;

  const expiresIn = Math.max(0, Math.floor((deposit.expiresAt - Date.now()) / 1000));
  const mins = Math.floor(expiresIn / 60);
  const secs = expiresIn % 60;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[520px] overflow-hidden rounded-[16px] border border-white/[0.08] bg-ink-900 shadow-[0_16px_48px_rgba(0,0,0,0.7)]">
        {/* header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-full bg-brand-green/15 text-brand-greenBright"><ShieldCheck className="h-4 w-4" /></div>
            <div>
              <div className="text-[13px] font-bold text-white">Deposit address — no wallet connect</div>
              <div className="font-mono text-[10px] text-white/40">Non-custodial proxy • CREATE2 • one-time</div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-white/40 hover:bg-white/5 hover:text-white">✕</button>
        </div>

        <div className="space-y-4 p-5">
          {/* status */}
          <div className="flex items-center justify-between rounded-[12px] border border-white/[0.06] bg-ink-850 px-3 py-2.5">
            <span className={`flex items-center gap-2 text-[12px] font-semibold ${st.color}`}>
              {(deposit.status === 'executing' || deposit.status === 'funding' || deposit.status === 'funded') && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {st.label}
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-white/35"><Timer className="h-3 w-3" />{mins}:{String(secs).padStart(2,'0')}</span>
          </div>
          <p className="px-1 text-[11px] leading-relaxed text-white/45">{st.desc}</p>

          {/* QR + address */}
          <div className="grid grid-cols-[auto_1fr] gap-4 rounded-[14px] border border-white/[0.08] bg-ink-850 p-4">
            <div className="overflow-hidden rounded-[10px] border border-white/[0.06] bg-ink-900 p-2">
              {qr ? <img src={qr} alt="deposit QR" className="h-[140px] w-[140px]" /> : <div className="grid h-[140px] w-[140px] place-items-center"><Loader2 className="h-5 w-5 animate-spin text-white/20" /></div>}
            </div>
            <div className="min-w-0 space-y-3">
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">Send exactly</div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[15px] font-bold text-white">{amountHuman} {fromAsset.symbol}</span>
                  <button onClick={() => copy(amountHuman, 'amount')} className="rounded-md p-1.5 text-white/30 hover:bg-white/5 hover:text-white">{copied==='amount' ? <Check className="h-3.5 w-3.5 text-brand-greenBright" /> : <Clipboard className="h-3.5 w-3.5" />}</button>
                </div>
                <div className="font-mono text-[11px] text-white/30">on {fromAsset.chainName} • fee 0.5% inside swap</div>
              </div>
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">To deposit address</div>
                <div className="flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-ink-900 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-white">{deposit.depositAddress}</span>
                  <button onClick={() => copy(deposit.depositAddress, 'addr')} className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white/[0.06] text-white/60 hover:bg-white/10 hover:text-white">
                    {copied==='addr' ? <Check className="h-3.5 w-3.5 text-brand-greenBright" /> : <Clipboard className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-white/25">
                  <span>Factory {deposit.factoryAddress.slice(0,6)}…{deposit.factoryAddress.slice(-4)}</span>
                  <span>•</span>
                  <span>Proxy logic {deposit.logicAddress.slice(0,6)}…</span>
                </div>
              </div>
            </div>
          </div>

          {/* details */}
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="rounded-[10px] border border-white/[0.06] bg-ink-850 px-3 py-2.5">
              <div className="font-mono text-[10px] uppercase tracking-wide text-white/30">You will receive</div>
              <div className="mt-1 font-mono text-[13px] font-bold text-brand-cyan">~{receiveHuman} {toAsset.symbol}</div>
              <div className="font-mono text-[10px] text-white/25">min {formatDisplay(BigInt(deposit.minReceiveAmount), toAsset.decimals, 6)} (slippage)</div>
            </div>
            <div className="rounded-[10px] border border-white/[0.06] bg-ink-850 px-3 py-2.5">
              <div className="font-mono text-[10px] uppercase tracking-wide text-white/30">Destination</div>
              <div className="mt-1 truncate font-mono text-[11px] font-medium text-white" title={deposit.destinationAddress}>{deposit.destinationAddress.slice(0,10)}…{deposit.destinationAddress.slice(-8)}</div>
              <div className="font-mono text-[10px] text-white/25">via {deposit.aggregator} • {isNative ? 'native' : 'ERC20'}</div>
            </div>
          </div>

          {deposit.warnings.length > 0 && (
            <div className="rounded-[10px] border border-brand-amber/20 bg-brand-amber/[0.07] px-3 py-2.5 text-[11px] leading-relaxed text-brand-amber">
              {deposit.warnings.join(' • ')}
            </div>
          )}

          {/* custody proof */}
          <div className="rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
            <div className="flex items-center gap-2 text-[11px] font-bold text-white/80"><ShieldCheck className="h-3.5 w-3.5 text-brand-greenBright" />Non-custodial proof</div>
            <ul className="mt-2 list-disc space-y-1 pl-4 font-mono text-[10px] leading-relaxed text-white/40">
              <li>Address is CREATE2: <span className="text-white/60">keccak256(0xff ++ factory ++ salt ++ codeHash)</span> — exists before funding, no private key.</li>
              <li>Proxy forwards <b className="text-white/70">only</b> to your destination. Factory cannot drain elsewhere.</li>
              <li>Fee 0.5% is in router calldata (<span className="text-white/60">feeRecipient=ee.io</span>). Fail → refund to depositor.</li>
              <li>Verify factory & logic on Etherscan; watcher is open source.</li>
            </ul>
          </div>

          {/* actions */}
          <div className="flex gap-2">
            <button
              onClick={async () => { try { await api.depositFunded(deposit.depositId); const r=await api.depositStatus(deposit.depositId); setDeposit(r.deposit);} catch {} }}
              className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.04] py-2.5 text-[12px] font-semibold text-white/70 hover:bg-white/[0.08] hover:text-white"
            >
              Simulate funded (demo)
            </button>
            <a
              href={`https://etherscan.io/address/${deposit.depositAddress}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-xl bg-ink-800 px-4 py-2.5 text-[12px] font-semibold text-white/60 hover:bg-ink-700 hover:text-white"
            >
              View <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
