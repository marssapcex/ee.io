import React from 'react';

/**
 * Real brand marks, hand-traced as inline SVG paths on a 32x32 grid.
 *
 * Why not a sprite CDN: the previous placeholder drew the ticker text inside a
 * gradient disc, which looked nothing like the actual coins. Remote sprites
 * (cryptocurrency-icons, CoinGecko images) would fix that but add a network
 * round-trip per row, flash broken images offline, and silently 404 for
 * long-tail assets. These are vector, cached with the bundle, and never fail.
 *
 * Each entry is the brand's own geometry, not a letter in a circle.
 */

export interface CoinArt {
  /** Disc background. */
  bg: string;
  /** Foreground mark. */
  fg: string;
  /** Paths drawn in `fg` on top of the disc. */
  paths: React.ReactNode;
}

const p = (d: string) => <path d={d} />;

/* Bitcoin — the ₿ with two ascenders/descenders. */
const BTC: CoinArt = {
  bg: '#F7931A',
  fg: '#fff',
  paths: p(
    'M22.5 14.3c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.7-.4-.7 2.6c-.4-.1-.9-.2-1.4-.3l.7-2.6-1.7-.4-.7 2.7-1.1-.3-2.3-.6-.4 1.8s1.2.3 1.2.3c.7.2.8.6.8 1l-.8 3.1c0 0 .1 0 .2.1l-.2 0-1.1 4.3c-.1.2-.3.5-.8.4 0 0-1.2-.3-1.2-.3l-.8 1.9 2.2.5 1.2.3-.7 2.7 1.7.4.7-2.7c.4.1.9.2 1.4.4l-.7 2.7 1.7.4.7-2.7c2.8.5 4.9.3 5.8-2.2.7-2-.0-3.2-1.5-4 1.1-.2 1.9-1 2.1-2.5zm-3.8 5.3c-.5 2-3.9.9-5 .6l.9-3.6c1.1.3 4.6.8 4.1 3zm.5-5.4c-.5 1.8-3.3.9-4.2.7l.8-3.3c.9.2 3.9.6 3.4 2.6z',
  ),
};

/* Ethereum — the octahedron, upper and lower halves. */
const ETH: CoinArt = {
  bg: '#627EEA',
  fg: '#fff',
  paths: (
    <>
      <path d="M16 4.5v8.4l7.1 3.2L16 4.5z" fillOpacity=".6" />
      <path d="M16 4.5L8.9 16.1 16 12.9V4.5z" />
      <path d="M16 21.5v5.9l7.1-9.9L16 21.5z" fillOpacity=".6" />
      <path d="M16 27.4v-5.9l-7.1-4L16 27.4z" />
      <path d="M16 20.2l7.1-4.1L16 12.9v7.3z" fillOpacity=".2" />
      <path d="M8.9 16.1l7.1 4.1v-7.3l-7.1 3.2z" fillOpacity=".6" />
    </>
  ),
};

/* Tether — the ₮: a T with a horizontal bar through the stem. */
const USDT: CoinArt = {
  bg: '#26A17B',
  fg: '#fff',
  paths: p(
    'M17.9 15.6v0c-.1 0-.7.1-2 .1-1 0-1.8 0-2-.1v0c-3.6-.2-6.2-.8-6.2-1.5s2.7-1.3 6.2-1.5v2.3c.3 0 1.1.1 2 .1 1.3 0 1.9-.1 2-.1v-2.3c3.5.2 6.2.8 6.2 1.5s-2.7 1.3-6.2 1.5zm0-3.2V10.3h4.8V7.1H9.3v3.2h4.8v2.1c-3.9.2-6.8 1-6.8 1.9s2.9 1.7 6.8 1.9v6.7h3.8v-6.7c3.9-.2 6.8-1 6.8-1.9s-2.9-1.7-6.8-1.9z',
  ),
};

