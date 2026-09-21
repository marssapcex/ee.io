import React, { useEffect, useMemo, useState } from 'react';

/**
 * "To the moon" launch sequence, fired once when an order is built.
 *
 * Deliberately scoped: a fixed overlay with `pointer-events-none` that unmounts
 * itself after the run, so it can never swallow a click or leave a timer
 * behind. Honours `prefers-reduced-motion` by not mounting at all — a rocket
 * flying across the viewport is exactly the kind of motion that setting exists
 * to suppress.
 */

interface Props {
  /** Flip to a new value to trigger a launch. */
  trigger: number;
  /** Shown under the moon when the rocket lands. */
  label?: string;
}

export const MOONSHOT_DURATION_MS = 3400;

export const MoonShot: React.FC<Props> = ({ trigger, label }) => {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (trigger === 0) return;
    if (typeof window !== 'undefined' && window.matchMedia) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    }
    setRunning(true);
    const timer = setTimeout(() => setRunning(false), MOONSHOT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [trigger]);

  // Stable for the lifetime of a launch, not regenerated on every render.
  const streaks = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        left: `${(i * 37 + 11) % 97}%`,
        delay: `${((i * 7) % 11) * 0.09}s`,
        height: 12 + ((i * 13) % 30),
        opacity: 0.16 + ((i % 5) * 0.1),
      })),
    [],
  );

  const sparks = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        dx: ((i * 53) % 40) - 20,
        delay: `${(i % 7) * 0.13}s`,
        size: 2 + ((i * 3) % 4),
        hue: ['#ffd27a', '#ff9f43', '#ff6b4a'][i % 3],
      })),
    [],
  );

  if (!running) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[60] overflow-hidden"
      aria-hidden="true"
      data-testid="moonshot"
    >
      {/* Warp streaks */}
      {streaks.map((s, i) => (
        <span
          key={i}
          className="absolute top-0 w-px animate-star-streak bg-gradient-to-b from-transparent via-white to-transparent"
          style={{
            left: s.left,
            height: s.height,
            opacity: s.opacity,
            animationDelay: s.delay,
          }}
        />
      ))}

      {/* Moon, top-right */}
      <div className="absolute right-[7vw] top-[9vh] animate-moon-rise">
        <Moon />
        {label && (
          <span className="mt-4 block text-center font-mono text-[11px] font-semibold uppercase tracking-[0.3em] text-white/55">
            {label}
          </span>
        )}
      </div>

      {/* Rocket: bottom-left → moon */}
      <div className="absolute bottom-[-16vh] left-[4vw] animate-launch">
        <div className="relative -rotate-[34deg]">
          {/* Exhaust plume sits behind the hull */}
          <div className="absolute left-1/2 top-[88%] -translate-x-1/2">
            <Plume />
            {sparks.map((s, i) => (
              <span
                key={i}
                className="absolute left-1/2 top-2 animate-spark rounded-full"
                style={{
                  width: s.size,
                  height: s.size,
                  background: s.hue,
                  marginLeft: s.dx,
                  animationDelay: s.delay,
                }}
              />
            ))}
          </div>
          <Rocket />
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ art */

const Moon: React.FC = () => (
  <svg width="132" height="132" viewBox="0 0 132 132" fill="none">
    <defs>
      <radialGradient id="moonHalo" cx="50%" cy="50%" r="50%">
        <stop offset="60%" stopColor="#d8d8d0" stopOpacity="0.22" />
        <stop offset="100%" stopColor="#d8d8d0" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="moonBody" cx="36%" cy="32%" r="78%">
        <stop offset="0%" stopColor="#fbfbf6" />
        <stop offset="62%" stopColor="#dedeD4" />
        <stop offset="100%" stopColor="#a9a9a0" />
      </radialGradient>
    </defs>
    <circle cx="66" cy="66" r="66" fill="url(#moonHalo)" />
    <circle cx="66" cy="66" r="42" fill="url(#moonBody)" />
    <g fill="#000" opacity=".13">
      <circle cx="52" cy="52" r="7.5" />
      <circle cx="80" cy="74" r="10" />
      <circle cx="60" cy="86" r="5" />
      <circle cx="86" cy="46" r="4" />
      <circle cx="44" cy="72" r="3.4" />
    </g>
  </svg>
);

