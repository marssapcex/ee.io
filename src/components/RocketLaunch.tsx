import React, { useEffect, useMemo, useState } from 'react';
import { COIN_ART, type CoinArt } from './coinLogos';

/**
 * Vertical launch sequence: ignition → hold-down shake → slow liftoff →
 * acceleration → the moon. Plays when the page opens, and again whenever an
 * order is built.
 *
 * The motion follows how a real rocket leaves the pad: it does NOT start at
 * full speed. Engines light, the stack shudders against the clamps while
 * exhaust floods the pad, it unsticks, and only then does it accelerate. That
 * shape is encoded in the `liftoff` keyframes as a distance-vs-time curve on a
 * `linear` timing function — writing the curve by hand rather than leaning on
 * a single `ease-in` gives exact control over the hold and the unstick.
 *
 * Non-negotiables, all covered by tests:
 *  - `pointer-events-none` on the overlay, so it can never eat a click on the
 *    UI underneath. This is why it is safe to render above the page.
 *  - unmounts itself when the run ends; no permanent DOM, no stray timer.
 *  - does not mount at all under `prefers-reduced-motion`.
 *  - `aria-hidden`: it carries no information a screen reader needs.
 */

export const ROCKET_LAUNCH_MS = 4800;

interface Props {
  /** Increment to replay. */
  trigger?: number;
  /** Fire once as the page opens. */
  playOnMount?: boolean;
  label?: string;
}