/* USD Coin — Circle's dollar-in-ring. */
const USDC: CoinArt = {
  bg: '#2775CA',
  fg: '#fff',
  paths: (
    <>
      <path d="M16 27.3c-6.2 0-11.3-5-11.3-11.3S9.8 4.7 16 4.7 27.3 9.8 27.3 16 22.2 27.3 16 27.3zm0-20.9c-5.3 0-9.6 4.3-9.6 9.6s4.3 9.6 9.6 9.6 9.6-4.3 9.6-9.6S21.3 6.4 16 6.4z" />
      <path d="M17.2 15.3c-1.9-.5-2.5-.8-2.5-1.6 0-.7.6-1.2 1.6-1.2 1.1 0 1.6.4 1.8 1.3 0 .2.2.3.3.3h.9c.2 0 .3-.1.3-.3v-.1c-.2-1.2-1.1-2.1-2.3-2.3v-1.2c0-.2-.1-.3-.4-.4h-.8c-.2 0-.3.1-.3.4v1.2c-1.5.2-2.5 1.2-2.5 2.5 0 1.5 1 2.4 2.9 2.9 1.8.4 2.4.8 2.4 1.7s-.8 1.4-1.8 1.4c-1.4 0-1.9-.6-2.1-1.4 0-.2-.2-.3-.3-.3h-.9c-.2 0-.3.1-.3.3v.1c.2 1.3 1.1 2.3 2.7 2.5v1.2c0 .2.1.3.4.4h.8c.2 0 .3-.1.3-.4v-1.2c1.6-.3 2.6-1.3 2.6-2.7 0-1.6-1-2.5-2.8-3z" />
    </>
  ),
};

/* Solana — three slanted bars. */
const SOL: CoinArt = {
  bg: '#000',
  fg: 'url(#solGrad)',
  paths: (
    <>
      <defs>
        <linearGradient id="solGrad" x1="4" y1="24" x2="28" y2="8" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path d="M10.2 20.6c.2-.2.4-.3.7-.3h15.4c.4 0 .6.5.3.8l-3 3c-.2.2-.4.3-.7.3H7.5c-.4 0-.6-.5-.3-.8l3-3z" />
      <path d="M10.2 8.1c.2-.2.5-.3.7-.3h15.4c.4 0 .6.5.3.8l-3 3c-.2.2-.4.3-.7.3H7.5c-.4 0-.6-.5-.3-.8l3-3z" />
      <path d="M23.3 14.3c-.2-.2-.4-.3-.7-.3H7.2c-.4 0-.6.5-.3.8l3 3c.2.2.4.3.7.3h15.4c.4 0 .6-.5.3-.8l-3-3z" />
    </>
  ),
};

/* XRP — the four-pointed ripple mark. */
const XRP: CoinArt = {
  bg: '#23292F',
  fg: '#fff',
  paths: (
    <>
      <path d="M21.9 8h2.9l-6 6c-1.5 1.5-4 1.5-5.6 0l-6-6h2.9l4.6 4.5c.8.8 2 .8 2.7 0L21.9 8z" />
      <path d="M10 24H7.1l6.1-6c1.5-1.5 4-1.5 5.6 0l6.1 6h-2.9l-4.6-4.6c-.8-.8-2-.8-2.7 0L10 24z" />
    </>
  ),
};

/* Litecoin — the slanted Ł. */
const LTC: CoinArt = {
  bg: '#345D9D',
  fg: '#fff',
  paths: p(
    'M13.1 7.5h4.2l-2.3 8.1 2.6-.8-.6 2.1-2.6.8-1.2 4.2h9.1l-.7 2.6H8.4l1.7-6-2.2.7.6-2.2 2.2-.7 2.4-8.8z',
  ),
};

/* Dogecoin — the Ð. */
const DOGE: CoinArt = {
  bg: '#C2A633',
  fg: '#fff',
  paths: p(
    'M14.9 7.2c3.2 0 5.5.7 7 2.2 1.5 1.5 2.2 3.7 2.2 6.6s-.8 5.1-2.3 6.6c-1.5 1.5-3.8 2.2-6.9 2.2H9.4v-6.4H7.3v-3.7h2.1V7.2h5.5zm-.6 13.7c1.7 0 2.9-.4 3.7-1.3.8-.9 1.2-2.2 1.2-3.9s-.4-3-1.2-3.8c-.8-.9-2-1.3-3.7-1.3h-.9v3.7h3v3.7h-3v2.9h.9z',
  ),
};

