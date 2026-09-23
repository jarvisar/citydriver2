# Taxi handling and scoring

Taxi runs start at 90 seconds and cap at 180 seconds. Fare timing, shift goals and the career are described in [progression and balance](taxi-progression.md).

- Steering returns to center and countersteers faster than it turns in.
- Brake takes priority over throttle. At zero speed, it waits 0.5 seconds before reversing; boarding and drop-off need 0.45 seconds. Release and press brake again to skip the wait.
- A continuous drift earns tips after 0.65 seconds. Separate taps don't accumulate.
- A crash halves tips once per scrape. Another penalty is possible after 0.8 seconds without a meaningful impact. Stunts don't score during recovery.
- Deliveries add 18 seconds for trips up to 400 m, then roughly one second per additional 60 m, up to 30 seconds.
- Available passengers never become navigation targets. Stop in any pickup ring to board; only then show the destination and route. Delivery, missed fares, and restart clear navigation.
- Touch boost reaches the same 52 m/s limit as keyboard and chase controls. Releasing the stick stops the cab even while Boost is held.

## Handling measurements

Historical measurements from the taxi scoring update, on flat road at 120 Hz starting at 25 m/s. See [Driving feel](handling.md) for the current steering and traction system.

| Measurement | Before | After |
| --- | ---: | ---: |
| Time within boarding speed while braking | 0.34 s | 0.83 s |
| Stopping distance | 8.67 m | 8.67 m |
| Heading change in 0.5 s after releasing a full turn | 13.85° | 6.00° |
| Time to reverse steering direction | 0.10 s | 0.05 s |
| Tips left from $100 after four crash contacts | $6 | $50 |

## Tests

Run `npm test` and, with a dev server, `npm run test:smoke`.

Tests cover pickups, drop-offs, steering, reversing, drifts, crash penalties, fare rewards, and touch boost at multiple frame rates.
