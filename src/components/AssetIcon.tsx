import React from 'react';
import type { AssetSummary } from '../lib/api';
import { CHAIN_ART, COIN_ART, type CoinArt } from './coinLogos';

interface Props {
  asset: AssetSummary;
  size?: number;
  /** Show the chain badge in the corner for multi-chain tokens. */
  showChain?: boolean;
}

/**
 * Coin icon drawn from the real brand mark (see `coinLogos.tsx`) — the ₿, the
 * Ethereum octahedron, the Solana bars — not the ticker text in a coloured
 * disc, which is what shipped before and looked nothing like the coins.
 *
 * Marks are inline vectors, so there is no sprite round-trip, no broken image
 * offline, and they stay sharp at any size. Assets without a hand-traced mark
 * fall back to the registry gradient plus the ticker.
 */

const Mark: React.FC<{ art: CoinArt; size: number; title?: string }> = ({ art, size, title }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" role="img">
    {title ? <title>{title}</title> : null}
    <circle cx="16" cy="16" r="16" fill={art.bg} />
    <g fill={art.fg}>{art.paths}</g>
  </svg>
);

export const AssetIcon: React.FC<Props> = ({ asset, size = 32, showChain = false }) => {
  const art = COIN_ART[asset.symbol];
  const chainArt = CHAIN_ART[asset.chain];
  // A token badge only adds information when the mark and the chain differ —
  // ETH on Ethereum does not need an Ethereum badge.
  const badge = showChain && chainArt && chainArt !== art ? chainArt : null;
  const badgeSize = Math.max(12, Math.round(size * 0.42));

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      {art ? (
        <Mark art={art} size={size} title={`${asset.symbol} logo`} />
      ) : (
        <FallbackMark asset={asset} size={size} />
      )}

      {badge && (
        <span
          className="absolute -bottom-0.5 -right-0.5 inline-flex items-center justify-center rounded-full ring-2 ring-ink-950"
          style={{ width: badgeSize, height: badgeSize }}
          title={asset.chainName}
        >
          <Mark art={badge} size={badgeSize} title={asset.chainName} />
        </span>
      )}
    </span>
  );
};

/** Long-tail assets with no hand-traced mark: registry gradient + ticker. */
const FallbackMark: React.FC<{ asset: AssetSummary; size: number }> = ({ asset, size }) => {
  const gradientId = `grad-${asset.id.replace(/[^a-zA-Z0-9]/g, '')}`;
  // Truncating at 3 turned both USDT and USDC into "USD" — two different
  // assets rendering an identical, wrong ticker on a coin the user is about to
  // send money to.
  const initials = asset.symbol.slice(0, 4);
  const fontSize = initials.length >= 4 ? 8.6 : initials.length === 3 ? 10.8 : 13.4;

  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={asset.color} />
          <stop offset="100%" stopColor={asset.colorTo} />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill={`url(#${gradientId})`} />
      <text
        x="16"
        y="16"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={fontSize}
        fontWeight="700"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        style={{ letterSpacing: '-0.03em' }}
      >
        {initials}
      </text>
    </svg>
  );
};
