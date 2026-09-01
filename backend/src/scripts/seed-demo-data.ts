// Demo dataset (spec 12, Phase 11) — 35 Manali + 37 Goa listings, loaded into the deployed
// catalogue by `pnpm --filter backend run seed:demo`. This is NOT used by the eval suite;
// the original 36-listing eval dataset lives in `seed-eval-data.ts` and is untouched.
//
// Transcribed from the reviewed `final-consolidated-listings.ts`, with the source file's
// UTF-8 mojibake repaired (em dashes, é in "café"/"décor").

import type { SeedListing, DemoSeedListing } from './seedTypes.js';

export const manaliListings: SeedListing[] = [
  {
    title: 'The Bakhari Retreat, Sethan',
    rawDescription: `3BHK wooden cottage 9km above Manali on the Sethan road. Bukhari in the living room, geyser in both baths, deck facing the Pir Panjal range. We're two ex-IT folks who moved up in 2019. There's a water bowl and a couple of old towels by the mudroom door for anyone who shows up with four legs, and the back garden's fenced in — good for letting a dog run around while you have your morning chai on the deck. Power backup covers the whole cottage during cuts.`,
    pricePerNight: 4200, bedrooms: 3, location: 'Sethan, Manali, Himachal Pradesh', latitude: 32.2801, longitude: 77.1584,
  },
  {
    title: 'Riverside Room, Old Manali',
    rawDescription: `One room with attached bath, on the Beas side of Old Manali, 2km from the main market and cafes. Small but the balcony makes up for it — you fall asleep to the river. No kitchen, but there's a shared common area with a kettle and induction plate. No pets here, the building's too small and the stairs are steep.`,
    pricePerNight: 1800, bedrooms: 0, location: 'Old Manali, Himachal Pradesh', latitude: 32.2549, longitude: 77.1687,
  },
  {
    title: 'Aanandi Homestay, Burwa Village',
    rawDescription: `Family-run homestay in an apple orchard, 6.5km from Manali Mall Road. 2 bedrooms, home-cooked meals included (extra for non-veg), views of the snow line right from the breakfast table. This is a working orchard so please don't let dogs off leash near the trees — otherwise we're happy to host pets. Staff comes daily, no extra charge for that here.`,
    pricePerNight: 2600, bedrooms: 2, location: 'Burwa, Manali, Himachal Pradesh', latitude: 32.2296, longitude: 77.1445,
  },
  {
    title: 'The ForestBound Cottage',
    rawDescription: `Luxury villa in the heart of Manali, walkable to Hadimba Devi Temple, Old Manali cafes, and Mall Road. 4BHK, all rooms attached bath, central heating. Private lawn we can set up for a bonfire on request. Not the right fit for pets — we've got a lot of glass furniture and delicate décor throughout.`,
    pricePerNight: 8500, bedrooms: 4, location: 'Manali, Himachal Pradesh', latitude: 32.2432, longitude: 77.1892,
  },
  {
    title: 'The Meadow View, Solang Road',
    rawDescription: `Simple 2 bedroom apartment 12km from Manali town, close to the Solang Valley turn-off. Fully equipped kitchen, geyser, parking for one car. Ground floor unit, faces the parking area. No frills, no bukhari, just a clean place to sleep between activities.`,
    pricePerNight: 2400, bedrooms: 2, location: 'Solang Valley Road, Manali, Himachal Pradesh', latitude: 32.3181, longitude: 77.1571,
  },
  {
    title: 'Kuteer Boho Stay, Hallan Valley',
    rawDescription: `An eight-bedroom converted cottage on a quiet lane above the Hallan valley, run with a boho-café attached downstairs. Good for larger groups or a work-from-mountains stretch — stable WiFi, dedicated desks in two rooms. We're dog people ourselves, well-behaved pets always welcome, garden's fenced for exactly that reason.`,
    pricePerNight: 6200, bedrooms: 8, location: 'Hallan Valley, Manali, Himachal Pradesh', latitude: 32.2103, longitude: 77.1211,
  },
  {
    title: 'Studio Near Mall Road',
    rawDescription: `Compact studio, 1.2km from Mall Road and Manu Temple, good for a short work trip or a solo traveler passing through. Attached bath, hairdryer, iron, basic kitchenette. Nothing fancy.`,
    pricePerNight: 1500, bedrooms: 0, location: 'Manali, Himachal Pradesh', latitude: 32.2396, longitude: 77.1887,
  },
  {
    title: 'The OakHurst, Balsari Village',
    rawDescription: `A rustic stone-and-wood house in Balsari village, 10 minutes from main Manali. Snow-capped peaks are visible right from the kitchen window most mornings, especially once the mist clears past 9am. Woodstove, no television, pine forest on all sides. Numerous hiking trails start right outside the door.`,
    pricePerNight: 3600, bedrooms: 2, location: 'Balsari, Manali, Himachal Pradesh', latitude: 32.2650, longitude: 77.1398,
  },
  {
    title: 'The Panorama Retreat',
    rawDescription: `A charming wooden cottage on the Naggar road, 10km from main Manali. Two bedrooms, wraparound porch, wood-fired heating throughout. Built by the current owner's grandfather in the 1970s and kept largely as it was.`,
    pricePerNight: 3400, bedrooms: 2, location: 'Naggar Road, Manali, Himachal Pradesh', latitude: 32.1949, longitude: 77.1739,
  },
  {
    title: 'Ara — Family Homestay',
    rawDescription: `A cottage-styled family-run homestay near Burwa village, 6.5km from Manali, nestled amid apple orchards with snow-covered peaks visible from the room. Home-cooked meals available on request.`,
    pricePerNight: 2800, bedrooms: 1, location: 'Burwa, Manali, Himachal Pradesh', latitude: 32.2296, longitude: 77.1445,
  },
  {
    title: 'The Grain Loft, Naggar',
    rawDescription: `A converted grain store on a working orchard near Naggar Castle, one room, curved stone walls, a ladder up to the sleeping platform. Off-grid solar, composting toilet. The orchard has a couple of resident cats and a very food-motivated Labrador, so if your dog gets along with livestock and other animals, bring them; otherwise this probably isn't the right fit this time.`,
    pricePerNight: 2100, bedrooms: 0, location: 'Naggar, Himachal Pradesh', latitude: 32.1889, longitude: 77.1889,
  },
  {
    title: 'The Willow Loft, Prini',
    rawDescription: `1BHK loft above the owner's own house in Prini village, 7km from Manali town. Wood stove, hot geyser, small kitchenette. Quiet lane, apple trees on both sides. Good for a short work-from-hills stretch.`,
    pricePerNight: 2200, bedrooms: 1, location: 'Prini, Manali, Himachal Pradesh', latitude: 32.2306, longitude: 77.2033,
  },
  {
    title: 'Hidimba View Cottage',
    rawDescription: `2 bedroom cottage a 12-minute walk from Hadimba Devi Temple, close to Old Manali's cafe lane. Attached baths, room heaters included in the rate. We don't take pets — small property, thin walls, other guests right next door.`,
    pricePerNight: 3800, bedrooms: 2, location: 'Manali, Himachal Pradesh', latitude: 32.2465, longitude: 77.1839,
  },
  {
    title: 'Solang Ski Lodge',
    rawDescription: `4BHK lodge near the Solang gondola base, heated common area, boot-drying room, ski storage. Big groups welcome. Given the amount of gear coming through, we ask guests not to bring pets — the mudroom's already stretched thin in peak season.`,
    pricePerNight: 9200, bedrooms: 4, location: 'Solang Valley, Manali, Himachal Pradesh', latitude: 32.3175, longitude: 77.1569,
  },
  {
    title: 'Apple Orchard Room, Burwa',
    rawDescription: `Single room inside a working apple orchard, shared bathroom, home-cooked breakfast included. Basic but genuinely peaceful — you're woken up by birdsong, not traffic.`,
    pricePerNight: 1400, bedrooms: 0, location: 'Burwa, Manali, Himachal Pradesh', latitude: 32.2280, longitude: 77.1420,
  },
  {
    title: 'The Riverbend House',
    rawDescription: `3BHK independent house right on the Beas, 4km from Old Manali market. Private garden runs down to the riverbank. We keep an old towel bin and a water bowl by the side door — a lot of our regulars travel with dogs and this has become the unofficial drop point for muddy paws.`,
    pricePerNight: 6400, bedrooms: 3, location: 'Old Manali, Himachal Pradesh', latitude: 32.2601, longitude: 77.1642,
  },
  {
    title: 'Chalet Himalaya, Kothi',
    rawDescription: `A timber chalet in Kothi village, 15km up the Rohtang road, with the Beas gorge visible from every window on the north side. No heating beyond the bukhari, no wifi past the village edge. This one's for people who actually want to be off-grid, not just say they were.`,
    pricePerNight: 3200, bedrooms: 2, location: 'Kothi, Manali, Himachal Pradesh', latitude: 32.3389, longitude: 77.2036,
  },
  {
    title: 'The Deodar House, Jagatsukh',
    rawDescription: `Old wooden house in Jagatsukh village, one of the oldest settlements in the valley, 6km from Manali. Original slate roof, deodar cedar beams throughout. The owners have two dogs of their own who tend to greet every guest at the gate — bring yours along if it's friendly with other dogs.`,
    pricePerNight: 4100, bedrooms: 3, location: 'Jagatsukh, Manali, Himachal Pradesh', latitude: 32.2019, longitude: 77.2158,
  },
  {
    title: 'Aleo Homestay, Vashisht',
    rawDescription: `Family homestay in Vashisht village, known for its hot springs and the old temple. 2 rooms, shared kitchen, terrace looking straight down the valley toward Manali town. No pets on this one — we're right next to the temple path and it can get crowded with pilgrims during festival season.`,
    pricePerNight: 2600, bedrooms: 2, location: 'Vashisht, Manali, Himachal Pradesh', latitude: 32.2597, longitude: 77.1975,
  },
  {
    title: 'Snowline Retreat, Gulaba',
    rawDescription: `2BHK stone cottage near Gulaba, 22km from Manali on the Rohtang side, well past where most day-trippers turn back. Bukhari, hot water on request (takes 20 minutes to heat), unbeatable views of the snow line in winter. Plan for at least two nights given the drive.`,
    pricePerNight: 3900, bedrooms: 2, location: 'Gulaba, Manali, Himachal Pradesh', latitude: 32.3667, longitude: 77.2167,
  },
  {
    title: 'The Bramble Cottage, Kasol',
    rawDescription: `2BHK wooden cottage on the Parvati river in Kasol, a couple hours from Manali proper but popular enough with the same crowd to list here. Riverside deck, hammocks. Pet friendly, always have been — half our regulars travel with dogs.`,
    pricePerNight: 2900, bedrooms: 2, location: 'Kasol, Himachal Pradesh', latitude: 32.0098, longitude: 77.3145,
  },
  {
    title: 'Rangri Homestay',
    rawDescription: `Simple 1BHK in Rangri village above Manali, run by a family who's hosted guests here for over a decade. Home-cooked meals, no heating beyond blankets and a hot water bottle on request. Honest and basic.`,
    pricePerNight: 1700, bedrooms: 1, location: 'Rangri, Manali, Himachal Pradesh', latitude: 32.2544, longitude: 77.1758,
  },
  {
    title: 'Whispering Pines, Manali',
    rawDescription: `3BHK independent house 3km from Mall Road, set back in a stand of pines with genuine quiet at night. Central heating throughout, not just bukhari. We're a small family operation, no staff beyond ourselves.`,
    pricePerNight: 5200, bedrooms: 3, location: 'Manali, Himachal Pradesh', latitude: 32.2501, longitude: 77.1755,
  },
  {
    title: 'Beas View Room, Kullu Road',
    rawDescription: `Single room on the Kullu road out of Manali, river visible from the small balcony. Attached bath, no kitchen, breakfast included in the rate.`,
    pricePerNight: 1550, bedrooms: 1, location: 'Manali, Himachal Pradesh', latitude: 32.2011, longitude: 77.1698,
  },
  {
    title: 'The Cedar Nest, Manali',
    rawDescription: `2BHK cottage close to the Van Vihar deer park, walkable to Mall Road but genuinely quiet once you're inside the gate. Fireplace, geyser, small kitchen garden the caretaker maintains. We don't currently host pets — still figuring out the right setup for it.`,
    pricePerNight: 4600, bedrooms: 2, location: 'Manali, Himachal Pradesh', latitude: 32.2378, longitude: 77.1809,
  },
  {
    title: 'Sunrise Point Cottage, Manikaran',
    rawDescription: `2BHK cottage in Manikaran, known for its hot springs and gurudwara, about 3 hours from Manali but a common add-on stop for the same travelers. Sulphur hot spring access nearby.`,
    pricePerNight: 2800, bedrooms: 2, location: 'Manikaran, Himachal Pradesh', latitude: 31.9833, longitude: 77.3500,
  },
  {
    title: 'Tosh Valley Homestay',
    rawDescription: `Homestay at the end of the road in Tosh village, popular with the same backpacker circuit as Kasol. One room, shared bathroom, home-cooked meals only. Dogs are genuinely welcome, most of the village has one wandering around anyway.`,
    pricePerNight: 1300, bedrooms: 0, location: 'Tosh, Himachal Pradesh', latitude: 32.0500, longitude: 77.3833,
  },
  {
    title: 'The Timberline, Manali',
    rawDescription: `3BHK log house 5km from town, timber construction throughout, large stone fireplace in the living room. Given the amount of wood detailing and the fireplace, we ask guests not to bring pets.`,
    pricePerNight: 6100, bedrooms: 3, location: 'Manali, Himachal Pradesh', latitude: 32.2612, longitude: 77.1622,
  },
  {
    title: 'Aut Riverside Cottage',
    rawDescription: `2BHK cottage in Aut, at the gateway to the valley, river on one side and the highway a short walk away. Convenient for a first or last night if you're driving up from Chandigarh.`,
    pricePerNight: 2350, bedrooms: 2, location: 'Aut, Himachal Pradesh', latitude: 31.8797, longitude: 77.1183,
  },
  {
    title: 'The Meadow House, Manali',
    rawDescription: `4BHK house facing an open meadow just outside town, popular for family reunions. Large lawn, bonfire pit, parking for 3 cars. We're happy to host pets — just ask that you keep them off the lawn furniture.`,
    pricePerNight: 7400, bedrooms: 4, location: 'Manali, Himachal Pradesh', latitude: 32.2544, longitude: 77.1611,
  },
  {
    title: 'Simple Room, Aleo',
    rawDescription: `Fan-cooled single room in Aleo village near Vashisht, shared bathroom, basic but clean.`,
    pricePerNight: 1100, bedrooms: 0, location: 'Aleo, Manali, Himachal Pradesh', latitude: 32.2622, longitude: 77.2011,
  },
  {
    title: 'Shuru Village Cottage',
    rawDescription: `2BHK stone cottage in Shuru, near the Green Tax Barrier entering Manali. Mountain views from both bedrooms, bukhari heating, geyser in the attached bath. Pet policy is case-by-case — message us before booking if you're traveling with one.`,
    pricePerNight: 3300, bedrooms: 2, location: 'Shuru, Manali, Himachal Pradesh', latitude: 32.2489, longitude: 77.1756,
  },
  {
    title: 'The Highland Suite, Manali',
    rawDescription: `1BHK suite with a private balcony, 2km from Mall Road, complimentary breakfast and room heater included. No extra charges here — the rate is genuinely all-inclusive.`,
    pricePerNight: 2900, bedrooms: 1, location: 'Manali, Himachal Pradesh', latitude: 32.2455, longitude: 77.1867,
  },
  {
    title: 'Sethan Ridge Homestay',
    rawDescription: `Family-run homestay above Sethan village, popular base for the Sethan trek in winter. Basic rooms, hearty meals, bukhari in the common area. Two resident dogs, guests' dogs generally welcome if they're comfortable around other animals.`,
    pricePerNight: 2100, bedrooms: 1, location: 'Sethan, Manali, Himachal Pradesh', latitude: 32.2789, longitude: 77.1567,
  },
  {
    title: 'The Glasshouse, Manali',
    rawDescription: `2BHK modern build with a glass-fronted living room facing the valley, 4km from town. Central heating, contemporary interiors. Given the amount of glass, this one isn't set up for pets.`,
    pricePerNight: 5800, bedrooms: 2, location: 'Manali, Himachal Pradesh', latitude: 32.2367, longitude: 77.1734,
  },
];

