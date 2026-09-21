import React, { useEffect, useMemo, useState } from 'react';
import { COIN_ART, type CoinArt } from './coinLogos';

/**
 * Vertical launch sequence with pad, swing arms and exhaustive exhaust.
 *
 * Timeline (8s):
 *  0 - 28%: HOLDDOWN - rocket clamped, engines light, smoke + coins erupt
 * 28 - 38%: ARMS OPEN - swing arms retract
 * 38 - 45%: UNSTICK - slow crawl
 * 45 - 100%: FLIGHT - accelerate straight up into the moon
 *
 * Fixes over previous pass:
 *  - X centering is isolated from Y animation (two wrappers) so the rocket
 *    never shifts horizontally. The previous single-wrapper with -translate-x-1/2
 *    + keyframe translateY overwrote the X centering => lệch.
 *  - Rocket is larger (92 vs 74) and perfectly centered via left-1/2.
 *  - Real pad + tower + swing arms visuals.
 *  - Coins continuously blast from the engine (22) + 4 ride with the hull.
 *  - Smoke puff count doubled and widened.
 *
 * Non-negotiables (tested):
 *  - pointer-events-none on overlay
 *  - unmounts itself after ROCKET_LAUNCH_MS
 *  - respects prefers-reduced-motion
 *  - aria-hidden
 */

export const ROCKET_LAUNCH_MS = 8000;

interface Props {
  trigger?: number;
  playOnMount?: boolean;
  label?: string;
}