export const RocketLaunch: React.FC<Props> = ({
  trigger = 0,
  playOnMount = false,
  label = 'to the moon',
}) => {
  const [running, setRunning] = useState(false);
  // Remounts the subtree so a replay restarts every child animation from 0%.
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
    // playOnMount is read once; only `trigger` should replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  // Stable per run, so a re-render mid-flight does not reshuffle the scene.
  const smoke = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const step = Math.floor(i / 2);
        return {
          dx: side * (46 + step * 44 + ((i * 11) % 30)),
          dy: 6 + ((i * 7) % 18),
          size: 30 + ((i * 17) % 38),
          delay: 260 + step * 90 + (i % 2) * 45,
          scale: 2.6 + ((i * 3) % 7) * 0.22,
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

  // The payload. This is a swap app — the rocket takes the coins up.
  const coins = useMemo(
    () =>
      [
        { sym: 'BTC', cx: -66, cy: 34, cr: -28, size: 26, delay: 0 },
        { sym: 'ETH', cx: 68, cy: 50, cr: 24, size: 23, delay: 110 },
        { sym: 'SOL', cx: -84, cy: 84, cr: -44, size: 20, delay: 220 },
        { sym: 'USDT', cx: 80, cy: 104, cr: 34, size: 18, delay: 330 },
      ].filter((c) => COIN_ART[c.sym]),
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

      {/* Moon, top centre — the rocket flies straight into it */}
      <div className="absolute left-1/2 top-[6vh] -translate-x-1/2 animate-moon-in">
        <Moon />
        <span className="mt-3 block text-center font-mono text-[10px] font-semibold uppercase tracking-[0.34em] text-white/45">
          {label}
        </span>
      </div>

      {/* Pad exhaust. Stays at the bottom: the rocket leaves, the smoke does not. */}
      <div className="absolute bottom-[4vh] left-1/2 h-0 w-0 -translate-x-1/2">
        {smoke.map((s, i) => (
          <span
            key={i}
            className="absolute animate-smoke-puff rounded-full bg-white/40"
            style={
              {
                left: -s.size / 2,
                top: -s.size / 2,
                width: s.size,
                height: s.size,
                filter: 'blur(14px)',
                animationDelay: `${s.delay}ms`,
                '--dx': `${s.dx}px`,
                '--dy': `${s.dy}px`,
                '--pscale': String(s.scale),
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* The stack. Outer div climbs; inner div shudders on the clamps. */}
      <div className="absolute bottom-[7vh] left-1/2 -translate-x-1/2 animate-liftoff">
        <div className="animate-pad-shake">
          <div className="relative">
            {/* Plume sits behind the hull, anchored to the engine bell. */}
            <div className="absolute left-1/2 top-[96%] -translate-x-1/2 animate-flame-grow">
              <Plume />
            </div>

            <Rocket />

            {/* Payload riding alongside */}
            {coins.map((c) => (
              <span
                key={c.sym}
                className="absolute left-1/2 top-[64%] animate-coin-ride"
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
  <svg width="150" height="150" viewBox="0 0 150 150" fill="none">
    <defs>
      <radialGradient id="rlHalo" cx="50%" cy="50%" r="50%">
        <stop offset="52%" stopColor="#dcdcd4" stopOpacity="0.2" />
        <stop offset="100%" stopColor="#dcdcd4" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="rlBody" cx="36%" cy="30%" r="80%">
        <stop offset="0%" stopColor="#fdfdf8" />
        <stop offset="60%" stopColor="#dedeD4" />
        <stop offset="100%" stopColor="#a5a59c" />
      </radialGradient>
    </defs>
    <circle cx="75" cy="75" r="75" fill="url(#rlHalo)" />
    <circle cx="75" cy="75" r="46" fill="url(#rlBody)" />
    <g fill="#000" opacity=".12">
      <circle cx="59" cy="59" r="8" />
      <circle cx="91" cy="84" r="11" />
      <circle cx="68" cy="97" r="5.5" />
      <circle cx="97" cy="52" r="4.5" />
      <circle cx="51" cy="82" r="3.8" />
    </g>
  </svg>
);

const Rocket: React.FC = () => (
  <svg width="74" height="128" viewBox="0 0 76 132" fill="none">
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

    {/* BTC badge as a path, not a "₿" glyph — the character is missing from
        plenty of system font stacks and falls back to a tofu box. */}
    <g transform="translate(27.5 68) scale(0.66)" fill="#f7931a">
      <path d="M22.5 14.3c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.7-.4-.7 2.6c-.4-.1-.9-.2-1.4-.3l.7-2.6-1.7-.4-.7 2.7-1.1-.3-2.3-.6-.4 1.8s1.2.3 1.2.3c.7.2.8.6.8 1l-.8 3.1c0 0 .1 0 .2.1l-.2 0-1.1 4.3c-.1.2-.3.5-.8.4 0 0-1.2-.3-1.2-.3l-.8 1.9 2.2.5 1.2.3-.7 2.7 1.7.4.7-2.7c.4.1.9.2 1.4.4l-.7 2.7 1.7.4.7-2.7c2.8.5 4.9.3 5.8-2.2.7-2-.0-3.2-1.5-4 1.1-.2 1.9-1 2.1-2.5zm-3.8 5.3c-.5 2-3.9.9-5 .6l.9-3.6c1.1.3 4.6.8 4.1 3zm.5-5.4c-.5 1.8-3.3.9-4.2.7l.8-3.3c.9.2 3.9.6 3.4 2.6z" />
    </g>

    <path d="M27 108h22l-4 9H31l-4-9z" fill="#7d838f" />
    <path d="M38 108h11l-4 9h-7v-9z" fill="#000" opacity=".12" />
  </svg>
);

/**
 * Three stacked teardrops: white core, amber body, red tail. Clipped to a
 * flame polygon — a `rounded-b-full` block reads as a pill, not as fire.
 */
const FLAME_CLIP = 'polygon(50% 100%, 0% 22%, 18% 0%, 50% 14%, 82% 0%, 100% 22%)';

const Plume: React.FC = () => (
  <div className="relative flex flex-col items-center">
    <span
      className="absolute left-1/2 top-0 -translate-x-1/2 animate-flame-flicker"
      style={{
        width: 40,
        height: 104,
        background:
          'linear-gradient(to bottom, #ff8a34 0%, rgba(235,87,87,0.68) 42%, rgba(235,87,87,0) 100%)',
        clipPath: FLAME_CLIP,
        filter: 'blur(7px)',
        transformOrigin: 'top center',
      }}
    />
    <span
      className="absolute left-1/2 top-0 -translate-x-1/2 animate-flame-flicker"
      style={{
        width: 22,
        height: 70,
        background:
          'linear-gradient(to bottom, #ffd27a 0%, #ff8a34 52%, rgba(255,138,52,0) 100%)',
        clipPath: FLAME_CLIP,
        filter: 'blur(2px)',
        transformOrigin: 'top center',
        animationDelay: '45ms',
      }}
    />
    <span
      className="absolute left-1/2 top-0 -translate-x-1/2 animate-flame-flicker"
      style={{
        width: 9,
        height: 36,
        background:
          'linear-gradient(to bottom, #ffffff 0%, #ffe9b0 65%, rgba(255,233,176,0) 100%)',
        clipPath: FLAME_CLIP,
        transformOrigin: 'top center',
        animationDelay: '25ms',
      }}
    />
  </div>
);