export const goaListings: SeedListing[] = [
  {
    title: 'Casa Vermelho, 4BHK Portuguese Villa',
    rawDescription: `A 90-year-old Portuguese-style villa in Candolim, restored keeping the original azulejo tiles and high ceilings. 4BHK, all en-suite, private pool, 5-minute walkway to Candolim beach. Staffed with a caretaker who lives on-site. Given the age of the furnishings we're unable to host pets.`,
    pricePerNight: 14000, bedrooms: 4, location: 'Candolim, Goa', latitude: 15.5185, longitude: 73.7645,
  },
  {
    title: '2BHK Pool Villa, Assagao',
    rawDescription: `Quiet 2BHK with a private plunge pool, tucked into the paddy-field side of Assagao away from the main road noise. AC in both rooms, fully equipped kitchen, dedicated workspace. Dogs welcome, we just ask you rinse them off before the pool.`,
    pricePerNight: 6500, bedrooms: 2, location: 'Assagao, Goa', latitude: 15.5928, longitude: 73.7847,
  },
  {
    title: 'Beach Shack Room, Palolem',
    rawDescription: `Basic room, 400m from Palolem beach, fan-cooled, shared bathroom down the hall. This is a budget stay for people who'll be at the beach all day anyway. No pets, the property's small and shared with other guests.`,
    pricePerNight: 1200, bedrooms: 0, location: 'Palolem, Goa', latitude: 15.0100, longitude: 74.0233,
  },
  {
    title: 'Mandrem Riverside House',
    rawDescription: `Independent house on the Mandrem river side, sea-facing rooftop terrace, 10 minutes' walk to Mandrem beach. 3BHK, private pool, direct access to a small private jetty. We love hosting dogs, our own two are usually around the property too.`,
    pricePerNight: 9800, bedrooms: 3, location: 'Mandrem, Goa', latitude: 15.6667, longitude: 73.7167,
  },
  {
    title: 'Siolim Riverfront Villa',
    rawDescription: `4-bedroom wooden villa on the Chapora riverfront in Siolim, close to Vagator and Chapora Fort. Hydro pool, functional pantry, sit-out area shaded by coconut palms. Per building rules, pets aren't permitted on the property.`,
    pricePerNight: 11000, bedrooms: 4, location: 'Siolim, Goa', latitude: 15.6167, longitude: 73.7500,
  },
  {
    title: 'Studio Near Baga',
    rawDescription: `Small studio 800m from Baga beach, good for a short solo or couple's trip. AC, kitchenette, no pool but there's a shared rooftop with sunbeds.`,
    pricePerNight: 2200, bedrooms: 0, location: 'Baga, Goa', latitude: 15.5553, longitude: 73.7517,
  },
  {
    title: 'Casa Susegad, Vagator',
    rawDescription: `A genuinely susegad 2BHK off the Vagator cliff road, private garden with a hammock, shared pool within the gated community. 10-minute walk to Vagator beach and the Chapora Fort sunset point. There's a rinse tap out back for sandy paws and we keep a spare leash by the gate — the garden's fully enclosed, which is exactly why we like putting guests with dogs here.`,
    pricePerNight: 5400, bedrooms: 2, location: 'Vagator, Goa', latitude: 15.5983, longitude: 73.7379,
  },
  {
    title: '6BHK Family Mansion, Calangute',
    rawDescription: `Large group property 700m from Calangute beach, private pool, sleeps up to 14 across 6 bedrooms. Full staff including a cook available on request. No bachelor parties — a strict house rule. Well-behaved pets are fine, we've hosted plenty.`,
    pricePerNight: 22000, bedrooms: 6, location: 'Calangute, Goa', latitude: 15.5439, longitude: 73.7553,
  },
  {
    title: 'Casa Camotim, Siolim',
    rawDescription: `A small riverfront cottage on the Chapora, restored slowly over three years — original limewash walls left as they were, a single hammock strung on the veranda facing the water. No pool, no rooftop bar, just the tide coming in twice a day.`,
    pricePerNight: 5800, bedrooms: 1, location: 'Siolim, Goa', latitude: 15.6155, longitude: 73.7511,
  },
  {
    title: 'El Rosario, Nerul Garden Flat',
    rawDescription: `Ground-floor 2BHK in a gated community in Nerul, private garden with a hammock, access to a common pool. There's a well-known dog park just down the hill that half the neighborhood uses every morning, and a pet-supply shop two doors from the gate. Per the housing society's own rules, pets aren't permitted inside any unit on this property, no exceptions.`,
    pricePerNight: 4600, bedrooms: 2, location: 'Nerul, Goa', latitude: 15.5104, longitude: 73.8103,
  },
  {
    title: 'Floating Cabana, Chapora Backwater',
    rawDescription: `A small moored houseboat on a quiet backwater arm near Chapora, one bedroom, compact galley kitchen, deck that becomes the whole point of staying here. No direct sand access, and the boat does rock gently at night, which not everyone loves.`,
    pricePerNight: 6800, bedrooms: 1, location: 'Chapora, Goa', latitude: 15.6019, longitude: 73.7369,
  },
  {
    title: 'Casa D Umravi, Riverfront Terrace',
    rawDescription: `Independent 2BR house on the Chapora riverfront in Siolim, wide rooftop terrace where the water stretches out past the palm line as far as you can see. Hydro pool, functional pantry, quiet lane away from the main road.`,
    pricePerNight: 8200, bedrooms: 2, location: 'Siolim, Goa', latitude: 15.6172, longitude: 73.7515,
  },
  {
    title: 'Casa Do Sol, Anjuna',
    rawDescription: `2BHK Portuguese-era house in Anjuna, walking distance to the flea market grounds. Original terracotta floors, small private courtyard. Per the owner's own preference, this property doesn't accommodate pets.`,
    pricePerNight: 4800, bedrooms: 2, location: 'Anjuna, Goa', latitude: 15.5744, longitude: 73.7411,
  },
  {
    title: 'Studio Near Anjuna Flea Market',
    rawDescription: `Basic studio 600m from the Wednesday flea market grounds in Anjuna. AC, kitchenette, nothing more.`,
    pricePerNight: 1900, bedrooms: 0, location: 'Anjuna, Goa', latitude: 15.5769, longitude: 73.7398,
  },
  {
    title: 'The Palm Court, Morjim',
    rawDescription: `3BR villa 300m from Morjim beach, private pool, coconut grove on three sides. We keep a couple of dog beds on the veranda and a rinse station by the pool gate — a lot of our regulars travel with dogs and it's second nature to us here.`,
    pricePerNight: 9500, bedrooms: 3, location: 'Morjim, Goa', latitude: 15.6269, longitude: 73.7358,
  },
  {
    title: 'Budget Room, Colva',
    rawDescription: `Simple fan-cooled room 10 minutes' walk from Colva beach, shared bathroom down the hall.`,
    pricePerNight: 1100, bedrooms: 0, location: 'Colva, Goa', latitude: 15.2793, longitude: 73.9169,
  },
  {
    title: 'Villa Palolem Heritage',
    rawDescription: `A newly restored 2-bedroom heritage villa in Palolem, private pool, crafted for guests who appreciate quiet over nightlife. Given the age and delicacy of the original furnishings, pets aren't accommodated here.`,
    pricePerNight: 12000, bedrooms: 2, location: 'Palolem, Goa', latitude: 15.0100, longitude: 74.0233,
  },
  {
    title: 'Baga Beach Bungalow',
    rawDescription: `2BR bungalow 5 minutes' walk from Baga beach and Tito's Lane. AC in both rooms, shared pool with the neighboring property. Right in the nightlife strip — good for people who want to be in the thick of it.`,
    pricePerNight: 5600, bedrooms: 2, location: 'Baga, Goa', latitude: 15.5553, longitude: 73.7517,
  },
  {
    title: 'The Coconut House, Assagao',
    rawDescription: `1BHK cottage in a coconut grove just off the main Assagao road, quiet even by Assagao standards. Fully equipped kitchen, dedicated workspace corner. We're dog people ourselves and the whole compound is fenced — bring yours along.`,
    pricePerNight: 3800, bedrooms: 1, location: 'Assagao, Goa', latitude: 15.5901, longitude: 73.7823,
  },
  {
    title: 'Riverside Studio, Chapora',
    rawDescription: `Small studio overlooking the Chapora river, close to the fort walk. Basic kitchen, fan-cooled. Genuinely peaceful in the evenings once the day-trippers clear out.`,
    pricePerNight: 1750, bedrooms: 0, location: 'Chapora, Goa', latitude: 15.6011, longitude: 73.7381,
  },
  {
    title: 'Fontainhas Heritage Flat',
    rawDescription: `1BHK in the Latin Quarter of Fontainhas, original azulejo tiles, high ceilings, a five-minute walk to the Mandovi riverfront. The residents' association here prohibits pets entirely, no exceptions.`,
    pricePerNight: 4200, bedrooms: 1, location: 'Fontainhas, Panjim, Goa', latitude: 15.4989, longitude: 73.8278,
  },
  {
    title: 'Cavelossim Beach Bungalow',
    rawDescription: `2BR bungalow less than 500 steps from Cavelossim beach in South Goa, shared pool. No bachelor parties — a strict house rule enforced without exception. Well-behaved pets welcome.`,
    pricePerNight: 6800, bedrooms: 2, location: 'Cavelossim, Goa', latitude: 15.1667, longitude: 73.9500,
  },
  {
    title: 'Arpora Garden Villa',
    rawDescription: `3BHK villa in Arpora, close to the Saturday Night Market, private garden and plunge pool. Given the amount of glasswork and outdoor furniture around the pool, this one isn't set up for pets.`,
    pricePerNight: 8200, bedrooms: 3, location: 'Arpora, Goa', latitude: 15.5697, longitude: 73.7639,
  },
  {
    title: 'Betalbatim Beach House',
    rawDescription: `2BR house 200m from the quieter Betalbatim beach, shared pool, coconut grove backdrop. We keep a spare leash by the gate for guests traveling with dogs — the garden's enclosed and it's genuinely one of the calmer stretches of coast in Goa.`,
    pricePerNight: 5900, bedrooms: 2, location: 'Betalbatim, Goa', latitude: 15.2500, longitude: 73.9167,
  },
  {
    title: 'Casa Bela, Siolim',
    rawDescription: `2BHK Portuguese-style house in Siolim, quiet lane away from the main road, private courtyard with a mango tree. Genuinely peaceful compared to the busier North Goa strip.`,
    pricePerNight: 3900, bedrooms: 2, location: 'Siolim, Goa', latitude: 15.6144, longitude: 73.7489,
  },
  {
    title: 'Beach Hut, Agonda',
    rawDescription: `Basic beach hut in Agonda, 200m from the sand, fan-cooled, shared bathroom block. The actual budget beach-shack experience, not a villa dressed up as one.`,
    pricePerNight: 950, bedrooms: 0, location: 'Agonda, Goa', latitude: 15.0431, longitude: 73.9931,
  },
  {
    title: 'The Riverhouse, Divar Island',
    rawDescription: `2BR house on Divar Island, reachable only by a short ferry from Old Goa — genuinely off the usual circuit. Riverfront, mango orchard, and a stillness most of Goa's coast doesn't have anymore. We're dog people, always have been, garden's fully fenced.`,
    pricePerNight: 4700, bedrooms: 2, location: 'Divar Island, Goa', latitude: 15.5147, longitude: 73.8875,
  },
  {
    title: 'Candolim Garden Flat',
    rawDescription: `1BHK flat set back from the main Candolim strip, private garden, 10-minute walk to the beach. Given the small size of the property and shared garden with another unit, pets aren't accommodated here.`,
    pricePerNight: 3600, bedrooms: 1, location: 'Candolim, Goa', latitude: 15.5156, longitude: 73.7689,
  },
  {
    title: 'Studio Near Calangute Market',
    rawDescription: `Simple studio 500m from Calangute market, AC, small kitchenette. Functional base for exploring North Goa.`,
    pricePerNight: 1850, bedrooms: 0, location: 'Calangute, Goa', latitude: 15.5478, longitude: 73.7614,
  },
  {
    title: 'Villa Sonho, Nerul',
    rawDescription: `3BHK villa in Nerul, private pool, gated community with round-the-clock security. Given the shared community pool area, we ask pets stay on-leash within common spaces — otherwise welcome.`,
    pricePerNight: 8900, bedrooms: 3, location: 'Nerul, Goa', latitude: 15.5089, longitude: 73.8067,
  },
  {
    title: 'The Longshore House, Majorda',
    rawDescription: `2BR house 150m from Majorda beach, one of the quieter South Goa stretches. Shared pool, coconut-palm garden. No bachelor parties, house rule with no exceptions. Pet friendly, we keep water bowls out at the entrance year-round.`,
    pricePerNight: 6300, bedrooms: 2, location: 'Majorda, Goa', latitude: 15.3167, longitude: 73.9333,
  },
  {
    title: 'Panjim Latin Quarter Room',
    rawDescription: `Single room in a heritage building in Panjim's Latin Quarter, shared common areas, walkable to the Mandovi riverfront and the old churches. Given the shared nature of the building, pets aren't permitted.`,
    pricePerNight: 1650, bedrooms: 1, location: 'Panjim, Goa', latitude: 15.4909, longitude: 73.8278,
  },
  {
    title: 'Vagator Cliffside Cottage',
    rawDescription: `1BHK cottage on the Vagator cliff road, sea visible past the palm line from the small terrace. Basic kitchen, fan-cooled. One of the better-value options this close to the cliff beaches.`,
    pricePerNight: 2500, bedrooms: 1, location: 'Vagator, Goa', latitude: 15.5967, longitude: 73.7361,
  },
  {
    title: 'The Longhouse, Assagao',
    rawDescription: `4BHK converted farmhouse in Assagao, long single-storey layout typical of the older village houses here. Large shared kitchen, good for groups who want to cook together. We've hosted dogs plenty of times before, no issue.`,
    pricePerNight: 9800, bedrooms: 4, location: 'Assagao, Goa', latitude: 15.5878, longitude: 73.7801,
  },
  {
    title: 'Sernabatim Beach Cottage',
    rawDescription: `1BR cottage a short walk from Sernabatim beach near Colva, quieter than the main Colva strip. Fan-cooled, basic kitchen.`,
    pricePerNight: 2100, bedrooms: 1, location: 'Sernabatim, Goa', latitude: 15.2667, longitude: 73.9167,
  },
  {
    title: 'Casa Miramar, Dona Paula',
    rawDescription: `2BHK apartment in Dona Paula, sea visible from the balcony over the rooftops, close to the jetty. Modern building — given the strata rules, pets aren't allowed in this complex.`,
    pricePerNight: 4300, bedrooms: 2, location: 'Dona Paula, Goa', latitude: 15.4550, longitude: 73.8058,
  },
  {
    title: 'The Longshore Villa, Benaulim',
    rawDescription: `3BHK villa near Benaulim beach, private pool, staffed with a part-time caretaker who lives nearby. Family-friendly, well-behaved pets always welcome — we've got two of our own on the property most days.`,
    pricePerNight: 8600, bedrooms: 3, location: 'Benaulim, Goa', latitude: 15.2500, longitude: 73.9167,
  },
];

/**
 * Combined set with the authoritative `destination` slug attached to every row — exactly
 * what `seed-demo.ts` writes to `listings.destination`.
 */
export const demoListings: DemoSeedListing[] = [
  ...manaliListings.map((listing) => ({ ...listing, destination: 'manali' })),
  ...goaListings.map((listing) => ({ ...listing, destination: 'goa' })),
];
