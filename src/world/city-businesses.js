import { CITY_PLACES, SPACE_NAMES } from './city-places.js';

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
