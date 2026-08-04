import type { ReactNode } from 'react';
import { ListingCard } from './ListingCard';

type ResultsColumnProps = {
  id: string;
  heading: string;
  variant: 'naive' | 'ai';
  status: 'idle' | 'loading' | 'error' | 'success';
  loadingLabel: string;
  errorMessage?: string;
  listings?: Record<string, unknown>[];
  emptyMessage: string;
  /** Same slot/position for both variants — see PipelineTrace / the naive trace line in page.tsx. */
  trace?: ReactNode;
  filtersRelaxed?: boolean;
  /**
   * `degraded: true` deliberately renders nothing extra (spec 08: "do not show a scary
   * error — the UI should look normal"). Re-ranking's fallback already sets every
   * `relevanceScore` to null, so `ListingCard` naturally omits scores and the list just
   * reads as plain similarity-ordered results.
   */
  degraded?: boolean;
};

const SUBHEADING: Record<'naive' | 'ai', string> = {
  naive: 'SUBSTRING MATCH · NO RANKING',
  ai: 'SEMANTIC + RERANK',
};

export function ResultsColumn({
  id,
  heading,
  variant,
  status,
  loadingLabel,
  errorMessage,
  listings,
  emptyMessage,
  trace,
  filtersRelaxed,
}: ResultsColumnProps) {
  const dotColor = variant === 'ai' ? 'bg-flare' : 'bg-mist';

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
        <h2 id={`${id}-heading`} className="font-heading text-lg font-semibold text-signal">
          {heading}
        </h2>
      </div>
      <p className="mt-0.5 font-mono text-[10px] tracking-wider text-mist">{SUBHEADING[variant]}</p>

      {trace && <div className="mt-3">{trace}</div>}

      {status === 'idle' && <p className="mt-3 text-sm text-mist">Run a search to see results here.</p>}

      {status === 'loading' && <p className="mt-3 text-sm text-mist">{loadingLabel}</p>}

      {status === 'error' && <p className="mt-3 text-sm text-red-400">{errorMessage ?? "Couldn't load results."}</p>}

      {status === 'success' && (
        <>
          {filtersRelaxed && (
            <p className="mt-3 rounded-md bg-flare/10 px-3 py-2 text-sm text-flare">
              Showing broader results — we loosened the location/property-type match to avoid an
              empty page. Your other requirements (like pets, budget, and bedrooms) are still
              applied.
            </p>
          )}
          {listings && listings.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-3">
              {listings.map((listing, index) => (
                <ListingCard
                  key={typeof listing.id === 'string' ? listing.id : index}
                  listing={listing}
                  variant={variant}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-3 font-mono text-sm text-mist">{emptyMessage}</p>
          )}
        </>
      )}
    </section>
  );
}
