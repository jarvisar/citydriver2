// One deliberately chosen face per SHOP_BRANDS entry, in the same order.
// Names have their own lettering; useful trade labels are quiet and optional.
const serif = { font: 'Georgia, serif', weight: 'normal' };
const italic = { font: 'Georgia, serif', weight: 'italic' };
const mono = { font: 'monospace', weight: 'bold' };
const palette = {
  coffee: ['#423329', '#f1e6ce', '#ba9061'],
  milk: ['#eee5d0', '#443b31', '#9e704b'],
  night: ['#293b40', '#eee8d5', '#b1b99a'],
  sky: ['#d7e1df', '#354b54', '#718c96'],
  deli: ['#345549', '#f0e8d1', '#b8bd8c'],
  mustard: ['#d4ad53', '#35372c', '#70653a'],
  wine: ['#653d43', '#efe4ce', '#bf9d83'],
  navy: ['#354653', '#ede4cd', '#a7afa4'],
  paper: ['#e9e3d5', '#3e4540', '#7b876b'],
  vinyl: ['#303135', '#eae6d7', '#c7aa66'],
  blue: ['#496176', '#f0eade', '#a8b5ba'],
  clay: ['#a45e46', '#f3e6cd', '#d2b98d'],
  bread: ['#ebd5a8', '#614435', '#a06f48'],
  green: ['#425647', '#ede6d5', '#b5b78e'],
  floral: ['#e4dfce', '#52604a', '#aa917d'],
  red: ['#934437', '#f1e6d0', '#cdb17b'],
  enamel: ['#e8e4d6', '#884639', '#b39c78'],
  workshop: ['#344b5b', '#ede8da', '#c2ad70'],
  produce: ['#526143', '#eee7d0', '#c5b776'],
  studio: ['#e9e6df', '#3c4447', '#9a7964'],
  rose: ['#c7aaa0', '#423c3b', '#795d54'],
};
const face = (shopType, shape, aspect, layout, colours, detail = {}) => ({
  shopType, shape, aspect, layout, font: 'sans-serif', weight: 'bold',
  background: colours[0], ink: colours[1], accent: colours[2], ...detail,
});

