import { isRecord } from './types';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * `price_per_night` is a Postgres NUMERIC column, which node-pg returns as a numeric
 * string (e.g. "4500"), not a JS number — even though the backend's own `Listing` type
 * declares `number`. Confirmed against the real running backend, not a hypothetical.
 * Accepting both here (rather than "fixing" the backend's DB layer, which is out of this
 * phase's scope) keeps the price line from silently disappearing for every real listing.
 */
function asNumericValue(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Accepts a loosely-typed record rather than the `Listing` type: the top-level response
 * guard (types.ts) only checks that `results` is an array, not that every item inside it
 * has the expected shape. Each field is read defensively here so one malformed listing
 * renders as a degraded-but-present card instead of throwing and taking out the rest of
 * the column's list.
 */
export function ListingCard({ listing }: { listing: Record<string, unknown> }) {
  const title = asString(listing.title) ?? 'Untitled listing';
  const price = asNumericValue(listing.price_per_night);
  const bedrooms = asNumber(listing.bedrooms);
  const location = asString(listing.location);
  // Nullable by design (Voyage caps rerank at 20 candidates; the rest are appended
  // unscored) — asNumber returns undefined for both `null` and any other non-number,
  // so a missing/absent score and an explicit null both simply omit the indicator below,
  // never render as 0.
  const relevanceScore = asNumber(listing.relevanceScore);

  const attrs = isRecord(listing.extracted_attributes) ? listing.extracted_attributes : null;
  const chips = [asString(attrs?.property_type), asString(attrs?.view_type), ...asStringArray(attrs?.amenities)]
    .filter((chip): chip is string => Boolean(chip))
    .slice(0, 3);

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h3 className="font-semibold text-gray-900 dark:text-gray-50">{title}</h3>
      <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-gray-600 dark:text-gray-300">
        {price !== undefined && <span>${price}/night</span>}
        {bedrooms !== undefined && <span>{bedrooms} bd</span>}
        {location && <span>{location}</span>}
      </div>
      {chips.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Matched attributes">
          {chips.map((chip) => (
            <li
              key={chip}
              className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-200"
            >
              {chip}
            </li>
          ))}
        </ul>
      )}
      {relevanceScore !== undefined && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Relevance: {(relevanceScore * 100).toFixed(0)}%
        </p>
      )}
    </li>
  );
}
