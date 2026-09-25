import { CitydriverWorld } from './world/citydriver-world.js';
import { citydriverRoute } from './world/city-route.js';

// A single connected city, sharing the garage and renderer scene interface.
export const JOURNEYS = {
  city: {
    label: 'CITYDRIVER', routeNumber: '1',
    World: CitydriverWorld, route: citydriverRoute,
    sound: 'Sound on',
    canvas: 'Drive with WASD or arrow keys.',
  },
};
