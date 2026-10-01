import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const config: Config = {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        /**
         * Semantic tokens from `src/styles/tokens.css`. Prefer these over raw
         * palette scales: `bg-surface`, `text-ink-muted`, `border-line`,
         * `bg-accent`. They are what keeps every page on one scheme.
         */
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          2: 'rgb(var(--surface-2) / <alpha-value>)',
          3: 'rgb(var(--surface-3) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          subtle: 'rgb(var(--ink-subtle) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          ink: 'rgb(var(--accent-ink) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
          border: 'rgb(var(--accent-border) / <alpha-value>)',
        },
        rail: {
          DEFAULT: 'rgb(var(--rail) / <alpha-value>)',
          2: 'rgb(var(--rail-2) / <alpha-value>)',
          ink: 'rgb(var(--rail-ink) / <alpha-value>)',
          muted: 'rgb(var(--rail-ink-muted) / <alpha-value>)',
          line: 'rgb(var(--rail-line) / <alpha-value>)',
        },
        pos: { DEFAULT: 'rgb(var(--pos) / <alpha-value>)', soft: 'rgb(var(--pos-soft) / <alpha-value>)' },
        warn: { DEFAULT: 'rgb(var(--warn) / <alpha-value>)', soft: 'rgb(var(--warn-soft) / <alpha-value>)' },
        neg: { DEFAULT: 'rgb(var(--neg) / <alpha-value>)', soft: 'rgb(var(--neg-soft) / <alpha-value>)' },

        /** Webknot corporate blues, sampled from the logo. */
        brand: {
          50: '#EEF3FF',
          100: '#D9E3FC',
          200: '#B7C9F6',
          300: '#93B4FF',
          400: '#6E8FE0',
          500: '#4160B8',
          600: '#35509C',
          700: '#2B3A7A',
          800: '#1E2A5E',
          900: '#141C40',
        },

        // Primary — Indigo (trustworthy, professional)
        primary: {
          DEFAULT: '#4f46e5', // indigo-600
          foreground: '#ffffff',
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        // Sidebar — Slate-900
        sidebar: {
          DEFAULT: '#0f172a',    // slate-900
          foreground: '#f8fafc', // slate-50
          muted: '#1e293b',      // slate-800
          border: '#334155',     // slate-700
          accent: '#4f46e5',     // indigo-600 for active items
        },
        // Semantic states
        success: {
          DEFAULT: '#059669', // emerald-600
          foreground: '#ffffff',
          light: '#d1fae5',   // emerald-100
        },
        danger: {
          DEFAULT: '#e11d48', // rose-600
          foreground: '#ffffff',
          light: '#ffe4e6',   // rose-100
        },
        warning: {
          DEFAULT: '#d97706', // amber-600
          foreground: '#ffffff',
          light: '#fef3c7',   // amber-100
        },
        // Background / surfaces
        background: '#fafafa',  // zinc-50
        surface: '#ffffff',
        border: '#e4e4e7',      // zinc-200
        muted: {
          DEFAULT: '#f4f4f5',   // zinc-100
          foreground: '#71717a', // zinc-500
        },
      },
      boxShadow: {
        e1: 'var(--elev-1)',
        e2: 'var(--elev-2)',
        e3: 'var(--elev-3)',
        accent: 'var(--elev-accent)',
      },
      borderRadius: {
        card: 'var(--r-xl)',
        lg: '0.5rem',
        md: 'calc(0.5rem - 2px)',
        sm: 'calc(0.5rem - 4px)',
        xl: '0.75rem',
        '2xl': '1rem',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [animate],
}

export default config
