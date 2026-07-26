import { ListingCard } from './ListingCard';

type ResultsColumnProps = {
  id: string;
  heading: string;
  status: 'idle' | 'loading' | 'error' | 'success';
  loadingLabel: string;
  errorMessage?: string;
  listings?: Record<string, unknown>[];
  filtersRelaxed?: boolean;
  /**
   * `degraded: true` deliberately renders nothing extra (spec 08: "do not show a scary
   * error — the UI should look normal"). Re-ranking's fallback already sets every
   * `relevanceScore` to null, so `ListingCard` naturally omits scores and the list just
   * reads as plain similarity-ordered results.
   */
  degraded?: boolean;
};

export function ResultsColumn({
  id,
  heading,
  status,
  loadingLabel,
  errorMessage,
  listings,
  filtersRelaxed,
}: ResultsColumnProps) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col">
      <h2 id={`${id}-heading`} className="text-lg font-semibold text-gray-900 dark:text-gray-50">
        {heading}
      </h2>

      {status === 'idle' && (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Run a search to see results here.</p>
      )}

      {status === 'loading' && <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{loadingLabel}</p>}

      {status === 'error' && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{errorMessage ?? "Couldn't load results."}</p>
      )}

      {status === 'success' && (
        <>
          {filtersRelaxed && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              Showing broader results — your filters were relaxed to avoid an empty page.
            </p>
          )}
          {listings && listings.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-3">
              {listings.map((listing, index) => (
                <ListingCard key={typeof listing.id === 'string' ? listing.id : index} listing={listing} />
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">No results found.</p>
          )}
        </>
      )}
    </section>
  );
}
