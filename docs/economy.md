# Money and the Garage

Every mode pays into one balance, and the garage sells every vehicle out of it. You start with the Taxi for shifts and the Surf Wagon for free drive. Everything else, cabs included, has a price. The aircraft cost the most and are meant to be the long goal.

## What Pays

- Taxi shifts: fares, tips and shift goal bonuses, as soon as each one is paid. This is still the main way to earn.
- Demolition runs: a cut of the damage, paid as each chain banks (below).
- Free drive: stunt chains when they bank, new places ($100 for the first of a kind, $50 for the rest) and jump stars ($100 each). Places and stars reset with each visit, like the notebook.

All of it also counts toward the driver rank, including shift goal bonuses, which used to be left out.

I tried to keep each mode at about the same money per minute for the same level of skill, so nobody has to play a mode they don't like to get the next car. Roughly:

| | Beginner | Average | Good |
| --- | ---: | ---: | ---: |
| Taxi shift | $200-350/min | $450-550/min | $650-1,000/min |
| Demolition | $150-300/min | $450-800/min | $850-1,150/min |

The taxi numbers come from the shift sim at different driving paces (tips and goals on top). The demolition numbers come from the bot runs in [demolition](demolition.md). Free drive pays less than either, which is fine since it has no clock. A whole city's places and stars are worth about $4,000 a visit.

### Demolition's Cut

It used to be a flat 0.4% of everything banked. That paid an S run about $4,000 and a lucky row of parked cars $9,000, in under two minutes, so demolition out-earned a good taxi shift three to eight times over. Now the cut works like tax bands on the run's banked damage:

| Damage | Share |
| --- | ---: |
| First $100,000 | 0.4% |
| $100,000 to $300,000 | 0.25% |
| $300,000 to $1M | 0.1% |
| Over $1M | 0.04% |

So a C rating pays about $460, B $780, S $1,600 and an Act of God $2,000. On the bot's runs that took the average from $1,680 a minute to $720, and the gap between a bad seed and a good one from about 8x to 2x. It still pays as each chain banks, so ending a run early keeps what's banked. Fines come off the score, not the pay.

### Smashing in Free Drive

Smashes in free drive used to pay 0.5% of demolition prices, more per hit than demolition's own cut and with no clock. Parked cars go back to their bays once you're 150 m away, so a truck circling a block could earn forever. Now a smash pays 0.1% (a lamp $3, a tree $5, a car written off $14 to $29, before the multiplier), and the same kind of thing again in one chain pays less each time, the way Tony Hawk's scores repeated tricks: 100%, 75%, 50%, 25%, then 10%. Repeats still count toward the multiplier. Drifts, jumps, near misses and flying stunts aren't affected.

## Prices

The cars that turn up in traffic are cheapest, since you can borrow them on foot anyway. Times are at about $500 a minute.

| Vehicle | Price | Time |
| --- | ---: | ---: |
| Taxi | Included | |
| Surf Wagon | Included | |
| City Hatch | $2,000 | 4 min |
| Highway Sedan | $2,500 | 5 min |
| Estate Wagon | $3,000 | 6 min |
| Work Pickup | $4,000 | 8 min |
| Delivery Van | $4,500 | 9 min |
| Micro | $5,000 | 10 min |
| Buggy | $8,000 | 16 min |
| GT Taxi | $10,000 | 20 min |
| GT | $12,000 | 24 min |
| Hot Rod | $15,000 | 30 min |
| City Bus | $18,000 | 36 min |
| Truck | $25,000 | 50 min |
| Monster Truck | $30,000 | 1 h |
| Formula Taxi | $40,000 | 1.3 h |
| Exotic | $45,000 | 1.5 h |
| Jetpack | $60,000 | 2 h |
| Formula | $65,000 | 2.2 h |
| Helicopter | $90,000 | 3 h |
| Plane | $140,000 | 4.7 h |

Everything together is $579,000, about 19 hours of average play. The prices are in `GARAGE_PRICES` in `src/cars.js`.

## Using the Garage

A car you own is picked straight away, like before. It becomes your free drive car. Cabs are different. Picking one puts you in it with fares waiting and makes it your shift cab, but Free drive on the title still starts in your own car. Any other car opens its offer: price, how far your balance gets you, and Buy, Test drive and Save for this. Buying puts you in it.

A test drive is two minutes in the car, free the first time for each car. After that it costs 2.5% of the price ($2,250 for the helicopter). Stunts pay as usual, but a cab you're only test driving has no fares. When time is up the car stops, or lands itself if it flies, then you're back in your own car. If you'd already got out, it just goes back to the garage. Test drives used are saved with the fleet, so reloading doesn't give you another free one.

Save for this pins a car. The garage header and both results screens show how far off it is, and free drive says so once when you can afford it. Without a pinned car they show the cheapest one you can't buy yet.

The jetpack is sold under the cars, in its own Gear section. Without it, holding jump in the air does nothing more than a jump. The parachute is still free, since it's what you have when you bail out of an aircraft. Its free try is two minutes too, but the clock only runs while you're on foot. When it runs out mid-flight you drop, and a tap of jump still opens the parachute.

Paint costs $100 a colour, the rainbow included. Going back to each car's own colour is free, and so is picking the colour you already have. Paint is saved with the fleet now, since it costs money. The custom colour picker only charges when you let go of it, and closing the garage on a colour you were still picking puts the old one back.

The Konami code (up, up, down, down, left, right, left, right, B, A, or the same on a controller's D-pad) pays $10,000 once per save and adds Rainbow to the paint swatches. Entering it again only reminds you where the paint is. The $10,000 goes into the balance but not toward the driver rank.

The Taxi fleet dialog still sells cabs and liveries. It's the same ownership and the same prices as the garage.

## Old Saves

Saves from before this kept only cabs, since the garage lent every other car out for free. Loading one keeps the balance and cabs, and you also keep the car you had picked in the garage and, if you've ever been on foot, the jetpack, so nobody comes back to find what they used locked. That only happens once, when the save is first upgraded.

## Known Issues & Limitations

- Places and jump stars pay again after a reload. Re-finding a city is still slower money than a shift, so I left it.
- Traffic cars can be borrowed on foot for free. That's why those cars are the cheapest.
- There's nothing to spend on once the garage is full.