/* Bitcoin Cash — the ₿ with a single bar, BCH green. */
const BCH: CoinArt = {
  bg: '#8DC351',
  fg: '#fff',
  paths: p(
    'M19.8 12.3c-.3-1.5-1.6-2.1-3.3-2.3l.5-2.2-1.7-.4-.5 2.1c-.4-.1-.9-.2-1.4-.3l.5-2.1-1.7-.4-.5 2.2-3.2-.8-.5 1.9s1.2.3 1.2.3c.6.2.8.6.7 1l-1.7 7c-.1.2-.3.5-.7.4 0 0-1.2-.3-1.2-.3l-.7 2 3.2.8-.5 2.2 1.7.4.5-2.2c.5.1.9.2 1.4.3l-.5 2.2 1.7.4.5-2.2c2.8.4 5 .2 5.9-2.4.7-2-.1-3.2-1.6-4 1.1-.2 1.9-1 2-2.6zm-3.3 5.5c-.5 2-3.7.9-4.7.6l.7-2.9c1 .3 4.5.8 4 2.3zm.5-5.4c-.5 1.8-3.1.9-4 .6l.6-2.6c.9.2 3.9.6 3.4 2z',
  ),
};

/* Monero — the M with the descending V. */
const XMR: CoinArt = {
  bg: '#FF6600',
  fg: '#fff',
  paths: (
    <>
      <path d="M16 4.5C9.6 4.5 4.5 9.6 4.5 16c0 1.3.2 2.5.6 3.6h3.4V9.9l7.5 7.5 7.5-7.5v9.7h3.4c.4-1.1.6-2.3.6-3.6 0-6.4-5.1-11.5-11.5-11.5z" />
      <path d="M14.3 19.1l-3.3-3.3v5.9H5.9c2 3.5 5.8 5.8 10.1 5.8s8.1-2.3 10.1-5.8h-5.1v-5.9l-3.3 3.3-1.7 1.7-1.7-1.7z" />
    </>
  ),
};

/* TRON — the angular delta. */
const TRX: CoinArt = {
  bg: '#EF0027',
  fg: '#fff',
  paths: p(
    'M22.4 10.3c-1.1-1-2.6-2.5-3.8-3.6l-.1-.1c-.1-.1-.3-.2-.4-.2h0c-.3-.1-8.5-1.6-8.7-1.6-.1 0-.2 0-.3.1l-.1.1c-.1.1-.1.2-.2.3v.2c.8 2.4 4.2 10.2 4.9 12 .1.2.2.6.4.6h0c.2 0 .3-.2.4-.3 0 0 5.9-7.2 7.3-8.9.2-.2.3-.4.3-.6-.1 0-.1 0-.1 0zm-4.4 1.2l3.2-2.6 1.9 1.7-5.1.9zm-1.2-.2l-5.5-4.5 8.9 1.6-3.4 2.9zm-.5 1l-.9 7.2-3.9-9.5 4.8 2.3zm.9.2l5.4-.9-6.2 7.5.8-6.6z',
  ),
};

/* Cosmos — the atom: nucleus plus three orbital ellipses. */
const ATOM: CoinArt = {
  bg: '#2E3148',
  fg: '#fff',
  paths: (
    <>
      <circle cx="16" cy="16" r="2.1" />
      <g fill="none" stroke="#fff" strokeWidth="1.1">
        <ellipse cx="16" cy="16" rx="11" ry="4.2" />
        <ellipse cx="16" cy="16" rx="11" ry="4.2" transform="rotate(60 16 16)" />
        <ellipse cx="16" cy="16" rx="11" ry="4.2" transform="rotate(120 16 16)" />
      </g>
    </>
  ),
};

/* BNB — the rotated-square cluster. */
const BNB: CoinArt = {
  bg: '#F3BA2F',
  fg: '#fff',
  paths: p(
    'M11.6 13.9L16 9.5l4.4 4.4 2.6-2.6L16 4.4l-7 7 2.6 2.5zM4.4 16L7 13.4 9.6 16 7 18.6 4.4 16zm7.2 2.1L16 22.5l4.4-4.4 2.6 2.6-7 7-7-7 2.6-2.6zM22.4 16l2.6-2.6L27.6 16 25 18.6 22.4 16zm-3.8 0L16 13.4 13.4 16 16 18.6 18.6 16z',
  ),
};

