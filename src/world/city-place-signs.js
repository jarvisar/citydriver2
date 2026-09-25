// One deliberate face per destination, in SPACE_NAMES order. Shared public
// services use recognisable systems; commercial names have their own identity.
const face = (shape, aspect, layout, background, ink, accent, options = {}) => ({
  shape, aspect, layout, background, ink, accent,
  font: 'sans-serif', weight: 'bold', subtitle: '', ...options,
});

export const PLACE_SIGN_DESIGNS = {
  clock: [
    // Clocktower Square: an enamel civic plaque.
    face('plaque', 3.5, 'frame', '#293c48', '#f2ead9', '#aab7bd', { font: 'Georgia, serif', weight: 'normal' }),
    // Bell Court: a small brass nameplate.
    face('rect', 3.2, 'wordmark', '#cab287', '#342f2a', '#87704c', { font: 'Georgia, serif', weight: 'normal' }),
    // Chime Terrace: simple painted lettering on a terracotta board.
    face('rect', 3.4, 'left', '#86564a', '#f3e9d7', '#c8a187', { font: 'Georgia, serif', weight: 'normal' }),
  ],
  market: [
    face('rect', 4.4, 'wordmark', '#723b33', '#f4e7ce', '#b79363', { uppercase: true }), // Market Hall
    face('arch', 3.2, 'stacked', '#e5dbc4', '#354d43', '#89957e', { font: 'Georgia, serif', lines: ['Covered', 'Market'] }),
    face('rect', 4.0, 'left', '#344b48', '#f3e6ce', '#c09a6a', { subtitle: 'Market stalls', uppercase: true }), // Traders Row
  ],
  garden: [
    face('plaque', 3.2, 'split', '#2d5145', '#ede8d4', '#9eae8c', { icon: 'leaf', lines: ['Botanical', 'Garden'], font: 'Georgia, serif', weight: 'normal' }),
    face('rect', 3.4, 'left', '#e3e2d2', '#355449', '#93a38c', { font: 'sans-serif', weight: 'normal' }), // Glasshouse Walk
    face('plaque', 3.2, 'frame', '#5b4546', '#f0e7d6', '#b59b8b', { font: 'Georgia, serif', weight: 'normal' }), // Rose Terrace
  ],
  depot: [
    face('rect', 4.1, 'split', '#233e53', '#edf0e9', '#98b2be', { icon: 'rail', uppercase: true }), // Tram Depot
    face('rect', 4.5, 'left', '#dedfd8', '#263d49', '#6c8b9b', { font: 'monospace', subtitle: 'Tram maintenance', uppercase: true }), // Carriage Works
    face('rect', 4.0, 'band', '#233e53', '#edf0e9', '#98b2be', { subtitle: 'Tram depot', uppercase: true }), // Rail Sheds
  ],
  art: [
    face('rect', 2.9, 'left', '#e7e6df', '#353a3b', '#8a9694', { weight: 'normal', lines: ['Sculpture', 'Park'] }),
    face('plaque', 3.3, 'wordmark', '#666b65', '#f0eee2', '#a9aca0', { font: 'Georgia, serif', weight: 'normal' }), // Stone Garden
    face('rect', 3.1, 'left', '#59483b', '#e8dac2', '#b39370', { weight: 'normal', subtitle: 'Sculpture garden' }), // Bronze Court
  ],
  cinema: [
    face('rect', 3.5, 'marquee', '#f0e6cf', '#71392f', '#a87345', { uppercase: true, lines: ['Rivoli', 'Cinema'] }),
    face('rect', 3.7, 'marquee', '#30444e', '#f5e6c9', '#9eb3b6', { uppercase: true, lines: ['Apollo', 'Picturehouse'] }),
    face('plaque', 3.3, 'wordmark', '#553e42', '#f2ddbd', '#ba9670', { font: 'Georgia, serif', weight: 'italic' }), // Bijou Cinema
  ],
  hotel: [
    face('rect', 3.6, 'frame', '#303536', '#e2ca94', '#ab9363', { font: 'Georgia, serif', weight: 'normal', uppercase: true }), // Grand Hotel
    face('oval', 3.1, 'wordmark', '#eddec1', '#6e492f', '#b69863', { font: 'Georgia, serif', weight: 'italic' }), // Hotel Marigold
    face('rect', 3.3, 'left', '#374c45', '#f0e9d7', '#9ead96', { lines: ['The Wayfarer', 'Hotel'], uppercase: true }),
  ],
  museum: [
    face('rect', 2.7, 'left', '#e5e2d9', '#343c3d', '#969c95', { weight: 'normal', lines: ['City', 'Museum'] }),
    face('rect', 4.3, 'wordmark', '#364d69', '#f1eee3', '#9aafbe', { uppercase: true }), // Meridian Museum
    face('plaque', 3.0, 'stacked', '#eaddc6', '#5c3f3a', '#a68b70', { font: 'Georgia, serif', weight: 'normal', lines: ['The Curiosity', 'Museum'] }),
  ],
  station: [
    // The railway has one sign system across its three stations.
    face('rect', 3.8, 'split', '#233e53', '#edf0e9', '#98b2be', { icon: 'rail', uppercase: true }), // Union Station
    face('rect', 4.4, 'split', '#233e53', '#edf0e9', '#98b2be', { icon: 'rail', uppercase: true }), // Northstar Station
    face('rect', 4.2, 'split', '#233e53', '#edf0e9', '#98b2be', { icon: 'rail', uppercase: true }), // Junction Station
  ],
  library: [
    face('plaque', 3.6, 'frame', '#ded6c2', '#39463e', '#93947b', { font: 'Georgia, serif', weight: 'normal' }), // Central Library
    face('rect', 3.4, 'left', '#34585a', '#eee9d9', '#9bb8b0', { weight: 'normal', lines: ['Lantern', 'Library'] }),
    face('plaque', 3.5, 'wordmark', '#385347', '#ede8d5', '#a1ae8c', { font: 'Georgia, serif', weight: 'normal' }), // Maple Library
  ],
  hospital: [
    // Clear, consistent blue service signs; the cross is an identifier.
    face('rect', 3.9, 'split', '#f0f0e8', '#234b61', '#527b8b', { icon: 'cross' }), // City Hospital
    face('rect', 4.0, 'split', '#f0f0e8', '#234b61', '#527b8b', { icon: 'cross' }), // Mercy Hospital
    face('rect', 4.6, 'split', '#f0f0e8', '#234b61', '#527b8b', { icon: 'cross' }), // Greenway Hospital
  ],
  observatory: [
    face('rect', 3.2, 'split', '#303e58', '#e9e5d4', '#a7b7c6', { icon: 'star', lines: ['Star', 'Observatory'], weight: 'normal' }),
    face('rect', 3.8, 'frame', '#303e58', '#e9e5d4', '#a7b7c6', { uppercase: true }), // Orion Observatory
    face('rect', 3.1, 'left', '#536576', '#ede9d8', '#a5b6bf', { lines: ['Moonrise', 'Observatory'], weight: 'normal' }),
  ],
  music: [
    face('rect', 2.8, 'stacked', '#2e5067', '#e4ebdf', '#8cb0bc', { uppercase: true, lines: ['Blue Note', 'Club'] }),
    face('plaque', 3.4, 'wordmark', '#353535', '#dfc38e', '#a78c5d', { font: 'Georgia, serif', weight: 'italic', subtitle: 'Live music' }), // The Brass Finch
    face('rect', 3.6, 'band', '#603e50', '#eee1d8', '#c0a0ad', { subtitle: 'Music club', uppercase: true }), // Velvet Echo
  ],
  sports: [
    face('rect', 3.7, 'frame', '#34514a', '#ece9d7', '#a2b08b', { uppercase: true }), // Athletic Club
    face('rect', 3.3, 'left', '#c99057', '#293e40', '#e2c69a', { uppercase: true, lines: ['Rally', 'Sports Club'] }),
    face('rect', 4.0, 'wordmark', '#e0e3d1', '#37594a', '#8da280', { weight: 'normal' }), // Green Court Club
  ],
  firehouse: [
    face('clipped', 3.8, 'band', '#773d35', '#f2e8d5', '#cfb28a', { uppercase: true, subtitle: 'Fire station' }), // Engine House
    face('clipped', 4.2, 'wordmark', '#773d35', '#f2e8d5', '#cfb28a', { uppercase: true }), // Foundry Firehouse
    face('clipped', 3.5, 'stacked', '#773d35', '#f2e8d5', '#cfb28a', { uppercase: true, lines: ['Beacon', 'Fire Station'] }),
  ],
  park: [
    // Park entrances share a modest parks-department plaque.
    face('plaque', 3.2, 'frame', '#385347', '#ede8d5', '#a1ae8c', { font: 'Georgia, serif', weight: 'normal' }), // Willow Green
    face('plaque', 3.5, 'frame', '#385347', '#ede8d5', '#a1ae8c', { font: 'Georgia, serif', weight: 'normal' }), // Linden Gardens
    face('plaque', 3.2, 'frame', '#385347', '#ede8d5', '#a1ae8c', { font: 'Georgia, serif', weight: 'normal' }), // Meadow Park
    face('plaque', 3.3, 'frame', '#385347', '#ede8d5', '#a1ae8c', { font: 'Georgia, serif', weight: 'normal' }), // Orchard Walk
  ],
  plaza: [
    // Squares use the city's pale enamel nameplates.
    face('rect', 3.5, 'frame', '#e6e3d6', '#344851', '#84969a', { uppercase: true }), // Fountain Square
    face('rect', 3.3, 'frame', '#e6e3d6', '#344851', '#84969a', { uppercase: true }), // Market Square
    face('rect', 3.5, 'frame', '#e6e3d6', '#344851', '#84969a', { uppercase: true }), // Old Town Square
    face('rect', 3.4, 'frame', '#e6e3d6', '#344851', '#84969a', { uppercase: true }), // Station Square
  ],
  postoffice: [
    face('rect', 3.5, 'split', '#2d4960', '#eee9dc', '#a6b6bc', { icon: 'post', uppercase: true, lines: ['Central', 'Post Office'] }),
    face('rect', 3.5, 'split', '#2d4960', '#eee9dc', '#a6b6bc', { icon: 'post', subtitle: 'Post office' }), // Penny Post
    face('rect', 3.7, 'split', '#2d4960', '#eee9dc', '#a6b6bc', { icon: 'post', subtitle: 'Post office' }), // Parcel House
  ],
  bathhouse: [
    face('rect', 3.5, 'frame', '#e3e4d7', '#366269', '#8ba6a3', { font: 'Georgia, serif', weight: 'normal' }), // Mosaic Baths
    face('rect', 3.8, 'wordmark', '#3d686b', '#e7e5d0', '#a8b9a6', { font: 'Georgia, serif', weight: 'normal' }), // Stillwater Baths
    face('oval', 3.2, 'wordmark', '#dbe0c9', '#415c46', '#99ad8b', { font: 'Georgia, serif', weight: 'normal', subtitle: 'Public baths' }), // Juniper Springs
  ],
  farmersmarket: [
    face('rect', 3.9, 'band', '#45604a', '#efe7ce', '#c1bb8c', { subtitle: 'Farmers market', uppercase: true }), // Harvest Market
    face('rect', 3.5, 'left', '#dcc48b', '#3d5144', '#a89f69', { subtitle: 'Farmers market' }), // Sunpatch Market
    face('arch', 2.8, 'stacked', '#e9dfc7', '#775344', '#b49a77', { font: 'Georgia, serif', lines: ['The Gather', 'Market'], subtitle: 'Farmers market' }),
  ],
  donut: [
    face('oval', 2.9, 'wordmark', '#dda5aa', '#683d3e', '#a5676b', { weight: 'bold' }), // Lucky Donut
    face('rect', 3.4, 'left', '#624c40', '#f1dec0', '#c29e77', { font: 'Georgia, serif', subtitle: 'Doughnuts & coffee' }), // Glaze Days
    face('plaque', 2.7, 'stacked', '#c9dacf', '#34534e', '#89a99b', { lines: ['Dough Si', 'Dough'], subtitle: 'Doughnuts' }),
  ],
  cityhall: [
    face('rect', 3.6, 'frame', '#d6c6a5', '#3c413e', '#958765', { font: 'Georgia, serif', weight: 'normal', uppercase: true }),
  ],
};
