import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // "Control Room" design system for /search. Deliberately not named
        // slate/amber (Tailwind's built-in scales) to avoid shadowing those
        // palettes for any other future use.
        //
        // Instrumentation model: a real elevation ramp (graphite -> panel ->
        // well), structural neutrals (hairline, edge), and THREE functional
        // signals with fixed meaning:
        //   flare  = live/real measured data ONLY (meter fill, real ms, AI channel)
        //   probe  = the unaided/reference channel (naive column identity, ticks)
        //   fault  = a measured shortfall (naive zero-match) — NOT a system error,
        //            which still uses Tailwind's brighter red-400.
        //
        // WCAG 2.1 contrast, verified against the surface each token actually
        // renders on (>=4.5:1 for text, >=3:1 for meaningful non-text UI):
        //   signal   on graphite / panel / well : 15.8 / 13.2 / 14.1
        //   mist     on panel / well            :  5.9 /  6.3
        //   mist-dim on panel / well            :  4.87 / 5.15  (tuned up from
        //            #737E8B, which failed at 4.24)
        //   flare    on graphite / panel / well : 10.4 /  8.7 /  9.2
        //   flare    on flare-dim (chip bg)     :  7.2
        //   probe    on panel / well            :  7.4 /  7.8
        //   fault    on panel / well            :  4.85 / 5.13
        //   graphite on signal (picker selected):  15.8
        //   flare meter fill on well (non-text) :  9.2
        //   fault border-l on panel (non-text)  :  4.85
        //   edge     on panel                   :  1.6  -> decorative only; state
        //            is carried by the flare overlay segment, never by edge.
        graphite: '#0B0F14',
        panel: '#141A21',
        well: '#0E141A',
        hairline: '#232B35',
        edge: '#38434F',
        signal: '#E7EBEF',
        mist: '#8F9BA8',
        'mist-dim': '#7E8894',
        flare: '#FFB020',
        'flare-dim': '#3A2E19',
        probe: '#6FB2C4',
        fault: '#CE6A56',
      },
      fontFamily: {
        heading: ['var(--font-heading)'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
};

export default config;
