import { describe, expect, it } from 'vitest';
import { manaliListings, goaListings, demoListings } from './seed-demo-data.js';

// Deliberately does NOT assert the eval dataset's ₹800–18,000 price band or 0–6 bedroom
// range (spec 12 §4.5): the demo set intentionally exceeds both (Goa villas to ₹22,000,
// an 8-bedroom Manali cottage).
describe('demo seed dataset', () => {
  it('has 35 Manali + 37 Goa = 72 listings', () => {
    expect(manaliListings).toHaveLength(35);
    expect(goaListings).toHaveLength(37);
    expect(demoListings).toHaveLength(72);
  });

  it('tags every combined row with a manali/goa destination and none other', () => {
    const manaliTagged = demoListings.filter((l) => l.destination === 'manali');
    const goaTagged = demoListings.filter((l) => l.destination === 'goa');
    expect(manaliTagged).toHaveLength(35);
    expect(goaTagged).toHaveLength(37);
    for (const listing of demoListings) {
      expect(['manali', 'goa']).toContain(listing.destination);
    }
  });

  it('has a positive price and non-negative bedroom count for every listing', () => {
    for (const listing of demoListings) {
      expect(listing.pricePerNight).toBeGreaterThan(0);
      expect(Number.isInteger(listing.bedrooms)).toBe(true);
      expect(listing.bedrooms).toBeGreaterThanOrEqual(0);
    }
  });

  it('has a non-empty title and location for every listing', () => {
    for (const listing of demoListings) {
      expect(listing.title.trim().length).toBeGreaterThan(0);
      expect(listing.location.trim().length).toBeGreaterThan(0);
    }
  });

  it('does not repeat the exact same description text across listings', () => {
    const descriptions = demoListings.map((l) => l.rawDescription);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('carries no leftover mojibake from the source file', () => {
    for (const listing of demoListings) {
      expect(listing.title).not.toMatch(/Ã|Â|â€/);
      expect(listing.rawDescription).not.toMatch(/Ã|Â|â€/);
    }
  });
});
