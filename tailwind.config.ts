import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F7F5F1',
        paper: '#FFFFFF',
        'paper-2': '#F1EEE7',
        ink: '#1C1A17',
        muted: '#6B675F',
        faint: '#9A968D',
        line: '#E5E1D6',
        red: { DEFAULT: '#C8102E', deep: '#8C0F22' },
        gold: { DEFAULT: '#F4B400', ink: '#8A6200' },
        green: { ink: '#0E8A4B' }
      },
      fontFamily: {
        display: ['Anton', 'sans-serif'],
        condensed: ['"Barlow Semi Condensed"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace']
      },
      borderRadius: { DEFAULT: '10px' }
    }
  },
  plugins: []
};
export default config;