/* Polygon / POL — the interlocking hexagon mark. */
const POL: CoinArt = {
  bg: '#8247E5',
  fg: '#fff',
  paths: p(
    'M21.5 12.6c-.4-.2-.9-.2-1.3 0l-3 1.8-2 1.1-2.9 1.8c-.4.2-.9.2-1.3 0l-2.3-1.4c-.4-.2-.7-.7-.7-1.2v-2.7c0-.4.2-.9.7-1.2l2.3-1.3c.4-.2.9-.2 1.3 0l2.3 1.4c.4.2.7.7.7 1.2v1.8l2-1.2v-1.8c0-.4-.2-.9-.7-1.2l-4.2-2.5c-.4-.2-.9-.2-1.3 0L6.8 9.8c-.5.2-.7.7-.7 1.1v4.9c0 .4.2.9.7 1.2l4.3 2.4c.4.2.9.2 1.3 0l2.9-1.7 2-1.2 2.9-1.7c.4-.2.9-.2 1.3 0l2.3 1.3c.4.2.7.7.7 1.2v2.7c0 .4-.2.9-.7 1.2l-2.3 1.4c-.4.2-.9.2-1.3 0l-2.3-1.3c-.4-.2-.7-.7-.7-1.2v-1.8l-2 1.2v1.8c0 .4.2.9.7 1.2l4.3 2.4c.4.2.9.2 1.3 0l4.3-2.4c.4-.2.7-.7.7-1.2v-5c0-.4-.2-.9-.7-1.2l-4.3-2.4z',
  ),
};

/* Avalanche — the A. */
const AVAX: CoinArt = {
  bg: '#E84142',
  fg: '#fff',
  paths: p(
    'M21.6 17.1c.6-1 1.5-1 2.1 0l3.7 6.6c.6 1 .2 1.9-1 1.9h-7.5c-1.2 0-1.6-.9-1-1.9l3.7-6.6zm-7.2-12.6c.6-1 1.5-1 2.1 0l.8 1.5c.5.9.5 1.9 0 2.8l-5.8 10.1c-.6.9-1.5 1.5-2.6 1.5H4.4c-1.2 0-1.6-.9-1-1.9l11-14z',
  ),
};

/* Chainlink — the hexagonal cube. */
const LINK: CoinArt = {
  bg: '#2A5ADA',
  fg: '#fff',
  paths: p('M16 5.6l-2.3 1.4-6.4 3.7L5 12v8l2.3 1.3 6.5 3.7 2.2 1.4 2.3-1.4 6.4-3.7L27 20v-8l-2.3-1.3-6.4-3.7L16 5.6zm-4.7 12.1v-3.4l4.7-2.7 4.7 2.7v3.4L16 20.4l-4.7-2.7z'),
};

/* Uniswap — the unicorn silhouette, simplified to its head profile. */
const UNI: CoinArt = {
  bg: '#FF007A',
  fg: '#fff',
  paths: (
    <>
      <path d="M18.2 3.2l1.7 5.2-3.5.9 1.8-6.1z" />
      <path d="M11.5 8.3l.5 4.3-3.3-1.9 2.8-2.4z" />
      <path d="M17.6 8c4.2 0 7.2 3.1 7.2 7.2 0 2.3-.8 4.3-2.3 5.7l.6 6.4h-3.4l-.5-4.5c-.7.2-1.5.3-2.3.3h-4.3c-3.8 0-6.4-2.4-6.4-6 0-.6.1-1.3.3-1.9l-1.7-.6c-.5-.2-.7-.7-.5-1.2.2-.4.7-.6 1.1-.4l2.2.8C8.9 10.8 11.8 8 17.6 8z" />
      <circle cx="19.6" cy="14.4" r="1.5" fill="#FF007A" />
    </>
  ),
};

/* Aave — the ghost. */
const AAVE: CoinArt = {
  bg: '#B6509E',
  fg: '#fff',
  paths: p(
    'M22.9 22.4l-5.3-12.8c-.3-.7-.7-1-1.3-1h-.6c-.6 0-1 .3-1.3 1l-2.3 5.6h-1.7c-.5 0-.9.4-.9.9s.4.9.9.9h.9L9 22.4c-.1.2-.1.4-.1.6 0 .3.1.5.3.7.2.2.4.3.7.3.2 0 .4-.1.6-.2.2-.1.3-.3.4-.5l2.5-6.2h1.7c.5 0 .9-.4.9-.9s-.4-.9-.9-.9h-1l1.9-4.7 5.1 12.7c.1.2.2.4.4.5.2.1.4.2.6.2.3 0 .5-.1.7-.3.2-.2.3-.4.3-.7 0-.2 0-.4-.2-.6z',
  ),
};

/* Arbitrum — the stylised A in a hexagon. */
const ARB: CoinArt = {
  bg: '#213147',
  fg: '#fff',
  paths: (
    <>
      <path
        d="M16 4.8l10 5.8v11.6l-10 5.8-10-5.8V10.6l10-5.8z"
        fill="none"
        stroke="#fff"
        strokeWidth="1.1"
        opacity=".55"
      />
      <path d="M16.9 11.4l4.9 8.4-1.9 1.1-4.9-8.4 1.9-1.1z" fill="#12AAFF" />
      <path d="M13.3 13.8l1.6 2.7-3 5.2-2.2-1.3 3.6-6.6z" fill="#12AAFF" />
      <path d="M16 9.2l6.3 11-2.1 1.2-5.2-9-4.2 7.4-2.1-1.2L16 9.2z" />
    </>
  ),
};

