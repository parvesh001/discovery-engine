export type EvalCase = {
  query: string;
  mustInclude: string[]; // listing titles expected in top 5
  mustExclude: string[]; // listings that must NOT appear (e.g. non-pet-friendly for a pet-friendly query)
};

/**
 * At least 20 cases (spec 09), spanning explicit-filter, synonym/paraphrase,
 * subjective/subtle-intent, and >=3 long-tail-listing cases. `mustInclude`/`mustExclude`
 * reference real titles from backend/src/scripts/seed-data.ts — keep these two files in
 * sync if the seed data ever changes.
 */
export const testCases: EvalCase[] = [
  // --- Explicit filter queries ---
  {
    query: 'pet friendly cottage in Manali',
    mustInclude: ['Deodar Cottage, Old Manali'],
    mustExclude: [],
  },
  {
    query: 'pet friendly houses in Goa',
    mustInclude: ['Beach House Near Calangute Market'],
    mustExclude: ['Portuguese Quarter Flat, Fontainhas'], // pets prohibited entirely
  },
  {
    query: 'pet friendly cottage near the Gulmarg gondola',
    mustInclude: ['Slope-Side Cottage Near the Gondola'],
    mustExclude: [],
  },
  {
    query: 'a pet friendly place in the mountains',
    mustInclude: ['Deodar Cottage, Old Manali'],
    // 4 bedrooms (not a filter match anyway) and explicitly no pets — a hard SQL filter
    // test, not just semantic ranking (CLAUDE.md rule #2).
    mustExclude: ['Restored Haveli Suite, 1850s'],
  },
  {
    query: 'places under ₹2000 a night',
    mustInclude: ['Garden-Level Room, Landour'],
    mustExclude: ['Beachfront Villa — Candolim'], // 14000/night, well over budget
  },
  {
    query: 'a house with at least 4 bedrooms',
    mustInclude: ['Plantation Bungalow — Six Bedrooms'],
    mustExclude: ['The Canopy Treehouse'], // 0 bedrooms, opposite of the filter
  },
  {
    query: 'a place to stay in Auli',
    mustInclude: ['1-Bedroom Cottage Near Auli Cable Car'],
    mustExclude: [],
  },

  // --- Synonym / paraphrase (query wording differs from listing wording) ---
  {
    query: 'doggy-friendly cabin up in the hills',
    mustInclude: ['Deodar Cottage, Old Manali'],
    mustExclude: [],
  },
  {
    query: 'somewhere completely off the grid, remote and disconnected',
    mustInclude: ['Off-Grid Yurt Above Kaza'],
    mustExclude: [],
  },
  {
    query: 'a seaside house right on the sand',
    mustInclude: ['Beachfront House on Radhanagar Beach'],
    mustExclude: [],
  },
  {
    query: 'a small studio for a short work trip',
    mustInclude: ['Studio Near Cyber Hub'],
    mustExclude: [],
  },
  {
    query: 'a floating stay on the water in Kerala',
    mustInclude: ['Kettuvallam Houseboat on the Backwaters'],
    mustExclude: [],
  },

  // --- Subjective / subtle-intent queries ---
  {
    query: 'romantic getaway, not too remote',
    mustInclude: ['Bandra Bungalow, Walk to Linking Road'],
    mustExclude: [],
  },
  {
    query: 'somewhere cozy and quiet for a weekend',
    mustInclude: ['Garden-Level Room, Landour'],
    mustExclude: [],
  },
  {
    query: 'a place with a spectacular view',
    mustInclude: ['Sea-Facing High-Rise, Marine Drive'],
    mustExclude: [],
  },
  {
    query: 'a peaceful spot for a solo writing retreat',
    mustInclude: ['Dak Bungalow, Corbett Buffer Zone'],
    mustExclude: [],
  },
  {
    query: 'a big house for a large family reunion',
    mustInclude: ['Plantation Bungalow — Six Bedrooms'],
    mustExclude: ['The Canopy Treehouse'],
  },

  // --- Mixed (explicit + vague) ---
  {
    query: 'pet friendly cottage in Manali with a mountain view',
    mustInclude: ['Deodar Cottage, Old Manali'],
    mustExclude: [],
  },
  {
    query: 'budget pet friendly homestay near a Goa beach',
    mustInclude: ['Beach House Near Calangute Market'],
    mustExclude: ['Portuguese Quarter Flat, Fontainhas'],
  },

  // --- Long-tail listings (>= 3 required, spec 09) ---
  {
    query: 'an unusual converted grain silo stay on a working farm',
    mustInclude: ['The Grain Silo — Converted Granary Stay'],
    mustExclude: [],
  },
  {
    query: 'a traditional mud hut near a salt desert in Kutch',
    mustInclude: ['Bhunga Hut in the Banni Grasslands'],
    mustExclude: [],
  },
  {
    query: 'an old colonial forest bungalow near a tiger reserve',
    mustInclude: ['Dak Bungalow, Corbett Buffer Zone'],
    mustExclude: [],
  },
  {
    query: 'a treehouse reached by a swing bridge',
    mustInclude: ['The Canopy Treehouse'],
    mustExclude: [],
  },
];