export const SHOP_SIGN_DESIGNS = {
  // Cafes range from a quiet tea room to compact espresso counters. A cup
  // or a name ending in Coffee already identifies the business's trade.
  CAFE: [
    face('', 'plaque', 3.7, 'split', palette.coffee, { ...serif, icon: 'cup', nameSize: .44 }), // Little Steam
    face('', 'rect', 3.3, 'left', palette.milk, { lines: ['Daybreak', 'Coffee'], lineScales: [1, .68], nameSize: .33 }), // Daybreak Coffee
    face('Coffee', 'plaque', 4.1, 'frame', palette.night, { ...serif, typeSize: .15, nameSize: .39 }), // The Daily Grind
    face('', 'clipped', 4.7, 'left', palette.red, { uppercase: true, nameSize: .43 }), // Sidecar Cafe
    face('Espresso', 'oval', 3.1, 'wordmark', palette.sky, { ...italic, nameSize: .43, typeSize: .15 }), // Cloud Nine
    face('', 'rect', 4.8, 'wordmark', palette.night, { nameSize: .43 }), // Night Owl Coffee
    face('Tea room', 'plaque', 4.5, 'wordmark', palette.bread, { ...serif, typePosition: 'side', typeSize: .17, nameSize: .39 }), // Copper Kettle
    face('Cafe', 'rect', 4.2, 'left', palette.paper, { ...serif, typePosition: 'above', typeSize: .14, nameSize: .40 }), // The Quiet Cup
    face('', 'rect', 4.9, 'wordmark', palette.coffee, { weight: 'normal', nameSize: .46 }), // Morrow Coffee
    face('', 'rect', 5.2, 'left', palette.navy, { ...mono, uppercase: true, nameSize: .41 }), // Platform Espresso
    face('Cafe', 'arch', 3.5, 'wordmark', palette.milk, { ...serif, nameSize: .40, typeSize: .16 }), // Sunday People
    face('', 'rect', 2.8, 'stacked', palette.clay, { lines: ['Pocket', 'Coffee'], lineScales: [1, .68], nameSize: .33 }), // Pocket Coffee
  ],
  // Delis mix broad counter fascias with compact independent shop boards;
  // the service sits beside, above or quietly below the individual name.
  DELI: [
    face('Delicatessen', 'rect', 4.4, 'wordmark', palette.deli, { ...serif, nameSize: .43, typeSize: .14 }), // Pickle & Rye
    face('Deli', 'rect', 5.3, 'left', palette.paper, { typePosition: 'side', nameSize: .39, typeSize: .18 }), // Corner Provisions
    face('', 'clipped', 5.0, 'wordmark', palette.enamel, { uppercase: true, nameSize: .41 }), // The Lunch Counter
    face('Deli', 'rect', 3.8, 'band', palette.wine, { nameSize: .43, typeSize: .17 }), // Good Company
    face('Sandwiches', 'rect', 3.0, 'stacked', palette.mustard, { lines: ['Mustard', 'Club'], typePosition: 'above', nameSize: .33, typeSize: .14 }), // Mustard Club
    face('', 'rect', 4.9, 'left', palette.deli, { nameSize: .44 }), // Breadline Deli
    face('Deli', 'plaque', 4.5, 'frame', palette.coffee, { ...serif, nameSize: .38, typeSize: .15 }), // The Stacked Deck
    face('Deli', 'oval', 3.2, 'wordmark', palette.floral, { ...italic, nameSize: .44, typeSize: .16 }), // Olive & Fig
    face('Delicatessen', 'rect', 4.5, 'wordmark', palette.milk, { ...italic, typePosition: 'above', nameSize: .41, typeSize: .14 }), // Marmalade Lane
    face('Sandwiches', 'rect', 5.0, 'left', palette.blue, { weight: 'normal', typePosition: 'side', nameSize: .43, typeSize: .15 }), // Salt & Picnic
    face('Sandwiches', 'rect', 3.1, 'left', palette.enamel, { lines: ['Two', 'Slices'], lineScales: [1, .88], nameSize: .32, typeSize: .15 }), // Two Slices
    face('Deli', 'rect', 3.3, 'stacked', palette.deli, { weight: 'normal', lines: ['Lunchbox', 'Social'], lineScales: [1, .78], nameSize: .32, typeSize: .15 }), // Lunchbox Social
  ],
  // Bookshop names carry the identity. Quiet trade labels sit beside or
  // above selected wordmarks; names that already say books need no repeat.
  BOOKS: [
    face('', 'rect', 5.0, 'wordmark', palette.wine, { ...serif, nameSize: .46 }), // Dog-Eared Books
    face('Bookshop', 'plaque', 3.1, 'frame', palette.navy, { ...serif, lines: ['Chapter', 'House'], nameSize: .32, typeSize: .15 }),
    face('Books', 'rect', 5.2, 'left', palette.paper, { ...serif, typePosition: 'side', nameSize: .42, typeSize: .17 }), // The Reading Room
    face('Books', 'oval', 3.3, 'wordmark', palette.milk, { ...italic, nameSize: .40, typeSize: .14 }), // Paper Moon
    face('Bookshop', 'rect', 2.9, 'stacked', palette.mustard, { lines: ['Plot', 'Twist'], typePosition: 'above', nameSize: .33, typeSize: .15, typeUppercase: true }),
    face('', 'rect', 4.0, 'split', palette.paper, { ...serif, weight: 'bold', icon: 'book', nameSize: .42 }), // Margin Notes
    face('Books', 'arch', 3.3, 'wordmark', palette.green, { ...serif, typePosition: 'above', nameSize: .38, typeSize: .15, typeUppercase: true }), // Fox & Fable
    face('Bookshop', 'rect', 4.2, 'frame', palette.coffee, { ...serif, nameSize: .42, typeSize: .14 }), // The Last Page
    face('', 'plaque', 2.5, 'stacked', palette.bread, { ...serif, weight: 'bold', lines: ['Book', 'Nook'], nameSize: .33 }),
    face('Bookshop', 'rect', 4.4, 'wordmark', palette.navy, { ...italic, typePosition: 'side', nameSize: .40, typeSize: .17 }), // Spine & Leaf
    face('', 'rect', 3.6, 'left', palette.enamel, { lines: ['Paperback', 'Parade'], lineScales: [1, .80], uppercase: true, nameSize: .33 }),
    face('', 'plaque', 3.5, 'split', palette.floral, { ...serif, icon: 'book', lines: ['Once Upon', 'a Shelf'], lineScales: [1, .75], nameSize: .32 }),
  ],
  // Record shops mix bold wordmarks, compact stacked names and a few
  // simple discs. The trade stays secondary when the name needs it.
  RECORDS: [
    face('', 'rect', 3.8, 'split', palette.vinyl, { icon: 'record', nameSize: .47 }), // Second Spin
    face('Records', 'rect', 5.6, 'left', palette.paper, { ...mono, typePosition: 'side', uppercase: true, nameSize: .40, typeSize: .16 }), // Needle & Groove
    face('', 'rect', 4.6, 'wordmark', palette.red, { nameSize: .44 }), // B-Side Records
    face('Records', 'rect', 2.7, 'stacked', palette.night, { weight: 'normal', lines: ['After', 'Hours'], lineScales: [1, .85], typePosition: 'above', nameSize: .32, typeSize: .15, typeUppercase: true }),
    face('', 'oval', 3.6, 'wordmark', palette.wine, { ...italic, nameSize: .42 }), // Velvet Vinyl
    face('Records', 'rect', 3.9, 'left', palette.bread, { ...mono, lines: ['Crate', 'Expectations'], lineScales: [1, .72], nameSize: .33, typeSize: .14 }),
    face('Records', 'rect', 3.7, 'band', palette.blue, { nameSize: .42, typeSize: .14 }), // Static Bloom
    face('', 'clipped', 3.7, 'split', palette.enamel, { icon: 'record', uppercase: true, nameSize: .43 }), // RPM Social
    face('', 'rect', 3.4, 'left', palette.vinyl, { ...mono, lines: ['Deep Cut', 'Records'], lineScales: [1, .70], uppercase: true, nameSize: .33 }),
    face('Record shop', 'rect', 4.0, 'wordmark', palette.mustard, { typePosition: 'above', uppercase: true, nameSize: .42, typeSize: .14 }), // Wax Museum
    face('', 'rect', 2.6, 'split', palette.paper, { icon: 'record', weight: 'normal', nameSize: .48 }), // Offbeat
    face('Records', 'plaque', 3.8, 'frame', palette.vinyl, { ...serif, nameSize: .43, typeSize: .15 }), // Golden Ear
  ],
  // Bakeries favour warm painted boards, with names set to suit each
  // frontage. Bread in a name needs no second label saying the same thing.
  BAKERY: [
    face('Bakery', 'rect', 4.6, 'wordmark', palette.bread, { ...serif, typePosition: 'above', nameSize: .43, typeSize: .14 }), // Butter & Crumb
    face('', 'rect', 3.5, 'left', palette.clay, { lines: ['Early Bird', 'Bakery'], lineScales: [1, .68], nameSize: .33 }), // Early Bird Bakery
    face('Bakery', 'arch', 3.4, 'wordmark', palette.milk, { ...serif, nameSize: .42, typeSize: .16 }), // Golden Hour
    face('Bakery', 'rect', 4.3, 'band', palette.red, { nameSize: .46, typeSize: .15 }), // Rise & Shine
    face('Bread', 'rect', 4.6, 'wordmark', palette.paper, { weight: 'normal', typePosition: 'side', nameSize: .45, typeSize: .17 }), // Flour Power
    face('', 'plaque', 4.8, 'frame', palette.coffee, { ...serif, nameSize: .40 }), // The Rolling Scone
    face('Bakery', 'rect', 4.5, 'left', palette.bread, { typePosition: 'above', typeUppercase: true, nameSize: .43, typeSize: .14 }), // Crust & Found
    face('Bakery', 'oval', 3.1, 'wordmark', palette.clay, { ...serif, nameSize: .43, typeSize: .16 }), // Honey Hearth
    face('', 'plaque', 2.8, 'wordmark', palette.milk, { ...italic, nameSize: .46 }), // Little Loaf
    face('Bread', 'rect', 4.8, 'left', palette.navy, { ...mono, typePosition: 'side', nameSize: .40, typeSize: .17 }), // Proof Positive
    face('Pastries', 'rect', 3.1, 'stacked', palette.rose, { ...serif, lines: ['Sugar', 'Window'], typePosition: 'above', nameSize: .33, typeSize: .14 }), // Sugar Window
    face('Bakery', 'rect', 4.9, 'wordmark', palette.green, { ...serif, nameSize: .41, typeSize: .14 }), // Kneadful Things
  ],
  // Florists use quiet nameplates, a few stacked names and one leaf mark.
  // Small trade labels clarify the more ambiguous business names.
  FLOWERS: [
    face('', 'rect', 4.1, 'split', palette.floral, { ...serif, icon: 'leaf', nameSize: .43 }), // Wild Stem
    face('Florist', 'plaque', 3.8, 'wordmark', palette.green, { ...serif, nameSize: .4, typeSize: .16 }), // Petal & Post
    face('', 'rect', 5.2, 'left', palette.paper, { weight: 'normal', nameSize: .45 }), // The Flower Cart
    face('Flowers', 'rect', 2.6, 'stacked', palette.rose, { weight: 'normal', lines: ['Bloom', 'Room'], nameSize: .34, typePosition: 'above', typeSize: .14 }), // Bloom Room
    face('Florist', 'rect', 5.1, 'left', palette.green, { ...serif, nameSize: .4, typePosition: 'side', typeSize: .18 }), // Thistle & Fern
    face('Florist', 'rect', 4.7, 'wordmark', palette.floral, { ...italic, nameSize: .4, typePosition: 'above', typeSize: .15 }), // Bud & Breakfast
    face('Flowers', 'rect', 3.0, 'stacked', palette.night, { weight: 'normal', lines: ['Stem', 'Society'], nameSize: .34, typeSize: .14 }), // Stem Society
    face('', 'plaque', 3.1, 'stacked', palette.bread, { ...serif, lines: ['Marigold', 'Monday'], lineScales: [1, .8], nameSize: .38 }), // Marigold Monday
    face('', 'rect', 4.3, 'left', palette.rose, { nameSize: .45 }), // Posy Parade
    face('Florist', 'arch', 3.3, 'frame', palette.green, { ...serif, lines: ['The Secret', 'Garden'], nameSize: .32, typePosition: 'above', typeSize: .14 }), // The Secret Garden
    face('Flowers', 'oval', 3.4, 'wordmark', palette.wine, { ...italic, nameSize: .4, typePosition: 'above', typeSize: .15 }), // Violet Hour
    face('Florist', 'rect', 5.3, 'wordmark', palette.floral, { ...serif, nameSize: .4, typePosition: 'side', typeSize: .17 }), // Meadow & Moss
  ],
  // Noodle counters share simple red, enamel and charcoal paint. Some
  // businesses use a bowl, others their own lettering, to explain the trade.
  NOODLES: [
    face('', 'rect', 3.4, 'split', palette.red, { icon: 'bowl', nameSize: .43 }), // Lucky Bowl
    face('Noodles', 'rect', 4.9, 'left', palette.vinyl, { typePosition: 'side', nameSize: .41, typeSize: .16 }), // Steam Kitchen
    face('', 'rect', 4.4, 'wordmark', palette.enamel, { weight: 'normal', nameSize: .45 }), // Noodle Social
    face('Noodle bar', 'clipped', 4.1, 'wordmark', palette.red, { ...serif, typePosition: 'above', nameSize: .42, typeSize: .14 }), // Red Lantern
    face('', 'rect', 3.6, 'stacked', palette.enamel, { lines: ['Long Story', 'Noodles'], lineScales: [1, .68], nameSize: .33 }), // Long Story Noodles
    face('Noodles', 'rect', 3.9, 'band', palette.night, { nameSize: .46, typeSize: .16 }), // Broth & Co
    face('', 'rect', 4.8, 'wordmark', palette.vinyl, { uppercase: true, nameSize: .43 }), // Midnight Noodle
    face('Noodles', 'rect', 3.2, 'left', palette.red, { lines: ['Dancing', 'Chopsticks'], nameSize: .32, typeSize: .14 }), // Dancing Chopsticks
    face('Noodles', 'rect', 3.8, 'wordmark', palette.milk, { typePosition: 'above', typeUppercase: true, nameSize: .44, typeSize: .14 }), // Bowl Season
    face('Noodles', 'plaque', 4.2, 'wordmark', palette.clay, { ...serif, nameSize: .42, typeSize: .16 }), // Ginger House
    face('Noodles', 'rect', 4.6, 'wordmark', palette.enamel, { typePosition: 'side', nameSize: .42, typeSize: .17 }), // Happy Tangle
    face('', 'rect', 3.4, 'split', palette.navy, { weight: 'normal', icon: 'bowl', lines: ['Cloud', 'Kitchen'], lineScales: [1, .8], nameSize: .33 }), // Cloud Kitchen
  ],
  // Workshop names lead broad fascias; repairs appear as a small service
  // line, while two bicycle marks let their shops dispense with trade copy.
  CYCLES: [
    face('Bicycles & repairs', 'rect', 5.3, 'left', palette.workshop, { uppercase: true, nameSize: .43, typePosition: 'side', typeSize: .15 }), // Spoke & Wheel
    face('', 'rect', 4.1, 'split', palette.paper, { icon: 'bicycle', nameSize: .46 }), // Freewheel
    face('', 'clipped', 3.7, 'stacked', palette.workshop, { ...mono, uppercase: true, lines: ['The Cycle', 'Works'], lineScales: [1, .85], nameSize: .38 }), // The Cycle Works
    face('Bicycles', 'rect', 4.3, 'left', palette.red, { nameSize: .42, typePosition: 'above', typeSize: .16 }), // Pedal People
    face('Cycle repairs', 'rect', 4.9, 'band', palette.vinyl, { ...mono, nameSize: .42, typeSize: .16 }), // Chain Reaction
    face('Bicycles', 'rect', 5.0, 'left', palette.enamel, { nameSize: .4, typePosition: 'side', typeSize: .18 }), // The Handle Bar
    face('Cycle repairs', 'rect', 2.9, 'stacked', palette.mustard, { ...mono, lines: ['Little', 'Gear'], nameSize: .34, typePosition: 'above', typeSize: .14 }), // Little Gear
    face('', 'rect', 4.9, 'wordmark', palette.blue, { weight: 'normal', nameSize: .46 }), // Coast Cycles
    face('Cycles', 'plaque', 3.9, 'frame', palette.green, { ...serif, nameSize: .4, typeSize: .16 }), // Bell & Basket
    face('', 'clipped', 4.3, 'split', palette.paper, { icon: 'bicycle', uppercase: true, nameSize: .43 }), // Round Trip
    face('Bicycles', 'rect', 3.2, 'stacked', palette.workshop, { uppercase: true, lines: ['Uphill', 'Club'], nameSize: .34, typeSize: .15 }), // Uphill Club
    face('', 'rect', 5.3, 'left', palette.green, { ...serif, nameSize: .44 }), // Slow Lane Cycles
  ],
  // Broad market fascias mix with modest neighbourhood produce boards.
  // Trade copy is a quiet qualifier, never a repeated headline.
  GROCER: [
    face('Greengrocer', 'rect', 4.6, 'left', palette.produce, { nameSize: .43, typePosition: 'above', typeSize: .15, typeUppercase: true }), // Green Basket
    face('Groceries', 'plaque', 4.0, 'frame', palette.paper, { ...serif, nameSize: .4, typeSize: .15 }), // Pantry & Pick
    face('', 'rect', 5.3, 'wordmark', palette.green, { uppercase: true, nameSize: .44 }), // Everyday Market
    face('Fruit & veg', 'rect', 4.4, 'band', palette.bread, { nameSize: .43, typeSize: .16 }), // Good Harvest
    face('Grocer', 'rect', 3.6, 'stacked', palette.produce, { lines: ['Peas &', 'Thank You'], nameSize: .33, typePosition: 'above', typeSize: .14 }), // Peas & Thank You
    face('Greengrocer', 'rect', 5.3, 'wordmark', palette.paper, { ...serif, nameSize: .4, typePosition: 'side', typeSize: .15 }), // The Useful Onion
    face('Fruit & veg', 'rect', 3.3, 'stacked', palette.red, { lines: ['Apple', 'a Day'], lineScales: [1, .75], nameSize: .35, typePosition: 'above', typeSize: .14 }), // Apple a Day
    face('', 'rect', 4.9, 'left', palette.navy, { weight: 'normal', nameSize: .44 }), // Market Sparrow
    face('Greengrocer', 'plaque', 4.3, 'wordmark', palette.green, { ...serif, nameSize: .42, typePosition: 'above', typeSize: .15 }), // Root & Branch
    face('Groceries', 'rect', 4.9, 'left', palette.enamel, { nameSize: .42, typePosition: 'side', typeSize: .17 }), // Full Cupboard
    face('Grocer', 'rect', 4.8, 'wordmark', palette.produce, { weight: 'normal', nameSize: .42, typeSize: .17 }), // Neighbor Goods
    face('', 'clipped', 4.4, 'wordmark', palette.bread, { ...serif, weight: 'bold', nameSize: .43 }), // Orchard Pantry
  ],
  // Studios keep spare signwork, with scale and alignment chosen around
  // each name. A small craft label only supplies missing information.
  STUDIO: [
    face('', 'rect', 4.5, 'left', palette.studio, { weight: 'normal', uppercase: true, nameSize: .40 }), // Studio North
    face('Ceramics', 'rect', 4.5, 'wordmark', palette.clay, { ...serif, typePosition: 'side', nameSize: .43, typeSize: .17 }), // Ink & Clay
    face('Art studio', 'rect', 3.0, 'left', palette.studio, { ...mono, lines: ['Small', 'Works'], typePosition: 'above', nameSize: .33, typeSize: .14 }),
    face('Workshop', 'rect', 3.6, 'wordmark', palette.night, { weight: 'normal', nameSize: .48, typeSize: .14 }), // Made Here
    face('Art studio', 'rect', 4.0, 'wordmark', palette.rose, { ...serif, typePosition: 'above', nameSize: .44, typeSize: .15, typeUppercase: true }), // Oddly Enough
    face('', 'rect', 3.6, 'left', palette.studio, { ...mono, lines: ['The Print', 'Room'], lineScales: [1, .75], nameSize: .33 }),
    face('Art studio', 'rect', 4.9, 'left', palette.sky, { weight: 'normal', typePosition: 'side', nameSize: .42, typeSize: .14 }), // Soft Geometry
    face('Ceramics', 'plaque', 3.1, 'wordmark', palette.bread, { ...serif, nameSize: .45, typeSize: .16 }), // Kilnfolk
    face('Art studio', 'rect', 4.0, 'left', palette.paper, { ...mono, typePosition: 'above', nameSize: .42, typeSize: .14 }), // Pencil Club
    face('Design studio', 'rect', 3.4, 'stacked', palette.blue, { lines: ['Bright', 'Objects'], lineScales: [1, .80], uppercase: true, nameSize: .33, typeSize: .14 }),
    face('Textiles', 'rect', 5.2, 'wordmark', palette.floral, { ...italic, typePosition: 'side', nameSize: .42, typeSize: .17 }), // Thread & Wonder
    face('Art studio', 'rect', 3.8, 'left', palette.studio, { ...serif, nameSize: .44, typeSize: .14 }), // Open Hands
  ],
};
