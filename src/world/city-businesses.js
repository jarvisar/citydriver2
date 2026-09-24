import { CITY_PLACES, SPACE_NAMES } from './city-places.js';

// Fixed catalogs keep names reproducible and texture memory bounded as the city streams.
export const SHOP_BRANDS = {
  CAFE: [
    ['Little Steam', 'Coffee & conversation'], ['Daybreak Coffee', 'Start on the bright side'],
    ['The Daily Grind', 'A good day, ground fresh'], ['Sidecar Cafe', 'Your usual, with a twist'],
    ['Cloud Nine', 'Espresso above the ordinary'], ['Night Owl Coffee', 'One more cup of possibility'],
    ['Copper Kettle', 'Take a moment, take a sip'], ['The Quiet Cup', 'A small pause in the city'],
    ['Morrow Coffee', 'Tomorrow can wait'], ['Platform Espresso', 'Worth missing your train'],
    ['Sunday People', 'Every day feels like Sunday'], ['Pocket Coffee', 'Small space, strong coffee'],
  ],
  DELI: [
    ['Pickle & Rye', 'Stacked with good intentions'], ['Corner Provisions', 'Lunch lives here'],
    ['The Lunch Counter', 'Pull up a stool'], ['Good Company', 'Better together, better on bread'],
    ['Mustard Club', 'Membership comes with pickles'], ['Breadline Deli', 'A little lunch goes a long way'],
    ['The Stacked Deck', 'All the odds on rye'], ['Olive & Fig', 'A taste of somewhere sunny'],
    ['Marmalade Lane', 'Something good for the road'], ['Salt & Picnic', 'Pack a better afternoon'],
    ['Two Slices', 'Everything good in between'], ['Lunchbox Social', 'Meet in the middle'],
  ],
  BOOKS: [
    ['Dog-Eared Books', 'Good stories deserve another read'], ['Chapter House', 'Make yourself a story'],
    ['The Reading Room', 'Your next world awaits'], ['Paper Moon', 'Fiction, fact & flights of fancy'],
    ['Plot Twist', 'Expect the unexpected'], ['Margin Notes', 'Books with room for thought'],
    ['Fox & Fable', 'Follow a good story'], ['The Last Page', 'Stay for one more chapter'],
    ['Book Nook', 'Little shop, wide worlds'], ['Spine & Leaf', 'Rooted in good reading'],
    ['Paperback Parade', 'A thousand lives on the shelf'], ['Once Upon a Shelf', 'Begin anywhere'],
  ],
  RECORDS: [
    ['Second Spin', 'Old records, new favorites'], ['Needle & Groove', 'Find your frequency'],
    ['B-Side Records', 'The other side sounds better'], ['After Hours', 'Keep the city spinning'],
    ['Velvet Vinyl', 'Warm sound, deep cuts'], ['Crate Expectations', 'Dig a little deeper'],
    ['Static Bloom', 'Beautiful noise starts here'], ['RPM Social', 'Good company at 33'],
    ['Deep Cut Records', 'Beyond the greatest hits'], ['Wax Museum', 'History you can listen to'],
    ['Offbeat', 'For a different kind of rhythm'], ['Golden Ear', 'Listen for something good'],
  ],
  BAKERY: [
    ['Butter & Crumb', 'Baked this morning'], ['Early Bird Bakery', 'The first loaf is yours'],
    ['Golden Hour', 'A little sunshine in every crust'], ['Rise & Shine', 'Good things take dough'],
    ['Flour Power', 'Peace, love & sourdough'], ['The Rolling Scone', 'A very good reason to stop'],
    ['Crust & Found', 'Find your daily bread'], ['Honey Hearth', 'Warm from our oven'],
    ['Little Loaf', 'Small batches, happy mornings'], ['Proof Positive', 'Patience makes better bread'],
    ['Sugar Window', 'A sweet spot on your street'], ['Kneadful Things', 'The essentials, freshly baked'],
  ],
  FLOWERS: [
    ['Wild Stem', 'A little less ordinary'], ['Petal & Post', 'Send something lovely'],
    ['The Flower Cart', 'Take the long way home'], ['Bloom Room', 'Make room for color'],
    ['Thistle & Fern', 'A wonderfully wild bunch'], ['Bud & Breakfast', 'Fresh flowers, early doors'],
    ['Stem Society', 'Good things grow together'], ['Marigold Monday', 'Brighten an ordinary day'],
    ['Posy Parade', 'Big feelings, little bouquets'], ['The Secret Garden', 'Something lovely is growing'],
    ['Violet Hour', 'Flowers for the in-between'], ['Meadow & Moss', 'A little outdoors, indoors'],
  ],
  NOODLES: [
    ['Lucky Bowl', 'Good fortune by the spoonful'], ['Steam Kitchen', 'Follow the delicious cloud'],
    ['Noodle Social', 'Gather round a good bowl'], ['Red Lantern', 'A warm welcome after dark'],
    ['Long Story Noodles', 'Slurp happily ever after'], ['Broth & Co', 'Slow simmer, quick lunch'],
    ['Midnight Noodle', 'Late nights, full bowls'], ['Dancing Chopsticks', 'Pick up something good'],
    ['Bowl Season', 'Always the right weather'], ['Ginger House', 'A little warmth goes a long way'],
    ['Happy Tangle', 'Get pleasantly mixed up'], ['Cloud Kitchen', 'Fresh noodles, rising steam'],
  ],
  CYCLES: [
    ['Spoke & Wheel', 'Keep the good times rolling'], ['Freewheel', 'Take your own route'],
    ['The Cycle Works', 'Repairs for the road ahead'], ['Pedal People', 'Two wheels, one good city'],
    ['Chain Reaction', 'Start something moving'], ['The Handle Bar', 'Your neighborhood bike stop'],
    ['Little Gear', 'Big rides begin here'], ['Coast Cycles', 'Enjoy the downhill bits'],
    ['Bell & Basket', 'Everyday adventures equipped'], ['Round Trip', 'Out there and back again'],
    ['Uphill Club', 'The view is worth it'], ['Slow Lane Cycles', 'See more of the journey'],
  ],
  GROCER: [
    ['Green Basket', 'Your daily dose of fresh'], ['Pantry & Pick', 'Good things for your shelves'],
    ['Everyday Market', 'Make tonight delicious'], ['Good Harvest', 'Fresh from near and far'],
    ['Peas & Thank You', 'A friendly sort of grocer'], ['The Useful Onion', 'Great dinners start small'],
    ['Apple a Day', 'Fresh picks for your kitchen'], ['Market Sparrow', 'A little of everything good'],
    ['Root & Branch', 'Produce with a sense of place'], ['Full Cupboard', 'Come in with a shopping list'],
    ['Neighbor Goods', 'Around the corner, on your table'], ['Orchard Pantry', 'Bring the season home'],
  ],
  STUDIO: [
    ['Studio North', 'Follow a new direction'], ['Ink & Clay', 'Make a little mess'],
    ['Small Works', 'Big ideas, made by hand'], ['Made Here', 'Local hands, lovely things'],
    ['Oddly Enough', 'Art for curious people'], ['The Print Room', 'Make a lasting impression'],
    ['Soft Geometry', 'A different shape of things'], ['Kilnfolk', 'Clay, company & possibility'],
    ['Pencil Club', 'Draw your own conclusions'], ['Bright Objects', 'Small things with big character'],
    ['Thread & Wonder', 'Something good is taking shape'], ['Open Hands', 'Come with an idea'],
  ],
};

