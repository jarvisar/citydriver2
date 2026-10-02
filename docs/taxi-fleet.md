# Taxi Fleet

Completed fares, tips and shift goal bonuses are added to a saved fleet balance. So are free drive's stunt chains, a cut of each demolition chain, and new places and jump stars. It's the same balance the garage sells every car from (see [money and the garage](economy.md)). Ending a shift early keeps completed earnings, but unfinished fares pay nothing. Buying a cab doesn't change your run score or best score.

The fleet opens from the Taxi fleet button in the pause menu, or on a shift's results screen. Buying a cab selects it for the next shift. You can save up for the Formula Taxi straight away, or switch back to any cab you own.

Cabs are in the free drive garage too, at the same prices, and can be test driven there for two minutes. A test drive doesn't unlock a cab for shifts, and a cab the fleet doesn't own has no fares around it.

## Liveries

The fleet dialog also has the cab's livery. Liveries are unlocked by driver rank, not bought: Classic Yellow to start, then Checker Cream, Signal Red, Sea Glass, Forest Green, Midnight Blue, and Graphite at City Legend. Locked liveries show which rank unlocks them. A livery applies to every taxi, changes the cab straight away (even mid-run) and is saved with the fleet. Free drive uses its own garage paint. See [progression](taxi-progression.md) for the ranks.

## Stats

| Cab | Price | Top speed (m/s / mph) | Acceleration | Braking | Grip | Off-road speed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Taxi | Included | 40 / 89 | 21 | 32 | 1.40 | 28 |
| GT Taxi | $10,000 | 46 / 103 | 29 | 34 | 1.55 | 28 |
| Formula Taxi | $40,000 | 50 / 112 | 40 | 36 | 2.20 | 28 |

Acceleration and braking are in m/s², and off-road speed is in m/s. Grip is relative to the original wagon. Boost adds 10 m/s to top speed. Fares, boost, timers and passenger capacity are the same for every taxi.

The Formula Taxi has two seats, with the first-person camera in the left seat. Every cab carries groups of up to four riders.

A good shift earns about $2,000 to $5,000, so the GT Taxi takes a few shifts and the Formula Taxi more like an hour and a half of driving. They were $1,500 and $4,500 when cabs were the only thing to buy.

Straight-road measurements at 120 Hz without boost:

| Cab | 300 m from rest | 0-60 mph | Braking from 67 mph |
| --- | ---: | ---: | ---: |
| Taxi | 8.68 s | 1.51 s | 12.08 m |
| GT Taxi | 7.48 s | 1.04 s | 11.45 m |
| Formula Taxi | 6.73 s | 0.73 s | 10.88 m |

## Tests

`npm test` checks handling and saved balances. With the dev server running, run `npm run test:fleet` and `npm run test:smoke`. Reports and desktop/touch screenshots go to `.artifacts/fleet/`.
