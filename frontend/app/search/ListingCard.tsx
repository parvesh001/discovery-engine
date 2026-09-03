import { isRecord } from './types';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Left-edge channel rule — which engine produced this card. `browse` is not a comparison, so it stays neutral. */
const CHANNEL_RULE: Record<'naive' | 'ai' | 'browse', string> = {
  ai: 'border-l-flare',
  naive: 'border-l-probe',
  browse: 'border-l-hairline',
};

/**
 * Visual relevance readout for AI-pipeline cards: a matte bar plus the exact percentage.
 * The shape lands faster than the number alone; the number stays for precision. Only ever
 * rendered when `relevanceScore` is a real number (the caller's `!== undefined` guard
 * covers both `null` and absent), so there is no zero-width bar.
 */
function RelevanceMeter({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wider text-mist-dim">Rel</span>
      <span
        role="meter"
        aria-label="Relevance score"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="relative h-1.5 w-24 overflow-hidden rounded-sm bg-well ring-1 ring-inset ring-hairline"
      >
        <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-edge" />
        <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-flare" style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-xs text-signal">{pct}%</span>
    </div>
  );
}

/**
 * Accepts a loosely-typed record rather than the `Listing` type: the top-level response
 * guard (types.ts) only checks that `results` is an array, not that every item inside it
 * has the expected shape. Each field is read defensively here so one malformed listing
 * renders as a degraded-but-present card instead of throwing and taking out the rest of
 * the column's list.
 *
 * `variant` gates chips/relevance score, not just data presence: naive's SQL selects the
 * same `extracted_attributes` column as the AI pipeline, so that data can technically be
 * present on a naive row too — but naive never derived any understanding from it, so
 * showing it there would misattribute the AI pipeline's work to the dumb-match column.
 * `browse` (spec 12) is the pre-search list view — like `naive`, it shows no AI-derived
 * chips or scores.
 */
export function ListingCard({
  listing,
  variant,
}: {
  listing: Record<string, unknown>;
  variant: 'naive' | 'ai' | 'browse';
}) {
  const title = asString(listing.title) ?? 'Untitled listing';
  const price = asNumber(listing.price_per_night);
  const bedrooms = asNumber(listing.bedrooms);
  const location = asString(listing.location);
  // Nullable by design (Voyage caps rerank at 20 candidates; the rest are appended
  // unscored) — asNumber returns undefined for both `null` and any other non-number,
  // so a missing/absent score and an explicit null both simply omit the indicator below,
  // never render as 0.
  const relevanceScore = variant === 'ai' ? asNumber(listing.relevanceScore) : undefined;

  const attrs = variant === 'ai' && isRecord(listing.extracted_attributes) ? listing.extracted_attributes : null;
  // Strictly `=== true`: null/ambiguous pet policy must never render as friendly (a real
  // seed-data case — some listings are genuinely unspecified, not implicitly pet-friendly).
  const petFriendly = attrs?.pet_friendly === true;
  const chips = [
    petFriendly ? 'Pet Friendly' : undefined,
    asString(attrs?.property_type),
    asString(attrs?.view_type),
    ...asStringArray(attrs?.amenities),
  ]
    .filter((chip): chip is string => Boolean(chip))
    .slice(0, 4);

  return (
    <li className={`rounded-lg border-y border-r border-hairline border-l-2 ${CHANNEL_RULE[variant]} bg-panel p-4`}>
      <h3 className="font-heading font-semibold text-signal">{title}</h3>
      <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
        {price !== undefined && <span className="font-mono text-mist">${price}/night</span>}
        {bedrooms !== undefined && <span className="font-mono text-mist">{bedrooms} bd</span>}
        {location && <span className="text-mist">{location}</span>}
      </div>
      {chips.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Matched attributes">
          {chips.map((chip) => (
            <li key={chip} className="rounded-full bg-flare-dim px-2 py-0.5 text-xs text-flare">
              {chip}
            </li>
          ))}
        </ul>
      )}
      {relevanceScore !== undefined && <RelevanceMeter score={relevanceScore} />}
    </li>
  );
}
