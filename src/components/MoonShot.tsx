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
  /** Shown on the moon when the rocket lands. */
  label?: string;
}

const DURATION_MS = 2900;

export const MoonShot: React.FC<Props> = ({ trigger, label }) => {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (trigger === 0) return;
    if (typeof window !== 'undefined' && window.matchMedia) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    }
    setRunning(true);
    const timer = setTimeout(() => setRunning(false), DURATION_MS);
    return () => clearTimeout(timer);
  }, [trigger]);

  // Star field is stable for the lifetime of a launch, not regenerated on
  // every render.
  const stars = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        left: `${(i * 37 + 11) % 96}%`,
        delay: `${(i % 6) * 0.17}s`,
        height: 10 + ((i * 13) % 26),
        opacity: 0.18 + ((i % 5) * 0.12),
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
      {stars.map((star, i) => (
        <span
          key={i}
          className="absolute top-0 w-px animate-star-streak bg-gradient-to-b from-transparent via-white to-transparent"
          style={{
            left: star.left,
            height: star.height,
            opacity: star.opacity,
            animationDelay: star.delay,
          }}
        />
      ))}

      {/* The moon, top-right */}
      <div className="absolute right-[6vw] top-[8vh] animate-moon-rise">
        <div className="relative">
          <div
            className="h-20 w-20 rounded-full bg-[#d8d8d0]"
            style={{
              boxShadow:
                '0 0 60px 12px rgba(216,216,208,0.16), inset -10px -6px 0 0 rgba(0,0,0,0.16)',
            }}
          />
          <span className="absolute left-[22%] top-[28%] h-2.5 w-2.5 rounded-full bg-black/10" />
          <span className="absolute left-[52%] top-[54%] h-4 w-4 rounded-full bg-black/10" />
          <span className="absolute left-[34%] top-[68%] h-2 w-2 rounded-full bg-black/10" />
          {label && (
            <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-widest text-white/60">
              {label}
            </span>
          )}
        </div>
      </div>

      {/* Rocket, bottom-left → moon */}
      <div className="absolute bottom-[-12vh] left-[6vw] animate-launch">
        <div className="relative -rotate-[38deg]">
          <Rocket />
        </div>
      </div>
    </div>
  );
};

const Rocket: React.FC = () => (
  <div className="relative flex flex-col items-center">
    <svg width="42" height="70" viewBox="0 0 42 70" fill="none">
      {/* body */}
      <path
        d="M21 2c7 8 10.5 17 10.5 27v18H10.5V29C10.5 19 14 10 21 2z"
        fill="#e9e9ee"
      />
      <path d="M21 2c7 8 10.5 17 10.5 27v18H21V2z" fill="#c4c4ce" />
      {/* nose */}
      <path d="M21 2c2.6 3 4.7 6.2 6.2 9.6H14.8C16.3 8.2 18.4 5 21 2z" fill="#eb5757" />
      {/* fins */}
      <path d="M10.5 36L3 50v6l7.5-7z" fill="#eb5757" />
      <path d="M31.5 36L39 50v6l-7.5-7z" fill="#c74848" />
      {/* window */}
      <circle cx="21" cy="26" r="5" fill="#0d0d0d" />
      <circle cx="21" cy="26" r="3.6" fill="#2fe0c0" />
      <circle cx="19.6" cy="24.6" r="1.1" fill="#fff" fillOpacity=".65" />
      {/* BTC badge on the hull. Drawn as a path, not a ₿ glyph: the
          character is missing from plenty of system font stacks and falls
          back to a tofu box. */}
      <g transform="translate(15.6 33.4) scale(0.34)" fill="#e8873a">
        <path d="M22.5 14.3c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.7-.4-.7 2.6c-.4-.1-.9-.2-1.4-.3l.7-2.6-1.7-.4-.7 2.7-1.1-.3-2.3-.6-.4 1.8s1.2.3 1.2.3c.7.2.8.6.8 1l-.8 3.1c0 0 .1 0 .2.1l-.2 0-1.1 4.3c-.1.2-.3.5-.8.4 0 0-1.2-.3-1.2-.3l-.8 1.9 2.2.5 1.2.3-.7 2.7 1.7.4.7-2.7c.4.1.9.2 1.4.4l-.7 2.7 1.7.4.7-2.7c2.8.5 4.9.3 5.8-2.2.7-2-.0-3.2-1.5-4 1.1-.2 1.9-1 2.1-2.5zm-3.8 5.3c-.5 2-3.9.9-5 .6l.9-3.6c1.1.3 4.6.8 4.1 3zm.5-5.4c-.5 1.8-3.3.9-4.2.7l.8-3.3c.9.2 3.9.6 3.4 2.6z" />
      </g>
    </svg>

    {/* exhaust */}
    <div className="-mt-1 flex origin-top animate-flame-flicker flex-col items-center">
      <span
        className="h-7 w-3.5 rounded-b-full bg-gradient-to-b from-white via-brand-amber to-transparent"
        style={{ filter: 'blur(0.4px)' }}
      />
      <span className="-mt-6 h-10 w-2 rounded-b-full bg-gradient-to-b from-brand-orange via-brand-red/70 to-transparent blur-[2px]" />
    </div>
  </div>
);
