'use client';

import { ListingCard } from './ListingCard';
import { destinationLabel } from './destinations';
import type { BrowseState } from './useSearch';

type BrowseResultsProps = {
  destination: string;
  state: BrowseState;
};

/**
 * Browse-before-search list (spec 12 §5.2): every processed listing in the chosen
 * destination, price-ascending, straight from `GET /api/listings` — no AI pipeline, no
 * pipeline trace, single column (not the naive-vs-AI compare layout).
 */
export function BrowseResults({ destination, state }: BrowseResultsProps) {
  const label = destinationLabel(destination);
  const count = state.status === 'success' ? state.data.results.length : undefined;

  return (
    <section aria-labelledby="browse-heading" aria-busy={state.status === 'loading'}>
      <div className="flex items-baseline gap-2">
        <h2 id="browse-heading" className="font-heading text-lg font-semibold text-signal">
          Stays in {label}
        </h2>
        {count !== undefined && (
          <span className="font-mono text-xs text-mist">
            {count} {count === 1 ? 'place' : 'places'}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-sm text-mist">
        Everything we have in {label}, cheapest first. Search above to compare naive keyword matching
        against the AI pipeline — within {label}.
      </p>

      {state.status === 'loading' && <p className="mt-4 text-sm text-mist">Loading {label} listings…</p>}

      {state.status === 'error' && <p className="mt-4 text-sm text-red-400">{state.message}</p>}

      {state.status === 'success' &&
        (state.data.results.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-3">
            {state.data.results.map((listing, index) => (
              <ListingCard
                key={typeof listing.id === 'string' ? listing.id : index}
                listing={listing as unknown as Record<string, unknown>}
                variant="browse"
              />
            ))}
          </ul>
        ) : (
          <p className="mt-4 font-mono text-sm text-mist">Nothing to show here yet.</p>
        ))}
    </section>
  );
}
