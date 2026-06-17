import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        midnight: {
          bg: '#0a0e1a',
          primary: '#3b82f6',
          secondary: '#1d4ed8',
          accent: '#1e3a5f',
          text: '#93c5fd',
          dim: '#0f172a',
        },
        crimson: {
          bg: '#0f0a0a',
          primary: '#ef4444',
          secondary: '#dc2626',
          accent: '#7f1d1d',
          text: '#fca5a5',
          dim: '#1c1111',
        },
        aurora: {
          bg: '#0f172a',
          primary: '#8b5cf6',
          secondary: '#6d28d9',
          accent: '#4c1d95',
          text: '#c4b5fd',
          dim: '#1e1b4b',
        },
        light: {
          bg: '#f8fafc',
          primary: '#2563eb',
          secondary: '#64748b',
          accent: '#e2e8f0',
          text: '#1e293b',
          dim: '#f1f5f9',
        },
      },
      fontFamily: {
        mono: ['Fira Code', 'Cascadia Code', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.3s ease-out',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'typing': 'typing 3.5s steps(40, end)',
        'blink': 'blink 1s step-end infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 5px currentColor' },
          '50%': { boxShadow: '0 0 20px currentColor, 0 0 30px currentColor' },
        },
        'typing': {
          'from': { width: '0' },
          'to': { width: '100%' },
        },
        'blink': {
          '0%, 100%': { borderColor: 'transparent' },
          '50%': { borderColor: 'currentColor' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      backgroundImage: {
        'grid-pattern': 'linear-gradient(rgba(59, 130, 246, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(59, 130, 246, 0.03) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
}

export default config
