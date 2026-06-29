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
        // Primary — Indigo
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
        // Dark interview background — slate-950
        background: '#020617',   // slate-950
        surface: '#0f172a',      // slate-900
        border: '#1e293b',       // slate-800
        muted: {
          DEFAULT: '#1e293b',    // slate-800
          foreground: '#94a3b8', // slate-400
        },
        // Semantic states
        success: {
          DEFAULT: '#059669', // emerald-600
          foreground: '#ffffff',
          light: '#d1fae5',
        },
        danger: {
          DEFAULT: '#e11d48', // rose-600
          foreground: '#ffffff',
          light: '#ffe4e6',
        },
        warning: {
          DEFAULT: '#d97706', // amber-600
          foreground: '#ffffff',
          light: '#fef3c7',
        },
      },
      borderRadius: {
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
