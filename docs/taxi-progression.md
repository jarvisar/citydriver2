# Progression and balance

Taxi runs borrow Crazy Taxi's shape, a shift clock fed by fares, without copying its numbers. This note records how the clock, the fare offers and the progression layers are tuned, and why.

## The shift clock

A shift starts at 90 seconds and holds at most 180. Boarding adds 6 seconds plus 2 per extra rider. Finishing a fare adds a second for every 24 m of its route plus the rating bonus (Speedy +5, Normal +2, Slow 0) and up to 5 seconds for a Speedy streak.

The target is that pace decides how long a shift lasts:

| Route pace | Shift |
| --- | --- |
| 15 m/s (a first run) | about three fares, 3–4 minutes |
| 21 m/s (a decent driver) | about five fares, 5 minutes |
| 24 m/s (Speedy arrivals with a streak) | the clock holds, 15 minutes or more |
| 28 m/s | the clock grows until it caps |

The model behind the table counts 150 m to the next ring and 4 seconds at every stop. Before this tuning the distance paid a second per 33 m and the streak topped out at 3 seconds, which needed a 28 m/s average just to break even: a driver rated Speedy on every fare still bled time, so skill changed the score but hardly ever the length of a shift.

Group fares pay their route time at the last stop and only a small rating bonus at each earlier one. A four-rider party is a little kinder on the clock than four solo fares, pays about 60% more per metre plus the group bonus, and multiplies stunt tips by everyone aboard, but pays nothing if anyone is still aboard when a rider's clock or the shift runs out.

## Group routes

A party's stops are grown one hop at a time from the places near the rider who just got out. Candidates are ranked by distance plus penalties, in metres, before any street is traced: 320 for a stop on the same east–west street as the previous one, 140 for a hop that carries straight on, and 200 for a second place of a kind the party already visits. The nearest legal stop still wins when it is the only one, so the hop limits, detour and turn rules are unchanged.

Sampled over about 200 seeded group offers, parties with every stop on one street fell from 15% to 4%, fully straight chains from 21% to 11%, and parties repeating a destination type from 16% to 6%. Party sizes and ring colour shares did not move.

## Shift goals

Every shift draws three goals from a pool of eleven (fares, riders, groups, Speedy arrivals, Speedy streak, combo, tips, near misses, Crazy stops, long rides, a full cab). The draw is seeded by the shift number, so a restart keeps its goals. Targets come in three tiers by driver rank: Rookie and Cabbie draw tier one, Regular and Pro tier two, Veteran and above tier three. The third goal is always one tier harder than the others.

A goal completes the moment its statistic is reached and banks its bonus ($150–$600) with the fleet. Bonuses never touch the run score, so licences still measure fare money alone. Goals show in **Pause → Shift goals** with live progress, on the map card, as a toast when completed, and on the results screen.

## Career, ranks and records

The career saves lifetime shifts, fares, riders, groups, earnings, tips and goal bonuses under `citydriver-taxi-career`. Career earnings set the driver rank: Rookie, Cabbie ($2,000), Regular ($6,000), Pro ($15,000), Veteran ($35,000), Ace ($75,000) and City Legend ($150,000). Each rank unlocks a livery in the fleet dialog.

Records are kept for fares in a shift, best combo, longest Speedy streak, tips in a shift and shift length. The results screen turns a tile gold when the shift just beat that record; the first shift sets records without marking them. Best cash stays with the licence and its own `citydriver-taxi-best` key.

## Tests

`npm test` covers the goal draw, goal completion and banking, career totals, records, promotions, livery unlocks and the group route penalties. With a dev server, `npm run test:fleet` exercises the results screen, the fleet dialog and goal banking in the browser.
