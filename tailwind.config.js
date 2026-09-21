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
          950: '#000000',
          900: '#040405',
          850: '#0a0a0c',
          800: '#0f0f13',
          750: '#131318',
          700: '#18181e',
          650: '#1d1d24',
          600: '#23232b',
          550: '#2a2a33',
          500: '#33333e',
        },
        line: {
          DEFAULT: '#1e1e26',
          soft: '#141419',
          strong: '#2f2f3a',
          glow: '#454555',
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
