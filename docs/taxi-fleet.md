# Taxi Fleet

Completed fares, tips and shift goal bonuses are added to a saved fleet balance. Restarting keeps completed earnings, but unfinished fares pay nothing. Buying a cab doesn't change your run score or best score.

Open **Pause → Taxi fleet** during a run, or **Taxi fleet** on the results screen. Buying a cab selects it for the next run. You can save up for the Formula Taxi straight away, or switch back to any cab you own.

All three taxis are free in the free drive garage. Using one there doesn't unlock it for taxi runs.

## Liveries

The fleet dialog also has the cab's livery. Liveries are unlocked by driver rank, not bought: Classic Yellow to start, then Checker Cream, Signal Red, Sea Glass, Forest Green, Midnight Blue, and Graphite at City Legend. Locked liveries show which rank unlocks them. A livery applies to every taxi, changes the cab straight away (even mid-run) and is saved with the fleet. Free drive uses its own garage paint. See [progression](taxi-progression.md) for the ranks.

## Stats

| Cab | Price | Top speed (m/s / mph) | Acceleration | Braking | Grip | Off-road speed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Taxi | Included | 40 / 89 | 21 | 32 | 1.40 | 28 |
| GT Taxi | $1,500 | 46 / 103 | 29 | 34 | 1.55 | 28 |
| Formula Taxi | $4,500 | 50 / 112 | 40 | 36 | 2.20 | 28 |

Acceleration and braking are in m/s², and off-road speed is in m/s. Grip is relative to the original wagon. Boost adds 10 m/s to top speed. Fares, boost, timers and passenger capacity are the same for every taxi.

The Formula Taxi has two seats, with the first-person camera in the left seat. Every cab carries one passenger at a time.

Normal fares pay about $118–348 before tips and early arrival bonuses. In a sample of 15 fares delivered with half the timer left, the median payout was $293. That works out to about six fares for the GT Taxi, then sixteen more for the Formula Taxi.

Straight-road measurements at 120 Hz without boost:

| Cab | 300 m from rest | 0–60 mph | Braking from 67 mph |
| --- | ---: | ---: | ---: |
| Taxi | 8.68 s | 1.51 s | 12.08 m |
| GT Taxi | 7.48 s | 1.04 s | 11.45 m |
| Formula Taxi | 6.73 s | 0.73 s | 10.88 m |

## Tests

`npm test` checks handling and saved balances. With the dev server running, run `npm run test:fleet` and `npm run test:smoke`. Reports and desktop/touch screenshots go to `.artifacts/fleet/`.
