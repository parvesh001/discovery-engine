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

/**
 * Channel identity for the two columns. The glyph shape (filled vs hollow) and the colour
 * (`flare` = the live pipeline, `probe` = the unaided baseline) are two redundant carriers
 * of the same "which engine" signal — neither is load-bearing alone. The subheading colour
 * echoes the channel; it stays a static label, never an alarm colour, since it is always
 * on screen. The "came up short" read is carried separately by the empty-state block below.
 */
const CHANNEL: Record<'naive' | 'ai', { glyph: string; chip: string; subheading: string; subheadingClass: string }> = {
  ai: {
    glyph: '◆',
    chip: 'bg-flare-dim text-flare',
    subheading: 'SEMANTIC + RERANK',
    subheadingClass: 'text-flare',
  },
  naive: {
    glyph: '▢',
    chip: 'bg-probe/10 text-probe',
    subheading: 'SUBSTRING MATCH · NO RANKING',
    subheadingClass: 'text-mist',
  },
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
  const channel = CHANNEL[variant];

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`flex h-5 w-5 items-center justify-center rounded font-mono text-[11px] ${channel.chip}`}
        >
          {channel.glyph}
        </span>
        <h2 id={`${id}-heading`} className="font-heading text-lg font-semibold text-signal">
          {heading}
        </h2>
      </div>
      <p className={`mt-0.5 font-mono text-[10px] tracking-wider ${channel.subheadingClass}`}>{channel.subheading}</p>

      {trace && <div className="mt-3">{trace}</div>}

      {status === 'idle' && <p className="mt-3 text-sm text-mist">Run a search to see results here.</p>}

      {status === 'loading' && <p className="mt-3 text-sm text-mist">{loadingLabel}</p>}

      {status === 'error' && <p className="mt-3 text-sm text-red-400">{errorMessage ?? "Couldn't load results."}</p>}

      {status === 'success' && (
        <>
          {filtersRelaxed && (
            <p className="mt-3 rounded-md bg-flare-dim px-3 py-2 text-sm text-flare">
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
          ) : variant === 'naive' ? (
            // The naive column coming up short is the demo's whole point — mark it as a
            // measured shortfall (`fault`), not a system error (still `red-400` elsewhere).
            <div className="mt-3 flex items-start gap-2 rounded-md border-y border-r border-hairline border-l-2 border-l-fault bg-panel px-3 py-2">
              <span aria-hidden="true" className="font-mono text-fault">
                ✗
              </span>
              <p className="font-mono text-sm text-mist">{emptyMessage}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-mist">{emptyMessage}</p>
          )}
        </>
      )}
    </section>
  );
}
