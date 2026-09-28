# Taxi Progression and Balance

Taxi runs work like Crazy Taxi: a shift clock that fares add time to. The numbers are tuned for this game and aren't copied from Crazy Taxi.

## Fares

- Passengers waiting for a ride are never navigation targets. Stop in any pickup ring to pick them up. The route only shows up after they get in. Dropping them off, missing the fare or restarting clears the navigation.
- Driving up to a ring shows where the passenger is going, who they are, the trip length and the fare.
- Boarding and drop-off need the cab to be stopped for 0.45 seconds.
- The drop-off zone is a stretch of the street in front of the destination, and the cab can stop anywhere within 8 m of it. A building's zone covers the middle half of its front. A park or square has no single door, so its zone runs along its side of the street, up to 40 m either way from the gate. Zones stop well short of junctions and never go onto a bridge. Fares are still measured to the entrance, so a long zone can save a few seconds.
- The timer pill shows the rating the rider would give now and how many seconds are left before it drops. In the last rating it counts down to the rider giving up.
- Holding a continuous drift for 0.65 seconds earns tips. Separate taps don't add up.
- A crash resets the stunt combo but keeps the tips already earned. Stunts don't score again until the cab has been clear of impacts for 0.8 seconds.

## The Shift Clock

A shift starts at 100 seconds and holds at most 180. Boarding adds 8 seconds, plus 2 for each extra rider. Finishing a fare adds a rating bonus (Speedy +10, Normal +6, Slow +1), a second for every 30 m of its route, and up to 5 seconds for a Speedy streak. Riders who get out before the last stop of a group add 2 seconds for Speedy and 1 for Normal.

Time rewards shrink by 4.5% for every minute of the shift, down to 40%, so every shift ends.

Short fares keep the clock going. Long fares and groups pay more money per minute but cost time. A bot that drives the street routes at a steady pace and takes the nearest fare gets these shift lengths:

| Route pace | Shift |
| --- | --- |
| 13 m/s | about 3 minutes |
| 16 m/s | about 4.5 minutes |
| 19 m/s | about 7 minutes |
| 22 m/s | about 12 minutes |
| 25 m/s | about 15 minutes |

If time runs out with riders aboard, the shift carries on until they have all got out or given up. Their fares still pay, but no more time is added. If time runs out with nobody aboard, the shift ends.

Group fares add their route time at the last stop. A group pays about 60% more per metre than single fares, plus a group bonus, and stunt tips are multiplied by the number of riders. It pays nothing if a rider's clock runs out.

## Special Riders

Some single riders want something from the ride. Their ring badge has an icon, and the task card says what they want.

| Icon | Rider | Rule |
| --- | --- | --- |
| Bolt | In a hurry | 30% less time, and arriving early pays double |
| Star | Thrill seeker | Stunt tips count double |
| Heart | Nervous | Pays half the fare again if the cab doesn't crash |

About two in five single riders are special. A rider in a hurry is satisfied by a Speedy arrival, a thrill seeker by at least one stunt tip, and a nervous rider by a ride with no crash.

## Hints

The first shifts show short hints in the task card: how to pick a fare, how to read the timer, how groups pay and how tips work. Each hint shows once and is saved under `citydriver-taxi-hints`.

## Group Routes

A group's stops are picked one at a time from the places near the previous stop. Candidates are ranked by distance plus penalties, in metres:

- 320 for a stop on the same east-west street as the previous one
- 140 for a stop straight ahead
- 200 for a type of place the group is already visiting

The nearest stop still wins if it's the only option. Over about 200 sampled group fares, the penalties cut groups with every stop on one street from 15% to 4%, routes that go straight the whole way from 21% to 11%, and groups repeating a destination type from 16% to 6%.

## Shift Goals

Every shift picks three goals from a list of twelve: fares, riders, groups, Speedy arrivals, Speedy streak, combo, tips, near misses, Crazy stops, long rides, a full cab and satisfied special riders. The goals are seeded by the shift number, so restarting keeps the same goals.

Goal targets come in three tiers by driver rank. Rookie and Cabbie get tier one, Regular and Pro get tier two, and Veteran and above get tier three. The third goal is always one tier harder than the other two.

Completing a goal adds its bonus ($150 to $600) to the fleet balance. Bonuses don't count toward the run score, so licences are still based on fare money only. Goals are shown in the pause menu under Shift goals, on the map card, as a popup when completed, and on the results screen.

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

`npm test` covers the shift clock, overtime, special riders, drop-off zones, goal selection, goal completion, career totals, records, promotions, livery unlocks and group route penalties. With the dev server running, `npm run test:fleet` tests the results screen, the fleet dialog and goal bonuses in the browser.