/* Optimism — the OP double-o. */
const OP: CoinArt = {
  bg: '#FF0420',
  fg: '#fff',
  paths: p(
    'M11.7 20.3c-1.4 0-2.5-.3-3.4-1-.9-.7-1.3-1.6-1.3-2.8 0-.3 0-.6.1-.9.2-1.1.5-2.5.9-4.1.9-3.8 3.3-5.6 7.2-5.6 1.1 0 2 .2 2.9.5.8.4 1.5.9 2 1.6.4.7.7 1.5.7 2.4 0 .3 0 .6-.1.9-.2 1.4-.5 2.7-.9 4.1-.5 1.9-1.3 3.3-2.5 4.2-1.2.9-2.7 1.4-4.7 1.4l-1 -.7zm.3-2.9c.8 0 1.4-.2 1.9-.7.5-.4.9-1.1 1.1-2 .4-1.5.6-2.8.8-3.9.1-.3.1-.6.1-.9 0-1.2-.6-1.8-1.9-1.8-.7 0-1.4.2-1.9.7-.5.4-.8 1.1-1 2-.3 1-.5 2.3-.8 3.9 0 .3-.1.6-.1.9-.1 1.2.6 1.8 1.8 1.8zm8.5 2.8c-.1 0-.2 0-.3-.1-.1-.1-.1-.2-.1-.3v-.1l2.8-13.1c0-.1.1-.2.2-.3.1-.1.2-.1.3-.1h5.4c1.5 0 2.7.3 3.6 1 .9.6 1.3 1.5 1.3 2.7 0 .3 0 .7-.1 1.1-.3 1.6-1 2.8-2.1 3.5-1 .8-2.4 1.1-4.2 1.1h-2.7l-.9 4.4c0 .1-.1.2-.2.3-.1.1-.2.1-.3.1h-2.7z',
  ),
};

/* Pepe — the frog face. */
const PEPE: CoinArt = {
  bg: '#3D8130',
  fg: '#fff',
  paths: (
    <>
      <ellipse cx="11.4" cy="12.4" rx="4" ry="4.4" />
      <ellipse cx="20.6" cy="12.4" rx="4" ry="4.4" />
      <ellipse cx="12.4" cy="13.4" rx="1.7" ry="2" fill="#0d2b08" />
      <ellipse cx="19.6" cy="13.4" rx="1.7" ry="2" fill="#0d2b08" />
      <path d="M7.2 18.4c0-.6.6-1 1.2-.8 2.3.8 4.9 1.2 7.6 1.2s5.3-.4 7.6-1.2c.6-.2 1.2.2 1.2.8 0 3.9-4 6.8-8.8 6.8S7.2 22.3 7.2 18.4z" />
      <path d="M9.6 19.8c1.9.5 4.1.8 6.4.8s4.5-.3 6.4-.8c-.9 2.3-3.4 3.8-6.4 3.8s-5.5-1.5-6.4-3.8z" fill="#0d2b08" opacity=".35" />
    </>
  ),
};

/* Shiba Inu — the dog head. */
const SHIB: CoinArt = {
  bg: '#FFA409',
  fg: '#fff',
  paths: (
    <>
      <path d="M9.4 6.6l4.6 2.8-4.8 3.2-1.4-5.4 1.6-.6z" />
      <path d="M22.6 6.6l1.6.6-1.4 5.4-4.8-3.2 4.6-2.8z" />
      <path d="M16 8.2c4.6 0 8.2 3.4 8.2 8.1 0 5-3.6 9-8.2 9s-8.2-4-8.2-9c0-4.7 3.6-8.1 8.2-8.1z" />
      <ellipse cx="12.8" cy="15.4" rx="1.3" ry="1.6" fill="#3B1F00" />
      <ellipse cx="19.2" cy="15.4" rx="1.3" ry="1.6" fill="#3B1F00" />
      <path d="M16 18.6c1.4 0 2.5.5 2.5 1.1 0 .9-1.1 2.3-2.5 2.3s-2.5-1.4-2.5-2.3c0-.6 1.1-1.1 2.5-1.1z" fill="#3B1F00" />
    </>
  ),
};