export const RocketLaunch: React.FC<Props> = ({
  trigger = 0,
  playOnMount = false,
  label = 'to the moon',
}) => {
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (trigger === 0 && !playOnMount) return;
    if (typeof window !== 'undefined' && window.matchMedia) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    }
    setRunning(true);
    setRunId((n) => n + 1);
    const timer = setTimeout(() => setRunning(false), ROCKET_LAUNCH_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const smoke = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const step = Math.floor(i / 2);
        return {
          dx: side * (44 + step * 42 + ((i * 13) % 34)),
          dy: 4 + ((i * 7) % 20),
          size: 34 + ((i * 17) % 52),
          delay: 820 + step * 84 + (i % 3) * 38,
          scale: 2.4 + ((i * 3) % 8) * 0.24,
        };
      }),
    [],
  );

  const stars = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        left: `${(i * 37 + 7) % 98}%`,
        top: `${(i * 53 + 11) % 95}%`,
        size: 1 + ((i * 7) % 3) * 0.6,
        delay: `${((i * 13) % 17) * 0.11}s`,
        opacity: 0.2 + ((i % 5) * 0.14),
      })),
    [],
  );

  // 4 payload coins that ride with the hull (kept for tests + narrative)
  const rideCoins = useMemo(
    () =>
      [
        { sym: 'BTC', cx: -72, cy: 28, cr: -28, size: 26, delay: 0 },
        { sym: 'ETH', cx: 74, cy: 48, cr: 24, size: 23, delay: 110 },
        { sym: 'SOL', cx: -88, cy: 82, cr: -44, size: 20, delay: 220 },
        { sym: 'USDT', cx: 86, cy: 102, cr: 34, size: 18, delay: 330 },
      ].filter((c) => COIN_ART[c.sym]),
    [],
  );

  // Eruptive coins: blast continuously from engine while clamped
  const blastCoins = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => {
        const syms = ['BTC', 'ETH', 'SOL', 'USDT', 'BNB', 'AVAX', 'LINK', 'DOGE'];
        const sym = syms[i % syms.length];
        const angle = ((i * 47) % 160) - 80; // spread -80..80 deg
        const dist = 70 + ((i * 37) % 180);
        const dx = Math.sin((angle * Math.PI) / 180) * dist;
        const dy = Math.cos((angle * Math.PI) / 180) * (dist * 0.35) + 18;
        // stagger over the hold window
        const delay = 900 + i * 95 + ((i * 13) % 40);
        const rot = (i % 2 === 0 ? 1 : -1) * (18 + ((i * 11) % 50));
        const size = 16 + ((i * 7) % 10);
        return { sym, dx, dy, rot, size, delay };
      }).filter((c) => COIN_ART[c.sym]),
    [],
  );

  if (!running) return null;

  return (
    <div
      key={runId}
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
      aria-hidden="true"
      data-testid="rocket-launch"
    >
      {/* Starfield */}
      {stars.map((s, i) => (
        <span
          key={i}
          className="absolute animate-twinkle rounded-full bg-white"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            opacity: s.opacity,
            animationDelay: s.delay,
          }}
        />
      ))}

      {/* Moon - dead center top, rocket is centered same X so hits it straight */}
      <div className="absolute left-1/2 top-[5vh] -translate-x-1/2 animate-moon-in">
        <Moon />
        <span className="mt-3 block text-center font-mono text-[10px] font-semibold uppercase tracking-[0.34em] text-white/45">
          {label}
        </span>
      </div>

      {/* Pad assembly - fixed to ground, never moves */}
      <div className="absolute bottom-0 left-1/2 h-[96px] w-[420px] -translate-x-1/2">
        {/* Tower behind deck */}
        <div className="absolute bottom-[48px] left-1/2 ml-[112px] -translate-x-1/2 opacity-95">
          <Tower />
        </div>
        {/* Deck */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
          <Deck />
        </div>
        {/* Swing arms - hinge from tower, retract outward */}
        <div className="absolute bottom-[74px] left-1/2 ml-[56px]">
          <div className="absolute left-0 top-0 origin-left animate-arm-upper">
            <SwingArm width={76} />
          </div>
          <div className="absolute left-0 top-[38px] origin-left animate-arm-lower">
            <SwingArm width={86} />
          </div>
        </div>

        {/* Ground smoke sheet - stays at pad */}
        {smoke.map((s, i) => (
          <span
            key={i}
            className="absolute animate-smoke-puff rounded-full bg-white/38"
            style={
              {
                left: '50%',
                bottom: '48px',
                width: s.size,
                height: s.size,
                marginLeft: -s.size / 2,
                marginBottom: -s.size / 2,
                filter: 'blur(15px)',
                animationDelay: `${s.delay}ms`,
                '--dx': `${s.dx}px`,
                '--dy': `${s.dy}px`,
                '--pscale': String(s.scale),
              } as React.CSSProperties
            }
          />
        ))}

        {/* Coin blast - erupts from engine nozzle while clamped, tung tóe */}
        {blastCoins.map((c, i) => (
          <span
            key={i}
            className="absolute animate-coin-blast"
            style={
              {
                left: '50%',
                bottom: '58px',
                width: c.size,
                height: c.size,
                marginLeft: -c.size / 2,
                animationDelay: `${c.delay}ms`,
                '--bx': `${c.dx}px`,
                '--by': `${-c.dy}px`,
                '--br': `${c.rot}deg`,
              } as React.CSSProperties
            }
          >
            <Coin art={COIN_ART[c.sym]} size={c.size} />
          </span>
        ))}
      </div>

      {/* The stack - X centered via outer, Y climbs via inner wrapper */}
      <div className="absolute bottom-[48px] left-1/2 -translate-x-1/2">
        <div className="animate-liftoff">
          <div className="animate-pad-shake">
            <div className="relative">
              {/* Plume behind hull, anchored to nozzle */}
              <div className="absolute left-1/2 top-[97%] -translate-x-1/2 animate-flame-grow">
                <Plume />
              </div>
              <Rocket />
              {/* Ride coins - stay attached slightly off hull */}
              {rideCoins.map((c) => (
                <span
                  key={c.sym}
                  className="absolute left-1/2 top-[62%] animate-coin-ride"
                  style={
                    {
                      width: c.size,
                      height: c.size,
                      marginLeft: -c.size / 2,
                      animationDelay: `${c.delay}ms`,
                      '--cx': `${c.cx}px`,
                      '--cy': `${c.cy}px`,
                      '--cr': `${c.cr}deg`,
                    } as React.CSSProperties
                  }
                >
                  <Coin art={COIN_ART[c.sym]} size={c.size} />
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ art */

const Coin: React.FC<{ art: CoinArt; size: number }> = ({ art, size }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="16" fill={art.bg} />
    <g fill={art.fg}>{art.paths}</g>
  </svg>
);

const Moon: React.FC = () => (
  <svg width="168" height="168" viewBox="0 0 150 150" fill="none">
    <defs>
      <radialGradient id="rlHalo" cx="50%" cy="50%" r="50%">
        <stop offset="52%" stopColor="#dcdcd4" stopOpacity="0.22" />
        <stop offset="100%" stopColor="#dcdcd4" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="rlBody" cx="36%" cy="30%" r="80%">
        <stop offset="0%" stopColor="#fdfdf8" />
        <stop offset="60%" stopColor="#dedeD4" />
        <stop offset="100%" stopColor="#a5a59c" />
      </radialGradient>
    </defs>
    <circle cx="75" cy="75" r="75" fill="url(#rlHalo)" />
    <circle cx="75" cy="75" r="52" fill="url(#rlBody)" />
    <g fill="#000" opacity=".13">
      <circle cx="59" cy="59" r="8.5" />
      <circle cx="91" cy="84" r="11.5" />
      <circle cx="68" cy="97" r="5.8" />
      <circle cx="97" cy="52" r="4.7" />
      <circle cx="51" cy="82" r="4.2" />
      <circle cx="78" cy="66" r="3.2" />
    </g>
  </svg>
);

const Deck: React.FC = () => (
  <svg width="380" height="56" viewBox="0 0 380 56" fill="none">
    <defs>
      <linearGradient id="deckTop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#3a3f48" />
        <stop offset="100%" stopColor="#1e2228" />
      </linearGradient>
      <linearGradient id="deckSide" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#2a2e35" />
        <stop offset="100%" stopColor="#0e1115" />
      </linearGradient>
    </defs>
    {/* shadow */}
    <ellipse cx="190" cy="52" rx="148" ry="6" fill="#000" opacity=".45" />
    {/* side thickness */}
    <path d="M24 18 H356 L348 44 H32 Z" fill="url(#deckSide)" />
    {/* top */}
    <rect x="20" y="12" width="340" height="16" rx="3" fill="url(#deckTop)" stroke="#4a505c" strokeWidth="1.2" />
    {/* center flame trench */}
    <rect x="162" y="10" width="56" height="20" rx="3" fill="#0b0e13" stroke="#1a1e24" />
    <rect x="172" y="14" width="36" height="3" rx="1.5" fill="#ff7a6e" opacity=".85" />
    {/* panels */}
    <g stroke="#2f353f" strokeWidth="0.9" opacity=".9">
      <line x1="62" y1="16" x2="62" y2="28" />
      <line x1="104" y1="16" x2="104" y2="28" />
      <line x1="276" y1="16" x2="276" y2="28" />
      <line x1="318" y1="16" x2="318" y2="28" />
    </g>
    {/* lights */}
    <g opacity=".9">
      <circle cx="42" cy="20" r="2.2" fill="#2fe0c0" />
      <circle cx="338" cy="20" r="2.2" fill="#2fe0c0" />
      <circle cx="52" cy="20" r="1.5" fill="#ff7a6e" opacity=".9" />
      <circle cx="328" cy="20" r="1.5" fill="#ff7a6e" opacity=".9" />
    </g>
  </svg>
);

const Tower: React.FC = () => (
  <svg width="64" height="208" viewBox="0 0 64 208" fill="none">
    <defs>
      <linearGradient id="rlTower" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#3a3f48" />
        <stop offset="55%" stopColor="#2a2e35" />
        <stop offset="100%" stopColor="#1b1e23" />
      </linearGradient>
    </defs>
    {/* legs */}
    <rect x="10" y="6" width="7" height="200" rx="1.2" fill="url(#rlTower)" />
    <rect x="46" y="6" width="7" height="200" rx="1.2" fill="url(#rlTower)" />
    {/* bracing */}
    <g stroke="#333840" strokeWidth="3.1" strokeLinecap="round">
      {Array.from({ length: 8 }, (_, i) => {
        const y = 18 + i * 24;
        return (
          <g key={i}>
            <line x1="13.5" y1={y} x2="49.5" y2={y} opacity=".95" />
            <line x1="13.5" y1={y} x2="49.5" y2={y + 24} opacity=".5" />
          </g>
        );
      })}
    </g>
    {/* top beacon */}
    <rect x="6" y="0" width="52" height="8" rx="2" fill="#434952" />
    <circle cx="32" cy="2.2" r="3.6" fill="#eb5757" />
    <circle cx="32" cy="2.2" r="1.7" fill="#ffd1d1" opacity=".9" />
  </svg>
);

const SwingArm: React.FC<{ width: number }> = ({ width }) => (
  <svg width={width} height="10" viewBox={`0 0 ${width} 10`} fill="none">
    <rect x="0" y="2" width={width - 6} height="6" rx="1.2" fill="#2e3440" stroke="#4a505c" strokeWidth="1" />
    <rect x="6" y="0" width={width - 14} height="10" rx="1" fill="#3a404c" />
    <circle cx="4.5" cy="5" r="3.2" fill="#232830" stroke="#5a6475" strokeWidth="1" />
  </svg>
);

const Rocket: React.FC = () => (
  <svg width="92" height="160" viewBox="0 0 76 132" fill="none">
    <defs>
      <linearGradient id="rlHull" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="42%" stopColor="#eceff4" />
        <stop offset="72%" stopColor="#c2c7d2" />
        <stop offset="100%" stopColor="#9aa0ad" />
      </linearGradient>
      <linearGradient id="rlNose" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#ff7a6e" />
        <stop offset="60%" stopColor="#eb5757" />
        <stop offset="100%" stopColor="#b93f3f" />
      </linearGradient>
      <linearGradient id="rlFin" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#f26a63" />
        <stop offset="100%" stopColor="#a63838" />
      </linearGradient>
      <radialGradient id="rlGlass" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#bffaf0" />
        <stop offset="55%" stopColor="#2fe0c0" />
        <stop offset="100%" stopColor="#0f8f7c" />
      </radialGradient>
    </defs>

    <path d="M22 74C13 82 8 93 7 106c0 0 9-4 15-11V74z" fill="url(#rlFin)" />
    <path d="M54 74c9 8 14 19 15 32 0 0-9-4-15-11V74z" fill="url(#rlFin)" opacity=".85" />

    <path
      d="M38 4c10 12 16 27 16 44v42c0 7-2 13-5 18H27c-3-5-5-11-5-18V48C22 31 28 16 38 4z"
      fill="url(#rlHull)"
    />
    <path d="M38 4c10 12 16 27 16 44v42c0 7-2 13-5 18h-11V4z" fill="#000" opacity=".07" />
    <path d="M38 4c6.5 8 11.4 16.6 14.3 25.6H23.7C26.6 20.6 31.5 12 38 4z" fill="url(#rlNose)" />

    <circle cx="38" cy="48" r="12.5" fill="#0c1116" />
    <circle cx="38" cy="48" r="9.5" fill="url(#rlGlass)" />
    <path
      d="M31 42a9.5 9.5 0 0 1 8-3.4c-3.4.9-6 3-7 6.4-.4 1.3-1.6 1.1-1.4-.3z"
      fill="#fff"
      opacity=".7"
    />

    <g transform="translate(27.5 68) scale(0.66)" fill="#f7931a">
      <path d="M22.5 14.3c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.7-.4-.7 2.6c-.4-.1-.9-.2-1.4-.3l.7-2.6-1.7-.4-.7 2.7-1.1-.3-2.3-.6-.4 1.8s1.2.3 1.2.3c.7.2.8.6.8 1l-.8 3.1c0 0 .1 0 .2.1l-.2 0-1.1 4.3c-.1.2-.3.5-.8.4 0 0-1.2-.3-1.2-.3l-.8 1.9 2.2.5 1.2.3-.7 2.7 1.7.4.7-2.7c.4.1.9.2 1.4.4l-.7 2.7 1.7.4.7-2.7c2.8.5 4.9.3 5.8-2.2.7-2-.0-3.2-1.5-4 1.1-.2 1.9-1 2.1-2.5zm-3.8 5.3c-.5 2-3.9.9-5 .6l.9-3.6c1.1.3 4.6.8 4.1 3zm.5-5.4c-.5 1.8-3.3.9-4.2.7l.8-3.3c.9.2 3.9.6 3.4 2.6z" />
    </g>

    <path d="M27 108h22l-4 9H31l-4-9z" fill="#7d838f" />
    <path d="M38 108h11l-4 9h-7v-9z" fill="#000" opacity=".12" />
  </svg>
);

const FLAME_CLIP = 'polygon(50% 100%, 0% 22%, 18% 0%, 50% 14%, 82% 0%, 100% 22%)';

const Plume: React.FC = () => (
  <div className="relative flex flex-col items-center">
    <span
      className="absolute left-1/2 top-0 -translate-x-1/2 animate-flame-flicker"
      style={{
        width: 46,
        height: 120,
        background:
          'linear-gradient(to bottom, #ff8a34 0%, rgba(235,87,87,0.7) 42%, rgba(235,87,87,0) 100%)',
        clipPath: FLAME_CLIP,
        filter: 'blur(8px)',
        transformOrigin: 'top center',
      }}
    />
    <span
      className="absolute left-1/2 top-0 -translate-x-1/2 animate-flame-flicker"
      style={{
        width: 26,
        height: 82,
        background:
          'linear-gradient(to bottom, #ffd27a 0%, #ff8a34 52%, rgba(255,138,52,0) 100%)',
        clipPath: FLAME_CLIP,
        filter: 'blur(2.5px)',
        transformOrigin: 'top center',
        animationDelay: '45ms',
      }}
    />
    <span
      className="absolute left-1/2 top-0 -translate-x-1/2 animate-flame-flicker"
      style={{
        width: 11,
        height: 42,
        background:
          'linear-gradient(to bottom, #ffffff 0%, #ffe9b0 65%, rgba(255,233,176,0) 100%)',
        clipPath: FLAME_CLIP,
        transformOrigin: 'top center',
        animationDelay: '25ms',
      }}
    />
  </div>
);
