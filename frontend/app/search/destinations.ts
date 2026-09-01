// Hand-mirrored from backend/src/config/destinations.ts — keep the two in sync. The
// backend is the source of truth (it validates every request against its own copy); this
// mirror exists only so the frontend can render the picker without an extra round-trip.
// Adding a destination is a deliberate two-file change (see spec 12, "Explicit Out of Scope").

export type Destination = { slug: string; label: string };

export const DESTINATIONS: Destination[] = [
  { slug: 'manali', label: 'Manali' },
  { slug: 'goa', label: 'Goa' },
];

export function isDestinationSlug(value: string | null | undefined): value is string {
  return typeof value === 'string' && DESTINATIONS.some((d) => d.slug === value);
}

export function destinationLabel(slug: string): string {
  return DESTINATIONS.find((d) => d.slug === slug)?.label ?? slug;
}
