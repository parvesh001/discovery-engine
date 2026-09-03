import { describe, expect, it } from 'vitest';
import { DESTINATIONS, DESTINATION_SLUGS, destinationSlugSchema } from './destinations.js';

describe('destinations registry', () => {
  it('keeps DESTINATION_SLUGS in sync with DESTINATIONS', () => {
    expect(DESTINATIONS.map((d) => d.slug)).toEqual([...DESTINATION_SLUGS]);
  });

  it('has a non-empty label for every destination', () => {
    for (const destination of DESTINATIONS) {
      expect(destination.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('accepts every known slug and rejects anything else', () => {
    for (const slug of DESTINATION_SLUGS) {
      expect(destinationSlugSchema.parse(slug)).toBe(slug);
    }
    expect(destinationSlugSchema.safeParse('mumbai').success).toBe(false);
    expect(destinationSlugSchema.safeParse('').success).toBe(false);
    expect(destinationSlugSchema.safeParse('MANALI').success).toBe(false);
  });
});
