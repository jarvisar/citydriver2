// The kinds of place a passenger might ask for, and the notebook that records
// the ones the driver has found. `label` is what the notebook calls a kind;
// `name` is only the fallback for a place with no name of its own.
export const CITY_PLACES = Object.freeze({
  clock: { name: 'Clocktower', label: 'Clocktower square', short: 'Clock tower & square', color: '#eac482', symbol: 'I', description: 'A tall clock tower over a paved square.' },
  market: { name: 'Market', label: 'Market hall', short: 'Market hall & stalls', color: '#ee9a78', symbol: 'II', description: 'A vaulted market hall, its stalls out on the paving in front.' },
  garden: { name: 'Gardens', label: 'Botanical garden', short: 'Glasshouse & flower beds', color: '#a7cfaa', symbol: 'III', description: 'A glasshouse in a paved circle, with flower beds along the walks.' },
  depot: { name: 'Tram Depot', label: 'Tram depot', short: 'Trams & workshops', color: '#8fbfce', symbol: 'IV', description: 'Sawtooth workshops, tracks out of their doors and a tram on the siding.' },
  art: { name: 'Sculpture Park', label: 'Sculpture garden', short: 'Sculptures & pools', color: '#c6ade0', symbol: 'V', description: 'A sculpture in a round pool, and smaller works along the walks.' },
  cinema: { name: 'Rivoli Cinema', label: 'Cinema', short: 'Films & matinees', color: '#ef997e', symbol: 'VI', description: 'A lit marquee, poster cases by the doors and a little ticket booth.' },
  hotel: { name: 'Grand Hotel', label: 'Hotel', short: 'Tower & terrace', color: '#e8c477', symbol: 'VII', description: 'A tall tower with a stepped copper crown, and cafe tables out front.' },
  museum: { name: 'City Museum', label: 'Museum', short: 'Art & architecture', color: '#e1b18b', symbol: 'VIII', description: 'A colonnaded hall under a copper dome, with sculptures on its lawns.' },
  station: { name: 'Union Station', label: 'Railway station', short: 'Trains & platforms', color: '#94c9c7', symbol: 'IX', description: 'A vaulted train shed with a clock, and a train waiting at the platform.' },
  library: { name: 'Central Library', label: 'Library', short: 'Books & reading garden', color: '#b5c798', symbol: 'X', description: 'A glass lantern on the roof, and a hedged reading garden in the grounds.' },
  hospital: { name: 'City Hospital', label: 'Hospital', short: 'Hospital & healing garden', color: '#a4d8d0', symbol: 'XI', description: 'A red cross over a sheltered entrance, and a quiet garden round a pool.' },
  observatory: { name: 'Star Observatory', label: 'Observatory', short: 'Planetarium & stargazing', color: '#a7b5e5', symbol: 'XII', description: 'A copper dome with its telescope out, in a garden laid out like a compass.' },
  music: { name: 'Blue Note Club', label: 'Jazz club', short: 'Live music', color: '#d5a3cb', symbol: 'XIII', description: 'Neon, a piano keyboard across the front and gig posters by the door.' },
  sports: { name: 'Athletic Club', label: 'Sports club', short: 'Courts & clubhouse', color: '#b9cf85', symbol: 'XIV', description: 'Tennis and basketball courts before a clubhouse, with stands either side.' },
  firehouse: { name: 'Engine House', label: 'Fire station', short: 'Historic fire station', color: '#e99883', symbol: 'XV', description: 'Red engine doors, a hose tower and a heritage fire engine.' },
  park: { name: 'Neighbourhood Gardens', label: 'Park', short: 'Lawns, walks & ponds', color: '#aac793', symbol: 'XVI', description: 'The city’s big green: long walks, lawns and groves, usually with a pond.' },
  plaza: { name: 'City Squares', label: 'Fountain square', short: 'Fountain & cafe tables', color: '#dfc6a0', symbol: 'XVII', description: 'A fountain in a paved square, with a cafe’s tables beside it.' },
  postoffice: { name: 'Central Post Office', label: 'Post office', short: 'Letters & parcels', color: '#e6b284', symbol: 'XVIII', description: 'An envelope crest, roof lights over the sorting hall and a pillar box out front.' },
  bathhouse: { name: 'Mosaic Baths', label: 'Public baths', short: 'Pools & tiled arcade', color: '#90c9c8', symbol: 'XIX', description: 'A terracotta vault behind a tiled arcade, and a pool terrace outside.' },
  farmersmarket: { name: 'Harvest Market', label: 'Farmers market', short: 'Stalls & bakery', color: '#dfc68a', symbol: 'XX', description: 'Rows of striped stalls, a bakery kiosk and its coffee tables.' },
  donut: { name: 'Lucky Donut', label: 'Doughnut shop', short: 'Doughnuts & coffee', color: '#e6a2b3', symbol: 'XXI', description: 'A giant doughnut on the roof of a pastel diner, and tables outside.' },
  cityhall: { name: 'City Hall', label: 'City Hall', short: 'Civic chambers & clock tower', color: '#d8c59d', symbol: 'XXII', description: 'Columns, ceremonial steps, a copper dome and clock tower, and fountains either side.' },
});
export const PLACE_TYPES = Object.keys(CITY_PLACES);
export const LANDMARK_TYPES = PLACE_TYPES.filter(type => type !== 'park' && type !== 'plaza');
// Each kind's variant names. A park or a square goes by its name here; a
// venue's variant picks its brand and its sign (see city-businesses.js), so
// its names here only count its variants.
export const SPACE_NAMES = Object.freeze({
  clock: ['Clocktower Square', 'Bell Court', 'Chime Terrace'], market: ['Market Hall', 'Covered Market', 'Traders Row'],
  garden: ['Botanical Garden', 'Glasshouse Walk', 'Rose Terrace'], depot: ['Tram Depot', 'Carriage Works', 'Rail Sheds'],
  art: ['Sculpture Park', 'Stone Garden', 'Bronze Court'], cinema: ['Art deco picturehouse', 'Neon marquee', 'Boutique screen'],
  hotel: ['Grand entrance', 'Garden terrace', 'Copper crown'], museum: ['Colonnade & forecourt', 'Sculpture court', 'Glass gallery'],
  station: ['Vaulted train shed', 'Station clock', 'Platform canopies'], library: ['Reading garden', 'Lantern hall', 'Quiet court'],
  hospital: ['Healing garden', 'Patient entrance', 'Pale wings'], observatory: ['Copper dome', 'Celestial garden', 'Telescope terrace'],
  music: ['Courtyard stage', 'Piano facade', 'Neon club'], sports: ['Clubhouse courts', 'Grandstand', 'Running track'],
  firehouse: ['Engine doors', 'Hose tower', 'Heritage engine'], park: ['Willow Green', 'Linden Gardens', 'Meadow Park', 'Orchard Walk'],
  plaza: ['Fountain Square', 'Market Square', 'Old Town Square', 'Station Square', 'Harbour Square', 'Jubilee Square'], postoffice: ['Sorting hall', 'Envelope crest', 'Parcel yard'],
  bathhouse: ['Tiled pavilions', 'Turquoise pools', 'Colonnaded terrace'], farmersmarket: ['Produce stalls', 'Flower stands', 'Coffee courtyard'],
  donut: ['Giant donut', 'Pastel diner', 'Coffee terrace'], cityhall: ['Civic chambers'],
});
// Where each kind of venue is at home: the districts that favour it
export const VENUE_DISTRICTS = {
  Midtown: ['hotel', 'cinema', 'museum', 'station', 'music', 'hospital'],
  'Old town': ['museum', 'market', 'bathhouse', 'donut', 'music', 'postoffice'],
  'Market district': ['market', 'donut', 'cinema', 'postoffice', 'firehouse', 'music', 'hotel'],
  'Civic quarter': ['library', 'museum', 'hospital', 'postoffice', 'firehouse', 'observatory', 'hotel'],
  'Garden quarter': ['observatory', 'sports', 'bathhouse', 'library', 'donut'],
  'Warehouse district': ['depot', 'station', 'market', 'firehouse', 'sports', 'music'],
};
// and the ones out of place in the quiet streets of the Garden quarter
export const NOT_IN_GARDENS = new Set(['music', 'hotel', 'cinema']);