// Display name, building lettering, and a distinct invitation for each layout.
export const VENUE_BRANDS = {
  cinema: [['Rivoli Cinema', 'RIVOLI', 'Great stories after dark'], ['Apollo Picturehouse', 'APOLLO', 'Tonight belongs to the big screen'], ['Bijou Cinema', 'BIJOU', 'A little movie magic']],
  hotel: [['Grand Hotel', 'GRAND HOTEL', 'Stay a little longer'], ['Hotel Marigold', 'MARIGOLD', 'Your room in the city'], ['The Wayfarer Hotel', 'WAYFARER', 'Arrive curious, leave rested']],
  museum: [['City Museum', 'CITY MUSEUM', 'A city of stories'], ['Meridian Museum', 'MERIDIAN', 'See the world a little differently'], ['The Curiosity Museum', 'CURIOSITY', 'There is always more to discover']],
  station: [['Union Station', 'UNION', 'Your next chapter'], ['Northstar Station', 'NORTHSTAR', 'All aboard for somewhere new'], ['Junction Station', 'JUNCTION', 'Where journeys come together']],
  library: [['Central Library', 'CENTRAL LIBRARY', 'Get lost in a book'], ['Lantern Library', 'LANTERN LIBRARY', 'A light for curious minds'], ['Maple Library', 'MAPLE LIBRARY', 'Borrow a little adventure']],
  hospital: [['City Hospital', 'CITY HOSPITAL', 'Care close to home'], ['Mercy Hospital', 'MERCY HOSPITAL', 'Here when you need us'], ['Greenway Hospital', 'GREENWAY', 'Room to rest and recover']],
  observatory: [['Star Observatory', 'PLANETARIUM', 'Look up tonight'], ['Orion Observatory', 'ORION', 'A whole universe overhead'], ['Moonrise Observatory', 'MOONRISE', 'The night has a story']],
  music: [['Blue Note Club', 'BLUE NOTE', 'Follow the music'], ['The Brass Finch', 'BRASS FINCH', 'Good nights start on a high note'], ['Velvet Echo', 'VELVET ECHO', 'Stay for the encore']],
  sports: [['Athletic Club', 'ATHLETIC CLUB', 'Come out & play'], ['Rally Sports Club', 'RALLY CLUB', 'Your next great match'], ['Green Court Club', 'GREEN COURT', 'A little friendly competition']],
  firehouse: [['Engine House', 'FIRE STATION', 'Neighborhood heroes'], ['Foundry Firehouse', 'FOUNDRY', 'Ready when the bell rings'], ['Beacon Fire Station', 'BEACON', 'A watchful light in the city']],
  postoffice: [['Central Post Office', 'POST OFFICE', 'Signed, sealed, delivered'], ['Penny Post', 'PENNY POST', 'Small letters, long journeys'], ['Parcel House', 'PARCEL HOUSE', 'Send a little something']],
  bathhouse: [['Mosaic Baths', 'MOSAIC BATHS', 'Soak up the quiet'], ['Stillwater Baths', 'STILLWATER', 'Let the city drift away'], ['Juniper Springs', 'JUNIPER SPRINGS', 'A softer pace of life']],
  farmersmarket: [['Harvest Market', 'HARVEST MARKET', 'Fresh from the growers'], ['Sunpatch Market', 'SUNPATCH MARKET', 'Meet your next favorite flavor'], ['The Gather Market', 'GATHER MARKET', 'Good things come together']],
  donut: [['Lucky Donut', 'LUCKY DONUT', 'A little ring of joy'], ['Glaze Days', 'GLAZE DAYS', 'Make today a little sweeter'], ['Dough Si Dough', 'DOUGH SI DOUGH', 'Take another turn around']],
};
export function venueBrand(type, variant) {
  const brand = VENUE_BRANDS[type]?.[variant];
  return brand ? { name: brand[0], lettering: brand[1], slogan: brand[2] } : null;
}
// What a place is called, on its sign and to a passenger: a venue by its
// brand, City Hall as City Hall, and anywhere else by its own name (Bell
// Court, a clocktower square; Carriage Works, a tram depot)
export function placeName(type, variant) {
  return venueBrand(type, variant)?.name ?? (type === 'cityhall' ? CITY_PLACES.cityhall.name : SPACE_NAMES[type]?.[variant] ?? CITY_PLACES[type].name);
}
