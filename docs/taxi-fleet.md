# Taxi fleet

Completed fares, tips and shift goal bonuses go into a saved fleet balance. Restarting keeps completed earnings; unfinished fares pay nothing. Buying a cab doesn't change your run score or best score. Old best scores aren't converted into fleet money.

Open **Pause → Taxi fleet** during a run or **Taxi fleet** on the results screen. Purchases select the cab for the next run. You can save directly for Formula or switch back to an owned cab.

## Liveries

The fleet dialog also picks the cab's livery. Liveries are earned, not bought: each driver rank unlocks one, from the factory yellow through Checker Cream, Signal Red, Sea Glass, Forest Green and Midnight Blue to Graphite at City Legend. Locked swatches stay visible and name the rank that opens them. A livery applies to every taxi cab, repaints the cab immediately even mid-run, and is saved with the fleet. Free drive keeps its own garage paint. See [progression](taxi-progression.md) for the ranks.

All three taxis are free in the Free Drive garage. Using one there doesn't unlock it for taxi runs.

## Stats

| Cab | Price | Speed (m/s / mph) | Acceleration | Braking | Grip | Off-road speed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Taxi | Included | 40 / 89 | 21 | 32 | 1.40 | 28 |
| GT Taxi | $1,500 | 46 / 103 | 29 | 34 | 1.55 | 28 |
| Formula Taxi | $4,500 | 50 / 112 | 40 | 36 | 1.70 | 28 |

Acceleration and braking use m/s²; off-road speed uses m/s. Grip is relative to the original wagon. Fares, boost, timers, and passenger capacity are the same for every taxi.

Formula has two seats, with the first-person camera in the left seat. All cabs carry one passenger.

## Measurements

Normal fares pay about $118–348 before tips and early-arrival bonuses. A seeded sample of 15 fares delivered with half the timer left had a median payout of $293: about six fares for GT, then sixteen more for Formula.

Straight-road measurements at 120 Hz without boost:

| Cab | 300 m from rest | 0–60 mph | Braking from 67 mph |
| --- | ---: | ---: | ---: |
| Taxi | 8.68 s | 1.51 s | 12.08 m |
| GT Taxi | 7.48 s | 1.04 s | 11.45 m |
| Formula Taxi | 6.73 s | 0.73 s | 10.88 m |

Actual fare pace depends on the route and driving.

## Tests

`npm test` checks handling and saved balances. With a dev server, run `npm run test:fleet` and `npm run test:smoke`.

Fleet reports and desktop/touch screenshots go to `.artifacts/fleet/`.
