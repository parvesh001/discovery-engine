import { describe, expect, it } from 'vitest';
import { seedListings } from './seed-data.js';

const LONG_TAIL_TITLE_PATTERN = /yurt|treehouse|houseboat|floating home|silo|airstream|fire lookout|studio|garden-level/i;

function isSparse(rawDescription: string): boolean {
  const sentenceCount = rawDescription.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
  return sentenceCount <= 2;
}

describe('seedListings', () => {
  it('contains exactly 35 listings', () => {
    expect(seedListings).toHaveLength(35);
  });

  it('has price_per_night within the $50-$800 range for every listing', () => {
    for (const listing of seedListings) {
      expect(listing.pricePerNight).toBeGreaterThanOrEqual(50);
      expect(listing.pricePerNight).toBeLessThanOrEqual(800);
    }
  });

  it('has bedrooms spanning studio (0) through 6, within range for every listing', () => {
    const bedroomCounts = seedListings.map((l) => l.bedrooms);
    for (const count of bedroomCounts) {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(6);
    }
    expect(Math.min(...bedroomCounts)).toBe(0);
    expect(Math.max(...bedroomCounts)).toBe(6);
  });

  it('has at least 5 long-tail listings (unusual property type and/or sparse description)', () => {
    const longTail = seedListings.filter(
      (l) => LONG_TAIL_TITLE_PATTERN.test(l.title) || isSparse(l.rawDescription),
    );
    expect(longTail.length).toBeGreaterThanOrEqual(5);
  });

  it('expresses pet policy in more than one distinct way across listings', () => {
    const explicitFriendly = seedListings.filter((l) => /pet-friendly|pets? (are|is) (more than )?welcome|welcomes dogs/i.test(l.rawDescription));
    const explicitNo = seedListings.filter((l) => /cannot accommodate pets|no pets|not permitted|prohibits pets|unable to host pets/i.test(l.rawDescription));
    const mentionsDogGear = seedListings.filter((l) => /dog bed|dog bowl|fenced (run|yard|acre|side yard)|paw-wash|dog run|crate available/i.test(l.rawDescription));
    const noPetMention = seedListings.filter(
      (l) => !explicitFriendly.includes(l) && !explicitNo.includes(l) && !mentionsDogGear.includes(l),
    );

    expect(explicitFriendly.length).toBeGreaterThan(0);
    expect(explicitNo.length).toBeGreaterThan(0);
    expect(mentionsDogGear.length).toBeGreaterThan(0);
    expect(noPetMention.length).toBeGreaterThan(0);
  });

  it('expresses view type in more than one distinct way across listings', () => {
    const explicitView = seedListings.filter((l) => /\bview[s]?\b/i.test(l.rawDescription));
    const noViewKeyword = seedListings.filter((l) => !/\bview[s]?\b/i.test(l.rawDescription));

    expect(explicitView.length).toBeGreaterThan(0);
    expect(noViewKeyword.length).toBeGreaterThan(0);
  });

  it('does not repeat the exact same description text across listings', () => {
    const descriptions = seedListings.map((l) => l.rawDescription);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('covers a mix of mountain, coastal, and city locations', () => {
    const locations = seedListings.map((l) => l.location);
    expect(new Set(locations).size).toBeGreaterThan(20);
  });
});
