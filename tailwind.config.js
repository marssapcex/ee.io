/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // True black base. Each step is a real surface elevation, not a tint
        // of navy — washed-out "dark" themes come from lifting the base too
        // far off black.
        ink: {
          950: '#050507',
          900: '#08080b',
          850: '#0b0b0f',
          800: '#101014',
          750: '#141419',
          700: '#17171d',
          650: '#1c1c23',
          600: '#212129',
          550: '#282831',
          500: '#30303b',
        },
        line: {
          DEFAULT: '#1f1f27',
          soft: '#17171e',
          strong: '#2e2e3a',
          glow: '#3a3a4a',
        },
        // Saturated, high-chroma accents that hold up against pure black.
        brand: {
          cyan: '#00e5ff',
          teal: '#00f0c0',
          orange: '#ff8a34',
          amber: '#ffc043',
          violet: '#a970ff',
          pink: '#ff4d8d',
          green: '#00e58a',
          red: '#ff4d6a',
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
        glow: '0 0 0 1px rgba(0,229,255,0.28), 0 0 32px -6px rgba(0,229,255,0.35)',
        'glow-orange': '0 0 0 1px rgba(255,138,52,0.28), 0 0 32px -6px rgba(255,138,52,0.3)',
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 16px 48px -12px rgba(0,0,0,0.9)',
        lift: '0 8px 32px -8px rgba(0,0,0,0.85)',
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
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-up': 'slide-up 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        shimmer: 'shimmer 1.8s infinite',
        breathe: 'breathe 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
