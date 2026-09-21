import React from 'react';
import type { AssetSummary } from '../lib/api';

interface Props {
  asset: AssetSummary;
  size?: number;
  /** Show the chain badge in the corner for multi-chain tokens. */
  showChain?: boolean;
}

/**
 * Coin icon rendered from the asset's brand colours rather than a remote
 * sprite sheet — no extra network round-trip, no broken images, and it works
 * for every asset in the registry including long-tail ones.
 */
export const AssetIcon: React.FC<Props> = ({ asset, size = 32, showChain = false }) => {
  const gradientId = `grad-${asset.id.replace(/[^a-zA-Z0-9]/g, '')}`;
  const initials = asset.symbol.slice(0, asset.symbol.length > 3 ? 3 : asset.symbol.length);
  const fontSize = initials.length >= 4 ? size * 0.3 : initials.length === 3 ? size * 0.34 : size * 0.42;

  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={asset.color} />
            <stop offset="100%" stopColor={asset.colorTo} />
          </linearGradient>
        </defs>
        <circle cx="20" cy="20" r="20" fill={`url(#${gradientId})`} />
        <circle cx="20" cy="20" r="19" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
        <text
          x="20"
          y="20"
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fff"
          fontSize={(fontSize / size) * 40}
          fontWeight="700"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          style={{ letterSpacing: '-0.03em', paintOrder: 'stroke' }}
        >
          {initials}
        </text>
      </svg>

      {showChain && (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full border border-ink-800 bg-ink-750 px-1 text-[7px] font-bold uppercase leading-[11px] text-slate-300"
          title={asset.chainName}
        >
          {asset.chain.slice(0, 3)}
        </span>
      )}
    </span>
  );
};
