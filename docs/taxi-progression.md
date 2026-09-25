# Taxi Progression and Balance

Taxi runs work like Crazy Taxi: a shift clock that fares add time to. The numbers are tuned for this game and aren't copied from Crazy Taxi.

## Fares

- Passengers waiting for a ride are never navigation targets. Stop in any pickup ring to pick them up. The destination and route only show up after they get in. Dropping them off, missing the fare or restarting clears the navigation.
- Boarding and drop-off need the cab to be stopped for 0.45 seconds.
- Holding a continuous drift for 0.65 seconds earns tips. Separate taps don't add up.
- A crash resets the stunt combo but keeps the tips already earned. Stunts don't score again until the cab has been clear of impacts for 0.8 seconds.

## The Shift Clock

A shift starts at 90 seconds and holds at most 180. Boarding adds 6 seconds, plus 2 for each extra rider. Finishing a fare adds a second for every 24 m of its route, plus a rating bonus (Speedy +5, Normal +2, Slow 0) and up to 5 seconds for a Speedy streak.

The goal is for driving speed to decide how long a shift lasts:

| Route pace | Shift |
| --- | --- |
| 15 m/s (a first run) | about three fares, 3–4 minutes |
| 21 m/s (a decent driver) | about five fares, 5 minutes |
| 24 m/s (Speedy arrivals with a streak) | the clock holds, 15 minutes or more |
| 28 m/s | the clock grows until it caps |

These numbers assume 150 m to the next ring and 4 seconds at every stop. Before this tuning, each second of time needed 33 m of route and the streak bonus topped out at 3 seconds. A driver needed a 28 m/s average just to break even, so even a driver rated Speedy on every fare ran out of time.

Group fares add their route time at the last stop and only a small rating bonus at each stop before that. A four-rider group is slightly easier on the clock than four single fares. It pays about 60% more per metre plus a group bonus, and stunt tips are multiplied by the number of riders. But it pays nothing if anyone is still in the cab when a rider's clock or the shift runs out.

## Group Routes

A group's stops are picked one at a time from the places near the previous stop. Candidates are ranked by distance plus penalties, in metres:

- 320 for a stop on the same east–west street as the previous one
- 140 for a stop straight ahead
- 200 for a type of place the group is already visiting

The nearest stop still wins if it's the only option. Over about 200 sampled group fares, groups with every stop on one street went from 15% to 4%, routes that went straight the whole way from 21% to 11%, and groups repeating a destination type from 16% to 6%.

## Shift Goals

Every shift picks three goals from a list of eleven: fares, riders, groups, Speedy arrivals, Speedy streak, combo, tips, near misses, Crazy stops, long rides and a full cab. The goals are seeded by the shift number, so restarting keeps the same goals.

Goal targets come in three tiers by driver rank. Rookie and Cabbie get tier one, Regular and Pro get tier two, and Veteran and above get tier three. The third goal is always one tier harder than the other two.

Completing a goal adds its bonus ($150–$600) to the fleet balance. Bonuses don't count toward the run score, so licences are still based on fare money only. Goals are shown in **Pause → Shift goals**, on the map card, as a popup when completed, and on the results screen.

## Career, Ranks and Records

The career saves lifetime shifts, fares, riders, groups, earnings, tips and goal bonuses under `citydriver-taxi-career`. Career earnings set the driver rank:

| Rank | Career earnings |
| --- | ---: |
| Rookie | $0 |
| Cabbie | $2,000 |
| Regular | $6,000 |
| Pro | $15,000 |
| Veteran | $35,000 |
| Ace | $75,000 |
| City Legend | $150,000 |

Each rank unlocks a livery in the taxi fleet.

Records are kept for most fares in a shift, best combo, longest Speedy streak, most tips in a shift and longest shift. On the results screen, a tile turns gold when that shift beat the record. The first shift sets the records without marking them. The best cash score is saved separately with the licence under `citydriver-taxi-best`.

## Tests

`npm test` covers the goal selection, goal completion, career totals, records, promotions, livery unlocks and group route penalties. With the dev server running, `npm run test:fleet` tests the results screen, the fleet dialog and goal bonuses in the browser.
