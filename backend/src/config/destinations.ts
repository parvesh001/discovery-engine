import { z } from 'zod';

/**
 * The demo's fixed set of location scopes (spec 12, Phase 11). This module is the single
 * backend source of truth — routes validate against `destinationSlugSchema`, the demo seed
 * tags rows with these slugs, and retrieval/naive/browse scope on them. The frontend keeps
 * a hand-mirrored copy in `frontend/app/search/destinations.ts`; a test
 * (`destinations.test.ts`) asserts the two stay in sync.
 *
 * Adding a destination is deliberately a code change in two files, not config — see the
 * spec's "Explicit Out of Scope" (no dynamic/admin-managed list).
 */
export type Destination = { slug: string; label: string };

export const DESTINATIONS: Destination[] = [
  { slug: 'manali', label: 'Manali' },
  { slug: 'goa', label: 'Goa' },
];

/**
 * Literal `as const` tuple so `z.enum` accepts it (`[string, ...string[]]`). Kept next to
 * `DESTINATIONS` and cross-checked in `destinations.test.ts` so the two can't drift.
 */
export const DESTINATION_SLUGS = ['manali', 'goa'] as const;

export type DestinationSlug = (typeof DESTINATION_SLUGS)[number];

/** Reused by every route that accepts a `destination` (spec 12 §1.4). */
export const destinationSlugSchema = z.enum(DESTINATION_SLUGS);
