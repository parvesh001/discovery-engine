'use client';

import { DESTINATIONS } from './destinations';

type DestinationPickerProps = {
  /** Currently selected slug, or null when nothing is chosen yet. */
  value: string | null;
  onSelect: (slug: string) => void;
  /** 'hero' → the full-page first-run prompt; 'inline' → the compact switcher shown above results. */
  layout?: 'hero' | 'inline';
};

export function DestinationPicker({ value, onSelect, layout = 'hero' }: DestinationPickerProps) {
  const isHero = layout === 'hero';

  return (
    <fieldset
      role="radiogroup"
      aria-label="Choose a destination"
      className={isHero ? 'flex flex-col items-start gap-4' : 'flex flex-wrap items-center gap-2'}
    >
      <legend
        className={
          isHero
            ? 'font-heading text-lg font-semibold text-signal'
            : 'mr-1 font-heading text-sm font-medium text-mist'
        }
      >
        {isHero ? 'Where are you looking to stay?' : 'Destination'}
      </legend>

      <div className={isHero ? 'flex flex-wrap gap-3' : 'flex flex-wrap gap-2'}>
        {DESTINATIONS.map((destination) => {
          const selected = destination.slug === value;
          return (
            <label
              key={destination.slug}
              className={`cursor-pointer rounded-md border px-4 py-2 font-heading text-sm font-semibold transition-colors ${
                selected
                  ? 'border-flare bg-flare text-graphite'
                  : 'border-hairline bg-panel text-signal hover:border-flare/60'
              } ${isHero ? 'text-base' : ''}`}
            >
              <input
                type="radio"
                name="destination"
                value={destination.slug}
                checked={selected}
                onChange={() => onSelect(destination.slug)}
                className="sr-only"
              />
              {destination.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
