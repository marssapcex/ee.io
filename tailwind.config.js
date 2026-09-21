/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#000000',
          900: '#09090b', // page — pure near-black like Polymarket
          850: '#1a1a1f', // card — slightly lifted, visible separation
          800: '#232329', // well / inner input
          750: '#2a2a30',
          700: '#303036',
          650: '#383840',
          600: '#44444c',
          550: '#52525c',
          500: '#6b6b76',
        },
        line: {
          DEFAULT: 'rgba(255,255,255,0.06)', // polymarket: hairline 6%
          soft: 'rgba(255,255,255,0.04)',
          strong: 'rgba(255,255,255,0.10)',
          glow: 'rgba(255,255,255,0.16)',
        },
        brand: {
          cyan: '#2fe0c0',
          teal: '#19c8a8',
          green: '#12823f',
          greenMid: '#27ae60',
          greenBright: '#4ec97f',
          red: '#eb5757',
          redBright: '#f4756f',
          orange: '#e8873a',
          amber: '#d9a441',
          violet: '#8b7ff0',
          blue: '#2d9cdb',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Helvetica Neue',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.05) inset, 0 12px 40px -16px rgba(0,0,0,0.9)',
        lift: '0 16px 48px -20px rgba(0,0,0,0.95)',
        'glow-mint': '0 0 0 1px rgba(47,224,192,0.22), 0 8px 32px -14px rgba(47,224,192,0.28)',
        'glow-green': '0 0 0 1px rgba(39,174,96,0.28), 0 8px 28px -14px rgba(39,174,96,0.32)',
        'glow-red': '0 0 0 1px rgba(235,87,87,0.28), 0 8px 28px -14px rgba(235,87,87,0.32)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(-3px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(12px) scale(0.99)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        breathe: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        /* --- 8s launch: long hold, then slow crawl, then accelerate straight up
             Liftoff is translateY only; X centering is preserved by wrapper. */
        liftoff: {
          '0%': { transform: 'translateY(0)' },
          '28%': { transform: 'translateY(0)' }, /* clamped */
          '34%': { transform: 'translateY(-10px)' }, /* unstick */
          '38%': { transform: 'translateY(-36px)' },
          '45%': { transform: 'translateY(-14vh)' },
          '58%': { transform: 'translateY(-38vh)' },
          '72%': { transform: 'translateY(-72vh)' },
          '86%': { transform: 'translateY(-118vh)' },
          '100%': { transform: 'translateY(-172vh)' },
        },
        'pad-shake': {
          '0%, 10%': { transform: 'translateX(0) rotate(0deg)' },
          '12%': { transform: 'translateX(-1.5px) rotate(-0.45deg)' },
          '14%': { transform: 'translateX(1.6px) rotate(0.5deg)' },
          '16%': { transform: 'translateX(-1.4px) rotate(-0.4deg)' },
          '18%': { transform: 'translateX(1.3px) rotate(0.38deg)' },
          '21%': { transform: 'translateX(-1px) rotate(-0.28deg)' },
          '24%': { transform: 'translateX(0.9px) rotate(0.24deg)' },
          '28%': { transform: 'translateX(-0.5px) rotate(-0.12deg)' },
          '33%, 100%': { transform: 'translateX(0) rotate(0deg)' },
        },
        'flame-grow': {
          '0%': { transform: 'scaleY(0) scaleX(0.5)', opacity: '0' },
          '8%': { transform: 'scaleY(0.45) scaleX(0.9)', opacity: '0.9' },
          '13%': { transform: 'scaleY(1.18) scaleX(1.08)', opacity: '1' },
          '28%, 84%': { transform: 'scaleY(1) scaleX(1)', opacity: '1' },
          '100%': { transform: 'scaleY(1.28) scaleX(0.86)', opacity: '0.85' },
        },
        'smoke-puff': {
          '0%': { transform: 'translate(0,0) scale(0.22)', opacity: '0' },
          '16%': { opacity: '0.32' },
          '58%': { opacity: '0.16' },
          '100%': {
            transform: 'translate(var(--dx), var(--dy)) scale(var(--pscale))',
            opacity: '0',
          },
        },
        /* Coins erupt outward from nozzle, tung tóe */
        'coin-blast': {
          '0%': { transform: 'translate(0,0) rotate(0deg) scale(0.2)', opacity: '0' },
          '12%': { transform: 'translate(calc(var(--bx) * 0.15), calc(var(--by) * 0.12)) rotate(calc(var(--br) * 0.2)) scale(1)', opacity: '1' },
          '45%': { transform: 'translate(calc(var(--bx) * 0.75), calc(var(--by) * 0.7)) rotate(calc(var(--br) * 0.75)) scale(1)', opacity: '1' },
          '100%': { transform: 'translate(calc(var(--bx) * 1.18), calc(var(--by) * 1.35)) rotate(calc(var(--br))) scale(0.82)', opacity: '0' },
        },
        'coin-ride': {
          '0%': { transform: 'translate(0,0) rotate(0deg) scale(0)', opacity: '0' },
          '26%': { opacity: '0' },
          '36%': { transform: 'translate(calc(var(--cx) * 0.5), calc(var(--cy) * 0.5)) rotate(calc(var(--cr) * 0.4)) scale(1)', opacity: '1' },
          '84%': { transform: 'translate(var(--cx), var(--cy)) rotate(var(--cr)) scale(1)', opacity: '1' },
          '100%': { transform: 'translate(calc(var(--cx) * 1.25), calc(var(--cy) * 1.3)) rotate(calc(var(--cr) * 1.4)) scale(0.82)', opacity: '0' },
        },
        /* Swing arms retract before liftoff */
        'arm-upper': {
          '0%, 28%': { transform: 'rotate(0deg)' },
          '38%': { transform: 'rotate(-68deg)' },
          '100%': { transform: 'rotate(-72deg)' },
        },
        'arm-lower': {
          '0%, 30%': { transform: 'rotate(0deg)' },
          '40%': { transform: 'rotate(-72deg)' },
          '100%': { transform: 'rotate(-76deg)' },
        },
        'moon-in': {
          '0%': { opacity: '0', transform: 'translate(-50%, 14px) scale(0.86)' },
          '18%': { opacity: '1', transform: 'translate(-50%, 0) scale(1)' },
          '86%': { opacity: '1', transform: 'translate(-50%, 0) scale(1)' },
          '100%': { opacity: '0', transform: 'translate(-50%, -6px) scale(1.06)' },
        },
        twinkle: {
          '0%, 100%': { opacity: '0.18' },
          '50%': { opacity: '0.9' },
        },
        'flame-flicker': {
          '0%, 100%': { transform: 'scaleY(1) scaleX(1)', opacity: '0.95' },
          '50%': { transform: 'scaleY(1.35) scaleX(0.82)', opacity: '0.7' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-up': 'slide-up 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        shimmer: 'shimmer 1.8s infinite',
        breathe: 'breathe 2s ease-in-out infinite',
        liftoff: 'liftoff 8s linear forwards',
        'pad-shake': 'pad-shake 8s linear forwards',
        'flame-grow': 'flame-grow 8s ease-out forwards',
        'smoke-puff': 'smoke-puff 2.8s ease-out forwards',
        'coin-ride': 'coin-ride 8s ease-out forwards',
        'coin-blast': 'coin-blast 1.9s ease-out forwards',
        'arm-upper': 'arm-upper 8s ease-in-out forwards',
        'arm-lower': 'arm-lower 8s ease-in-out forwards',
        'moon-in': 'moon-in 8s ease-out forwards',
        twinkle: 'twinkle 2.4s ease-in-out infinite',
        'flame-flicker': 'flame-flicker 90ms ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
