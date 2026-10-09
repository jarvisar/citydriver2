# Taxi Fleet

Completed fares, tips and shift goal bonuses are added to a saved fleet balance. So are free drive's stunt chains, a cut of each demolition chain, and new places and jump stars. It's the same balance the garage sells every car from (see [money and the garage](economy.md)). Ending a shift early keeps completed earnings, but unfinished fares pay nothing. Buying a cab doesn't change your run score or best score.

The cabs are the first section of the garage, which opens from Garage in the pause menu or on a shift's results screen. The cab the next shift uses is tagged Shift cab. In free drive, picking or buying a cab puts you in it and makes it the shift cab. During a shift the garage shows only the cabs and their liveries, and a cab picked or bought there drives the next shift, so nothing is swapped mid-run. You can save up for the Formula Taxi straight away, or switch back to any cab you own.

Cabs can be test driven for two minutes in free drive, not during a shift. A test drive doesn't unlock a cab for shifts, and a cab the fleet doesn't own has no fares around it.

## Liveries

The livery row sits under the Cabs heading in the garage. Liveries are unlocked by driver rank, not bought: Classic Yellow to start, then Checker Cream, Signal Red, Sea Glass, Forest Green, Midnight Blue, and Graphite at City Legend. Locked liveries show which rank unlocks them. A livery applies to every taxi, changes the cab straight away (even mid-run) and is saved with the fleet. Free drive uses its own garage paint. See [progression](taxi-progression.md) for the ranks.

## Stats

| Cab | Price | Top speed (m/s / mph) | Acceleration | Braking | Grip | Off-road speed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Taxi | Included | 47 / 105 | 27 | 32 | 1.40 | 32.9 |
| GT Taxi | $10,000 | 54 / 121 | 37 | 34 | 1.55 | 32.9 |
| Formula Taxi | $40,000 | 59 / 132 | 51 | 36 | 2.20 | 32.9 |

Acceleration and braking are in m/s², and off-road speed is in m/s. Grip is relative to the original wagon. Boost adds 10 m/s to top speed. Fares, boost, timers and passenger capacity are the same for every taxi.

The Formula Taxi has two seats, with the first-person camera in the left seat. Every cab carries groups of up to four riders.

A good shift earns about $2,000 to $5,000, so the GT Taxi takes a few shifts and the Formula Taxi more like an hour and a half of driving. They were $1,500 and $4,500 when cabs were the only thing to buy.

Straight-road measurements at 120 Hz without boost:

| Cab | 300 m from rest | 0-60 mph | Braking from 67 mph |
| --- | ---: | ---: | ---: |
| Taxi | 7.43 s | 1.08 s | 12.08 m |
| GT Taxi | 6.42 s | 0.76 s | 11.45 m |
| Formula Taxi | 5.74 s | 0.54 s | 10.88 m |

## Tests

`npm test` checks handling and saved balances. With the dev server running, run `npm run test:fleet` and `npm run test:smoke`. Reports and desktop/touch screenshots go to `.artifacts/fleet/`.
