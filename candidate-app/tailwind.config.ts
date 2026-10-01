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
         * Candidate screen tokens, mirroring the approved preview. Only the
         * accent differs from it: the preview's green is replaced by the
         * product's existing indigo.
         */
        page: '#F3F4F6',
        panel: {
          DEFAULT: '#FFFFFF',
          alt: '#F8F9FB',
        },
        ink: {
          DEFAULT: '#1B2130',
          muted: '#5B6273',
        },
        line: '#E3E5EA',
        accent: {
          DEFAULT: '#4f46e5', // indigo-600
          ink: '#FFFFFF',
          soft: '#EEF2FF',
        },
        warn: {
          DEFAULT: '#C2542E',
          soft: '#FBEAE3',
        },

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
      backgroundImage: {
        /**
         * The page ground.
         *
         * The diagonal linear fade does the visible work and is listed last so
         * it sits underneath: it scales to any viewport, where radial blooms
         * anchored to the edges wash out entirely on a wide monitor. The three
         * blooms on top are accent only. Light enough throughout that dark
         * `ink` text stays far clear of any contrast limit. Pair with
         * `bg-page`, which supplies the fallback colour.
         */
        app: [
          'radial-gradient(ellipse 100% 60% at 50% 0%, rgba(99,102,241,0.16), transparent 70%)',
          'radial-gradient(ellipse 80% 60% at 100% 100%, rgba(124,58,237,0.20), transparent 65%)',
          'radial-gradient(ellipse 70% 55% at 0% 95%, rgba(79,70,229,0.14), transparent 65%)',
          'linear-gradient(155deg, #FBFBFE 0%, #EFF1FB 40%, #E0E3F5 100%)',
        ].join(','),
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [animate],
}

export default config
