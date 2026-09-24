// The kinds of place a passenger might ask for, and the notebook that records
// the ones the driver has found.
export const CITY_PLACES = Object.freeze({
  clock: { name: 'Clocktower', short: 'Clocktower', color: '#eac482', symbol: 'I', description: 'Clocktower and fountains.' },
  market: { name: 'Market', short: 'Market hall', color: '#ee9a78', symbol: 'II', description: 'Market hall and stalls.' },
  garden: { name: 'Gardens', short: 'Botanical garden', color: '#a7cfaa', symbol: 'III', description: 'Glasshouse and gardens.' },
  depot: { name: 'Tram Depot', short: 'Tram depot', color: '#8fbfce', symbol: 'IV', description: 'Trams and workshops.' },
  art: { name: 'Sculpture Park', short: 'Sculpture garden', color: '#c6ade0', symbol: 'V', description: 'Sculptures and pools.' },
  cinema: { name: 'Rivoli Cinema', short: 'Movies & matinees', color: '#ef997e', symbol: 'VI', description: 'A glowing marquee, poster walls and a little ticket booth.' },
  hotel: { name: 'Grand Hotel', short: 'Hotel & roof terrace', color: '#e8c477', symbol: 'VII', description: 'A copper crown above a grand entrance and garden terrace.' },
  museum: { name: 'City Museum', short: 'Art & architecture', color: '#e1b18b', symbol: 'VIII', description: 'A colonnaded museum with a sculpture forecourt.' },
  station: { name: 'Union Station', short: 'Railway terminal', color: '#94c9c7', symbol: 'IX', description: 'A vaulted train shed, platforms and a station clock.' },
  library: { name: 'Central Library', short: 'Books & reading garden', color: '#b5c798', symbol: 'X', description: 'A lantern of glass above a quiet, planted reading court.' },
  hospital: { name: 'City Hospital', short: 'Hospital & healing garden', color: '#a4d8d0', symbol: 'XI', description: 'Pale wings, a red cross and a sheltered patient entrance.' },
  observatory: { name: 'Star Observatory', short: 'Planetarium & stargazing', color: '#a7b5e5', symbol: 'XII', description: 'A copper dome and telescope in a celestial garden.' },
  music: { name: 'Blue Note Club', short: 'Live music & courtyard', color: '#d5a3cb', symbol: 'XIII', description: 'A neon jazz club with a piano facade and courtyard stage.' },
  sports: { name: 'Athletic Club', short: 'Courts & clubhouse', color: '#b9cf85', symbol: 'XIV', description: 'Colorful courts, a grandstand and a neighborhood clubhouse.' },
  firehouse: { name: 'Engine House', short: 'Historic fire station', color: '#e99883', symbol: 'XV', description: 'Red engine doors, a hose tower and a heritage fire engine.' },
  park: { name: 'Neighborhood Gardens', short: 'Ponds, orchards & walks', color: '#aac793', symbol: 'XVI', description: 'A green retreat, with a different garden around each corner.' },
  plaza: { name: 'City Squares', short: 'Fountains & terraces', color: '#dfc6a0', symbol: 'XVII', description: 'Meet at a fountain, an outdoor cafe or a mosaic promenade.' },
  postoffice: { name: 'Central Post Office', short: 'Letters & parcels', color: '#e6b284', symbol: 'XVIII', description: 'A proud envelope crest, sorting-hall skylights and little postal vans.' },
  bathhouse: { name: 'Mosaic Baths', short: 'Pools & tiled pavilions', color: '#90c9c8', symbol: 'XIX', description: 'Terracotta vaults, turquoise pools and a quiet colonnaded terrace.' },
  farmersmarket: { name: 'Harvest Market', short: 'Farmers market & bakery', color: '#dfc68a', symbol: 'XX', description: 'Striped produce stalls, flower stands and a neighborhood bakery around a coffee courtyard.' },
  donut: { name: 'Lucky Donut', short: 'Donuts & fresh coffee', color: '#e6a2b3', symbol: 'XXI', description: 'A giant sprinkled donut crowns a pastel diner with display windows and a sunny coffee terrace.' },
  cityhall: { name: 'City Hall', short: 'Civic chambers & clocktower', color: '#d8c59d', symbol: 'XXII', description: 'The city’s one civic landmark: limestone columns, ceremonial steps and a copper clocktower.' },
});
export const PLACE_TYPES = Object.keys(CITY_PLACES);
export const LANDMARK_TYPES = PLACE_TYPES.filter(type => type !== 'park' && type !== 'plaza');
export const REPEATING_LANDMARK_TYPES = LANDMARK_TYPES.filter(type => type !== 'cityhall');
// Design names for the sign boards, three per venue and four per open space.
export const SPACE_NAMES = Object.freeze({
  clock: ['Clocktower Square', 'Bell Court', 'Chime Terrace'], market: ['Market Hall', 'Covered Market', 'Traders Row'],
  garden: ['Botanical Garden', 'Glasshouse Walk', 'Rose Terrace'], depot: ['Tram Depot', 'Carriage Works', 'Rail Sheds'],
  art: ['Sculpture Park', 'Stone Garden', 'Bronze Court'], cinema: ['Art deco picturehouse', 'Neon marquee', 'Boutique screen'],
  hotel: ['Grand entrance', 'Garden terrace', 'Copper crown'], museum: ['Colonnade & forecourt', 'Sculpture court', 'Glass gallery'],
  station: ['Vaulted train shed', 'Station clock', 'Platform canopies'], library: ['Reading garden', 'Lantern hall', 'Quiet court'],
  hospital: ['Healing garden', 'Patient entrance', 'Pale wings'], observatory: ['Copper dome', 'Celestial garden', 'Telescope terrace'],
  music: ['Courtyard stage', 'Piano facade', 'Neon club'], sports: ['Clubhouse courts', 'Grandstand', 'Running track'],
  firehouse: ['Engine doors', 'Hose tower', 'Heritage engine'], park: ['Willow Green', 'Linden Gardens', 'Meadow Park', 'Orchard Walk'],
  plaza: ['Fountain Square', 'Market Square', 'Old Town Square', 'Station Square'], postoffice: ['Sorting hall', 'Envelope crest', 'Parcel yard'],
  bathhouse: ['Tiled pavilions', 'Turquoise pools', 'Colonnaded terrace'], farmersmarket: ['Produce stalls', 'Flower stands', 'Coffee courtyard'],
  donut: ['Giant donut', 'Pastel diner', 'Coffee terrace'], cityhall: ['Civic chambers'],
});
// Where each kind of venue is at home: the districts that favour it
export const VENUE_DISTRICTS = {
  Midtown: ['hotel', 'cinema', 'museum', 'station', 'music', 'hospital'],
  'Old town': ['museum', 'market', 'bathhouse', 'donut', 'music', 'postoffice'],
  'Market district': ['market', 'donut', 'cinema', 'postoffice', 'firehouse'],
  'Civic quarter': ['library', 'museum', 'hospital', 'postoffice', 'firehouse', 'observatory'],
  'Garden quarter': ['observatory', 'sports', 'bathhouse', 'library', 'donut'],
  'Warehouse district': ['depot', 'station', 'market', 'firehouse', 'sports'],
};
