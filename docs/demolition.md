# Demolition

Demolition is a timed run in the truck. The goal is to cause as much property damage as possible before the clock runs out. It works like Burnout's Crash and Road Rage modes, with chains that bank like combos in Tony Hawk's Pro Skater.

## The Clock

A run starts at 60 seconds. Wrecking a moving car is a takedown and adds 3 seconds, up to 120 seconds on the clock. Parked cars don't add time, since a street lined with them would keep the clock going forever. Resetting the truck costs 5 seconds. The last 10 seconds tick.

## Prices

Street furniture is paid for when it comes loose:

| Item | Price |
| --- | --- |
| Litter bin | $250 |
| Cafe chair | $120 |
| Cafe table | $350 |
| Street sign | $450 |
| Bench | $1,100 |
| Park lantern | $1,400 |
| Market stall | $2,400 |
| Lamp post | $3,200 |
| Tree | $4,500 |
| Traffic light | $6,500 |
| Bus shelter | $9,000 |
| Signal gantry | $18,000 |

A cafe's table and four chairs come loose together and are paid for together. Trees and bus shelters only give way to the truck.

Cars are worth the most: a hatchback $14,000, a sedan $19,000, an estate $21,000, a pickup $26,000 and a van $29,000. Each hit pays part of the car's price, based on how fast the two were closing. A hit at 16 m/s (36 mph) or faster wrecks the car at once. Slower hits pay the square of the speed, so a hit at half that speed pays a quarter. Hits under 2.5 m/s don't count, and a car can only take one hit every 0.35 seconds, so pushing a car earns nothing. A car stops paying once it has been paid in full.

Everything the truck knocks into something else counts too. A car sent into a parked car, a wall or a lamp post pays for the damage it does.

## Chains

Each hit starts or continues a chain, which waits 2.5 seconds for the next hit. Every fourth hit raises the chain's multiplier, up to ×5, and each hit pays its price times the multiplier it lands at. The chain's total is added to the score when it ends.

Knocking over a pedestrian costs a $5,000 fine and the whole chain in progress. This counts people hit by the truck and by anything it sent flying.

Every hit also tops up the boost meter, and a wrecked car tops it up more.

## Ratings

| Rating | Damage |
| --- | --- |
| – Fender bender | under $25,000 |
| D Nuisance | $25,000 |
| C Vandal | $60,000 |
| B Menace | $150,000 |
| A Wrecking ball | $300,000 |
| S Natural disaster | $600,000 |
| ★ Act of God | $1,200,000 |

The best five runs are saved as high scores, with the total damage of every run. The table is on the results screen and in the pause menu during a run.

## Balance

The numbers were checked with a bot that drives the truck at whatever is closest ahead and boosts whenever it can. It doesn't avoid pedestrians. One version prefers cars and the other prefers street furniture:

| Seed | Prefers cars | Prefers furniture |
| --- | --- | --- |
| 4817 | $78,900 (C) | $304,620 (A) |
| 1065425237 | $309,700 (A) | $164,680 (B) |
| 2 | $479,720 (A) | $85,700 (C) |

The bot hit 2 to 6 pedestrians per run and lost the chain each time, which explains most of the spread. A driver who avoids pedestrians should land between B and S. Runs lasted 60 to 72 seconds with takedowns.

Multiplying the whole chain when it ended made long chains grow with the square of their length. With a ×8 cap, the bot reached Act of God on its first run, and one 25-hit chain was worth $900,000. Multiplying each hit as it lands keeps long chains valuable without one chain deciding the run.
