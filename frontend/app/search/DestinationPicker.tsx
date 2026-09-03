'use client';

import { DESTINATIONS } from './destinations';

type DestinationPickerProps = {
  /** Currently selected slug. There is always one (spec 12 §5.1 — no "no destination" state). */
  value: string;
  onSelect: (slug: string) => void;
};

/**
 * The compact Manali/Goa toggle shown above the results. This is the *only* destination
 * switcher (spec 12, "Revised During Implementation" — the standalone "Change destination"
 * button was removed): picking the other option resets any active query and re-browses.
 */
export function DestinationPicker({ value, onSelect }: DestinationPickerProps) {
  return (
    <fieldset role="radiogroup" aria-label="Choose a destination" className="flex flex-wrap items-center gap-2">
      <legend className="mr-1 font-heading text-sm font-medium text-mist">Destination</legend>

      <div className="flex flex-wrap gap-2">
        {DESTINATIONS.map((destination) => {
          const selected = destination.slug === value;
          return (
            <label
              key={destination.slug}
              className={`cursor-pointer rounded-md border px-4 py-2 font-heading text-sm font-semibold transition-colors ${
                selected
                  ? 'border-edge bg-signal text-graphite'
                  : 'border-hairline bg-panel text-signal hover:border-edge'
              }`}
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
