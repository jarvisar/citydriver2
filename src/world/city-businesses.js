import { CITY_PLACES, SPACE_NAMES } from './city-places.js';

// Fixed catalogs keep names reproducible and texture memory bounded as the city streams.
export const SHOP_BRANDS = {
  CAFE: [
    'Little Steam', 'Daybreak Coffee',
    'The Daily Grind', 'Sidecar Cafe',
    'Cloud Nine', 'Night Owl Coffee',
    'Copper Kettle', 'The Quiet Cup',
    'Morrow Coffee', 'Platform Espresso',
    'Sunday People', 'Pocket Coffee',
  ],
  DELI: [
    'Pickle & Rye', 'Corner Provisions',
    'The Lunch Counter', 'Good Company',
    'Mustard Club', 'Breadline Deli',
    'The Stacked Deck', 'Olive & Fig',
    'Marmalade Lane', 'Salt & Picnic',
    'Two Slices', 'Lunchbox Social',
  ],
  BOOKS: [
    'Dog-Eared Books', 'Chapter House',
    'The Reading Room', 'Paper Moon',
    'Plot Twist', 'Margin Notes',
    'Fox & Fable', 'The Last Page',
    'Book Nook', 'Spine & Leaf',
    'Paperback Parade', 'Once Upon a Shelf',
  ],
  RECORDS: [
    'Second Spin', 'Needle & Groove',
    'B-Side Records', 'After Hours',
    'Velvet Vinyl', 'Crate Expectations',
    'Static Bloom', 'RPM Social',
    'Deep Cut Records', 'Wax Museum',
    'Offbeat', 'Golden Ear',
  ],
  BAKERY: [
    'Butter & Crumb', 'Early Bird Bakery',
    'Golden Hour', 'Rise & Shine',
    'Flour Power', 'The Rolling Scone',
    'Crust & Found', 'Honey Hearth',
    'Little Loaf', 'Proof Positive',
    'Sugar Window', 'Kneadful Things',
  ],
  FLOWERS: [
    'Wild Stem', 'Petal & Post',
    'The Flower Cart', 'Bloom Room',
    'Thistle & Fern', 'Bud & Breakfast',
    'Stem Society', 'Marigold Monday',
    'Posy Parade', 'The Secret Garden',
    'Violet Hour', 'Meadow & Moss',
  ],
  NOODLES: [
    'Lucky Bowl', 'Steam Kitchen',
    'Noodle Social', 'Red Lantern',
    'Long Story Noodles', 'Broth & Co',
    'Midnight Noodle', 'Dancing Chopsticks',
    'Bowl Season', 'Ginger House',
    'Happy Tangle', 'Cloud Kitchen',
  ],
  CYCLES: [
    'Spoke & Wheel', 'Freewheel',
    'The Cycle Works', 'Pedal People',
    'Chain Reaction', 'The Handle Bar',
    'Little Gear', 'Coast Cycles',
    'Bell & Basket', 'Round Trip',
    'Uphill Club', 'Slow Lane Cycles',
  ],
  GROCER: [
    'Green Basket', 'Pantry & Pick',
    'Everyday Market', 'Good Harvest',
    'Peas & Thank You', 'The Useful Onion',
    'Apple a Day', 'Market Sparrow',
    'Root & Branch', 'Full Cupboard',
    'Neighbor Goods', 'Orchard Pantry',
  ],
  STUDIO: [
    'Studio North', 'Ink & Clay',
    'Small Works', 'Made Here',
    'Oddly Enough', 'The Print Room',
    'Soft Geometry', 'Kilnfolk',
    'Pencil Club', 'Bright Objects',
    'Thread & Wonder', 'Open Hands',
  ],
};

// Display name and short building lettering. No advertising copy.

export const VENUE_BRANDS = {
  cinema: [['Rivoli Cinema', 'RIVOLI'], ['Apollo Picturehouse', 'APOLLO'], ['Bijou Cinema', 'BIJOU']],
  hotel: [['Grand Hotel', 'GRAND HOTEL'], ['Hotel Marigold', 'MARIGOLD'], ['The Wayfarer Hotel', 'WAYFARER']],
  museum: [['City Museum', 'CITY MUSEUM'], ['Meridian Museum', 'MERIDIAN'], ['The Curiosity Museum', 'CURIOSITY']],
  station: [['Union Station', 'UNION'], ['Northstar Station', 'NORTHSTAR'], ['Junction Station', 'JUNCTION']],
  library: [['Central Library', 'CENTRAL LIBRARY'], ['Lantern Library', 'LANTERN LIBRARY'], ['Maple Library', 'MAPLE LIBRARY']],
  hospital: [['City Hospital', 'CITY HOSPITAL'], ['Mercy Hospital', 'MERCY HOSPITAL'], ['Greenway Hospital', 'GREENWAY']],
  observatory: [['Star Observatory', 'PLANETARIUM'], ['Orion Observatory', 'ORION'], ['Moonrise Observatory', 'MOONRISE']],
  music: [['Blue Note Club', 'BLUE NOTE'], ['The Brass Finch', 'BRASS FINCH'], ['Velvet Echo', 'VELVET ECHO']],
  sports: [['Athletic Club', 'ATHLETIC CLUB'], ['Rally Sports Club', 'RALLY CLUB'], ['Green Court Club', 'GREEN COURT']],
  firehouse: [['Engine House', 'FIRE STATION'], ['Foundry Firehouse', 'FOUNDRY'], ['Beacon Fire Station', 'BEACON']],
  postoffice: [['Central Post Office', 'POST OFFICE'], ['Penny Post', 'PENNY POST'], ['Parcel House', 'PARCEL HOUSE']],
  bathhouse: [['Mosaic Baths', 'MOSAIC BATHS'], ['Stillwater Baths', 'STILLWATER'], ['Juniper Springs', 'JUNIPER SPRINGS']],
  farmersmarket: [['Harvest Market', 'HARVEST MARKET'], ['Sunpatch Market', 'SUNPATCH MARKET'], ['The Gather Market', 'GATHER MARKET']],
  donut: [['Lucky Donut', 'LUCKY DONUT'], ['Glaze Days', 'GLAZE DAYS'], ['Dough Si Dough', 'DOUGH SI DOUGH']],
};
export function venueBrand(type, variant) {
  const brand = VENUE_BRANDS[type]?.[variant];
  return brand ? { name: brand[0], lettering: brand[1] } : null;
}
// What a place is called, on its sign and to a passenger: a venue by its
// brand, City Hall as City Hall, and anywhere else by its own name (Bell
// Court, a clocktower square; Carriage Works, a tram depot)
export function placeName(type, variant) {
  return venueBrand(type, variant)?.name ?? (type === 'cityhall' ? CITY_PLACES.cityhall.name : SPACE_NAMES[type]?.[variant] ?? CITY_PLACES[type].name);
}
