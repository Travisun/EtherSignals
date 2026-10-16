import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dce7fe',
          200: '#c0d4fd',
          300: '#94b8fb',
          400: '#6191f7',
          500: '#3c6cf2',
          600: '#254de6',
          700: '#1d3ad3',
          800: '#1e31ab',
          900: '#1e2f87',
          950: '#171f52',
        },
        up: 'rgb(var(--up-rgb) / <alpha-value>)',
        down: 'rgb(var(--down-rgb) / <alpha-value>)',
        panel: '#ffffff',
        canvas: '#f4f5f7',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.06)',
        pop: '0 4px 6px -2px rgb(16 24 40 / 0.05), 0 12px 16px -4px rgb(16 24 40 / 0.10)',
      },
      keyframes: {
        'flash-up': { '0%': { backgroundColor: 'rgb(var(--up-rgb) / 0.18)' }, '100%': { backgroundColor: 'transparent' } },
        'flash-down': { '0%': { backgroundColor: 'rgb(var(--down-rgb) / 0.18)' }, '100%': { backgroundColor: 'transparent' } },
        'slide-in': { '0%': { transform: 'translateY(-4px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
      animation: {
        'flash-up': 'flash-up 0.6s ease-out',
        'flash-down': 'flash-down 0.6s ease-out',
        'slide-in': 'slide-in 0.15s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