/* Dai — the Ɖ with two bars. */
const DAI: CoinArt = {
  bg: '#F5AC37',
  fg: '#fff',
  paths: p(
    'M15.3 6.8c4.1 0 7.5 2.6 8.8 6.3h2.3v1.9h-1.9c0 .3.1.7.1 1s0 .7-.1 1h1.9v1.9h-2.3c-1.3 3.7-4.7 6.3-8.8 6.3H7.6v-6.3H5.2v-1.9h2.4v-2H5.2v-1.9h2.4V6.8h7.7zm-.1 2.1H9.9v4.2h9.7c-1-2.5-3.5-4.2-6.4-4.2h2zm-5.3 10v4.2h5.3c2.9 0 5.4-1.7 6.4-4.2H9.9zm12.1-2H9.9v-2h12.1c0 .3.1.7.1 1s0 .7-.1 1z',
  ),
};

/* THORChain — the RUNE rhombus. */
const RUNE: CoinArt = {
  bg: '#0C0C0C',
  fg: '#00CCFF',
  paths: p('M16 4l10.4 6v12L16 28 5.6 22V10L16 4zm0 3.5L8.6 11.8v8.4L16 24.5l7.4-4.3v-8.4L16 7.5zm0 4l3.9 2.3v4.4L16 20.5l-3.9-2.3v-4.4L16 11.5z'),
};

/* Jupiter — the planet with its ring. */
const JUP: CoinArt = {
  bg: '#12161F',
  fg: '#C7F284',
  paths: (
    <>
      <circle cx="16" cy="15" r="7.5" />
      <ellipse
        cx="16"
        cy="18"
        rx="12"
        ry="3.6"
        fill="none"
        stroke="#C7F284"
        strokeWidth="1.6"
        transform="rotate(-18 16 18)"
      />
    </>
  ),
};

/* PancakeSwap — the rabbit ears. */
const CAKE: CoinArt = {
  bg: '#633001',
  fg: '#FEDC90',
  paths: (
    <>
      <path d="M11 5.4c1 0 1.8.8 1.8 1.8v5.2c-1.3.3-2.5.7-3.6 1.2V7.2c0-1 .8-1.8 1.8-1.8z" />
      <path d="M21 5.4c1 0 1.8.8 1.8 1.8v6.4c-1.1-.5-2.3-.9-3.6-1.2V7.2c0-1 .8-1.8 1.8-1.8z" />
      <ellipse cx="16" cy="20.4" rx="11.4" ry="7.2" />
      <circle cx="11.6" cy="19" r="1.5" fill="#633001" />
      <circle cx="20.4" cy="19" r="1.5" fill="#633001" />
    </>
  ),
};

/* Wrapped assets reuse the underlying brand with a ring. */
const WBTC: CoinArt = { ...BTC, bg: '#F09242' };
const WETH: CoinArt = { ...ETH, bg: '#5A6FC0' };

export const COIN_ART: Record<string, CoinArt> = {
  BTC,
  WBTC,
  ETH,
  WETH,
  USDT,
  USDC,
  DAI,
  SOL,
  XRP,
  LTC,
  DOGE,
  BCH,
  XMR,
  TRX,
  ATOM,
  BNB,
  POL,
  AVAX,
  LINK,
  UNI,
  AAVE,
  ARB,
  OP,
  PEPE,
  SHIB,
  RUNE,
  JUP,
  CAKE,
};

/* Base — the concentric-arc circle. */
const BASE: CoinArt = {
  bg: '#0052FF',
  fg: '#fff',
  paths: p(
    'M16 27.5c6.4 0 11.5-5.1 11.5-11.5S22.4 4.5 16 4.5C9.9 4.5 5 9.2 4.5 15.1h15.2v1.8H4.5c.5 5.9 5.4 10.6 11.5 10.6z',
  ),
};

/** Chain badge marks, keyed by the asset registry's `chain` field. */
export const CHAIN_ART: Record<string, CoinArt> = {
  ethereum: ETH,
  bsc: BNB,
  polygon: POL,
  arbitrum: ARB,
  optimism: OP,
  avalanche: AVAX,
  base: BASE,
  solana: SOL,
  tron: TRX,
  bitcoin: BTC,
  litecoin: LTC,
  dogecoin: DOGE,
  bitcoincash: BCH,
  monero: XMR,
  thorchain: RUNE,
  cosmos: ATOM,
  ripple: XRP,
};
