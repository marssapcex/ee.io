/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Polymarket-style surface ramp: a near-black page with cards only a
         * few points lighter. Separation comes from hairline borders and
         * spacing, not from stacking progressively greyer boxes — that is what
         * made the previous pass look like an arcade cabinet.
         */
        ink: {
          950: '#000000', // page
          900: '#0a0a0a', // page, raised
          850: '#121212', // card
          800: '#161616', // well inside a card
          750: '#1c1c1c',
          700: '#212121',
          650: '#272727',
          600: '#2e2e2e',
          550: '#383838',
          500: '#454545',
        },
        /** Hairlines are white at low alpha, so they read on any surface. */
        line: {
          DEFAULT: 'rgba(255,255,255,0.07)',
          soft: 'rgba(255,255,255,0.045)',
          strong: 'rgba(255,255,255,0.12)',
          glow: 'rgba(255,255,255,0.22)',
        },
        brand: {
          // Primary accent — mint rather than electric cyan. Still crypto, no
          // longer a highlighter pen.
          cyan: '#2fe0c0',
          teal: '#19c8a8',
          // Market green / red, Polymarket weight: saturated enough to read
          // instantly, dim enough to sit on black without vibrating.
          // Button fill. White label on this is 4.89:1 — AA. The lighter
          // #27ae60 is 2.87:1 with white and is reserved for text/borders on
          // dark, where it reads 6.5:1.
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
        // Depth without a halo: a hairline top highlight plus a long soft drop.
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
        /* --- to the moon --- */
        launch: {
          '0%': { transform: 'translate(0, 0) rotate(0deg)', opacity: '0' },
          '6%': { opacity: '1' },
          '88%': { opacity: '1' },
          '100%': { transform: 'translate(46vw, -118vh) rotate(6deg)', opacity: '0' },
        },
        'moon-rise': {
          '0%': { opacity: '0', transform: 'translateY(16px) scale(0.9)' },
          '30%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          '80%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(-6px) scale(1.04)' },
        },
        'star-streak': {
          '0%': { transform: 'translateY(-10vh)', opacity: '0' },
          '10%': { opacity: '1' },
          '100%': { transform: 'translateY(115vh)', opacity: '0' },
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
        launch: 'launch 2.6s cubic-bezier(0.55, 0, 0.9, 0.35) forwards',
        'moon-rise': 'moon-rise 2.8s ease-out forwards',
        'star-streak': 'star-streak 1.1s linear infinite',
        'flame-flicker': 'flame-flicker 90ms ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
