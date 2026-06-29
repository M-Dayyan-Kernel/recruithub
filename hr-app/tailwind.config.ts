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
