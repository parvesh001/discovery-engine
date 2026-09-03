// Hand-mirrored from backend/src/config/destinations.ts — keep the two in sync. The
// backend is the source of truth (it validates every request against its own copy); this
// mirror exists only so the frontend can render the picker without an extra round-trip.
// Adding a destination is a deliberate two-file change (see spec 12, "Explicit Out of Scope").

export type Destination = { slug: string; label: string };

export const DESTINATIONS: Destination[] = [
  { slug: 'manali', label: 'Manali' },
  { slug: 'goa', label: 'Goa' },
];

/** The destination shown when the URL carries no (valid) ?destination= — spec 12 §5.1. */
export const DEFAULT_DESTINATION_SLUG: string = DESTINATIONS[0]?.slug ?? 'manali';

export function isDestinationSlug(value: string | null | undefined): value is string {
  return typeof value === 'string' && DESTINATIONS.some((d) => d.slug === value);
}

export function destinationLabel(slug: string): string {
  return DESTINATIONS.find((d) => d.slug === slug)?.label ?? slug;
}
