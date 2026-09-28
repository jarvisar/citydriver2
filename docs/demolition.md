# Demolition

Demolition is a timed run in the truck. The goal is to cause as much property damage as possible before the clock runs out. It works like Burnout's Crash and Road Rage modes, with chains that bank like combos in Tony Hawk's Pro Skater.

## The Clock

A run starts at 60 seconds. Finishing a contract adds 10 seconds, and wrecking a moving car (a takedown) adds 3. The clock holds at most 120 seconds. Parked cars don't add time, since a street lined with them would keep the clock going forever. Resetting the truck costs 5 seconds. The last 10 seconds tick.

If time runs out while a chain is going, the chain keeps going. The clock says LAST CHAIN, and the run ends once the chain is banked or lost. Nothing adds time after that, but every hit still counts.

## Contracts

Each run has three contracts, like felling five trees, two takedowns or a 14 hit chain. Between chains the task card shows the next one and how the others stand. The pause menu lists all three. When a contract asks for bus shelters, traffic lights, parked cars or takedowns, the street map marks them with orange dots. Trees and lamp posts are on every street, so they aren't marked.

| Contract | Targets |
| --- | --- |
| Fell trees | 3, 5, 8 |
| Flatten lamp posts | 4, 7, 12 |
| Knock down traffic lights | 1, 3, 5 |
| Crush bus shelters | 1, 2, 3 |
| Write off parked cars | 2, 4, 7 |
| Takedowns | 1, 2, 4 |
| A long chain | 8, 14, 22 hits |
| Bank in one chain | $40K, $120K, $300K |

The targets step up with your best rating: the first column until C, the second until A, then the third. One of the three is always a step harder. Restarting a run keeps its contracts, and a finished run brings new ones.

## Prices

Street furniture is paid for when it comes loose:

| Item | Price |
| --- | --- |
| Litter bin | $250 |
| Cafe chair | $120 |
| News stand | $300 |
| Cafe table | $350 |
| Bike rack | $400 |
| Street sign | $450 |
| Post box | $900 |
| Bench | $1,100 |
| Park lantern | $1,400 |
| Utility box | $1,600 |
| Fire hydrant | $2,200 |
| Market stall | $2,400 |
| Lamp post | $3,200 |
| Tree | $4,500 |
| Traffic light | $6,500 |
| Bus shelter | $9,000 |
| Signal gantry | $18,000 |

A cafe's table and four chairs come loose together and are paid for together. Trees and bus shelters only give way to the truck. A fire hydrant sprays water for a few seconds after it's knocked off.

Cars are worth the most: a hatchback $14,000, a sedan $19,000, an estate $21,000, a pickup $26,000, a van $29,000 and the bus, if one comes by, $45,000. Parked cars pay half. Each hit pays part of the car's price, based on how fast the two were closing. A hit at 16 m/s (36 mph) or faster wrecks the car at once. Slower hits pay by the square of the speed, so a hit at half that speed pays a quarter. Hits under 2.5 m/s don't count, and a car can only take one hit every 0.35 seconds, so pushing a car earns nothing. A car stops paying once it has been paid in full.

Everything the truck knocks into something else counts too. A car sent into a parked car, a wall or a lamp post pays for the damage it does.

## Chains

Each hit starts or continues a chain. Every fourth hit raises the chain's multiplier, up to ×5, and each hit pays its price times the multiplier it lands at. The chain's total is added to the score when it ends.

A chain at ×1 waits 2.5 seconds for the next hit, and each step of the multiplier takes 0.2 seconds off that, so at ×5 the next hit has to come within 1.7 seconds. The bar along the top of the task card shows the wait. To bank a chain on purpose, stop hitting things until it runs out.

Every hit also tops up the boost meter, and a wrecked car tops it up more.

## Pedestrians

Residents glow red during a run, even behind trees and cars. Anyone in the truck's way dives aside when they see it coming. They get clear of the truck up to about 45 mph. Flat out, they might not.

Running someone over costs a $10,000 fine and the whole chain in progress. Someone hit by what the truck sent flying, like a lamp post or a car it knocked loose, costs the fine but the chain carries on. A pair walking together, or someone hit by a person thrown into them, counts as one fine.

## Ratings

| Rating | Damage |
| --- | --- |
| – Fender bender | under $50,000 |
| D Nuisance | $50,000 |
| C Vandal | $125,000 |
| B Menace | $250,000 |
| A Wrecking ball | $500,000 |
| S Natural disaster | $1,000,000 |
| ★ Act of God | $2,000,000 |

The best five runs are saved as high scores, with the total damage of every run. The table is on the results screen and in the pause menu during a run. Once a run passes your best, the score panel says so.

## Balance

The numbers were checked with a bot that plays whole runs in the game. It drives the truck at whatever is worth the most for the time it takes to get there, boosts, and backs out when it gets stuck. It doesn't go looking for contracts. One version swerves round pedestrians and one drives straight through. On seeds 4817, 1 and 2, three runs each for the first and two for the second:

| | Swerves | Drives through |
| --- | --- | --- |
| Damage | $175,000 to $2,230,000 | $105,000 to $1,380,000 |
| Ratings | C to ★, mostly B | D to S |
| Run length | 63 to 102 seconds | 75 to 99 seconds |
| Pedestrians hit | 1 to 4 | 1 to 7 |
| Chains lost to them | up to $121,000 a run | up to $49,000 a run |

Later runs got harder contracts, since the first run's rating was already high, and most of those went unfinished.

Before contracts and the pedestrian rule, the bot that drove through people lost up to $600,000 a run in chains, often more than it scored. Over half of those hits came from a car or a lamp post the truck had sent flying, which the player can't see coming. A parked row decided most big runs too: one run made $1.3M of its $1.6M from a single pile-up of parked cars, which is why they now pay half.

Each hit is multiplied as it lands. Multiplying the whole chain when it ended made long chains grow with the square of their length, and with a ×8 cap one 25-hit chain was worth $900,000.