const Rocket: React.FC = () => (
  <svg width="76" height="132" viewBox="0 0 76 132" fill="none">
    <defs>
      <linearGradient id="hull" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="42%" stopColor="#eceff4" />
        <stop offset="72%" stopColor="#c2c7d2" />
        <stop offset="100%" stopColor="#9aa0ad" />
      </linearGradient>
      <linearGradient id="noseG" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#ff7a6e" />
        <stop offset="60%" stopColor="#eb5757" />
        <stop offset="100%" stopColor="#b93f3f" />
      </linearGradient>
      <linearGradient id="finG" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#f26a63" />
        <stop offset="100%" stopColor="#a63838" />
      </linearGradient>
      <radialGradient id="glassG" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#bffaf0" />
        <stop offset="55%" stopColor="#2fe0c0" />
        <stop offset="100%" stopColor="#0f8f7c" />
      </radialGradient>
    </defs>

    {/* fins */}
    <path d="M22 74C13 82 8 93 7 106c0 0 9-4 15-11V74z" fill="url(#finG)" />
    <path d="M54 74c9 8 14 19 15 32 0 0-9-4-15-11V74z" fill="url(#finG)" opacity=".85" />

    {/* body */}
    <path
      d="M38 4c10 12 16 27 16 44v42c0 7-2 13-5 18H27c-3-5-5-11-5-18V48C22 31 28 16 38 4z"
      fill="url(#hull)"
    />
    {/* shading seam down the right */}
    <path d="M38 4c10 12 16 27 16 44v42c0 7-2 13-5 18h-11V4z" fill="#000" opacity=".07" />

    {/* nose cone */}
    <path d="M38 4c6.5 8 11.4 16.6 14.3 25.6H23.7C26.6 20.6 31.5 12 38 4z" fill="url(#noseG)" />

    {/* window */}
    <circle cx="38" cy="48" r="12.5" fill="#0c1116" />
    <circle cx="38" cy="48" r="9.5" fill="url(#glassG)" />
    <path d="M31 42a9.5 9.5 0 0 1 8-3.4c-3.4.9-6 3-7 6.4-.4 1.3-1.6 1.1-1.4-.3z" fill="#fff" opacity=".7" />

    {/* BTC badge. Drawn as a path, not a "₿" glyph: the character is missing
        from plenty of system font stacks and falls back to a tofu box. */}
    <g transform="translate(27.5 68) scale(0.66)" fill="#f7931a">
      <path d="M22.5 14.3c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.7-.4-.7 2.6c-.4-.1-.9-.2-1.4-.3l.7-2.6-1.7-.4-.7 2.7-1.1-.3-2.3-.6-.4 1.8s1.2.3 1.2.3c.7.2.8.6.8 1l-.8 3.1c0 0 .1 0 .2.1l-.2 0-1.1 4.3c-.1.2-.3.5-.8.4 0 0-1.2-.3-1.2-.3l-.8 1.9 2.2.5 1.2.3-.7 2.7 1.7.4.7-2.7c.4.1.9.2 1.4.4l-.7 2.7 1.7.4.7-2.7c2.8.5 4.9.3 5.8-2.2.7-2-.0-3.2-1.5-4 1.1-.2 1.9-1 2.1-2.5zm-3.8 5.3c-.5 2-3.9.9-5 .6l.9-3.6c1.1.3 4.6.8 4.1 3zm.5-5.4c-.5 1.8-3.3.9-4.2.7l.8-3.3c.9.2 3.9.6 3.4 2.6z" />
    </g>

    {/* engine bell */}
    <path d="M27 108h22l-4 9H31l-4-9z" fill="#7d838f" />
    <path d="M38 108h11l-4 9h-7v-9z" fill="#000" opacity=".12" />
  </svg>
);

/**
 * Layered flame: white core, amber body, red tail.
 *
 * Each layer is a teardrop via clip-path rather than a rounded rectangle — a
 * `rounded-b-full` block reads as a pill/capsule, not as fire.
 */
const FLAME_CLIP = 'polygon(50% 100%, 0% 22%, 18% 0%, 50% 14%, 82% 0%, 100% 22%)';

const Plume: React.FC = () => (
  <div className="relative flex flex-col items-center">
    <span
      className="absolute left-1/2 top-0 -translate-x-1/2 animate-flame-flicker"
      style={{
        width: 34,
        height: 86,
        background: 'linear-gradient(to bottom, #ff8a34 0%, rgba(235,87,87,0.7) 42%, rgba(235,87,87,0) 100%)',
        clipPath: FLAME_CLIP,
        filter: 'blur(6px)',
        transformOrigin: 'top center',
      }}
    />
    <span
      className="absolute left-1/2 top-0 -translate-x-1/2 animate-flame-flicker"
      style={{
        width: 19,
        height: 58,
        background: 'linear-gradient(to bottom, #ffd27a 0%, #ff8a34 52%, rgba(255,138,52,0) 100%)',
        clipPath: FLAME_CLIP,
        filter: 'blur(2px)',
        transformOrigin: 'top center',
        animationDelay: '45ms',
      }}
    />
    <span
      className="absolute left-1/2 top-0 -translate-x-1/2 animate-flame-flicker"
      style={{
        width: 8,
        height: 30,
        background: 'linear-gradient(to bottom, #ffffff 0%, #ffe9b0 65%, rgba(255,233,176,0) 100%)',
        clipPath: FLAME_CLIP,
        transformOrigin: 'top center',
        animationDelay: '25ms',
      }}
    />
  </div>
);
