import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // "Control Room" design system for /search. Deliberately not named
        // slate/amber (Tailwind's built-in scales) to avoid shadowing those
        // palettes for any other future use. See /search restyle plan for the
        // verified WCAG contrast ratios behind each of these.
        graphite: '#0B0F14',
        panel: '#141A21',
        hairline: '#232B35',
        signal: '#E7EBEF',
        mist: '#8F9BA8',
        flare: '#FFB020',
      },
      fontFamily: {
        heading: ['var(--font-heading)'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
};

export default config;
