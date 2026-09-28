# Performance

The city is streamed in 160 m blocks around the car. High has 49 detailed blocks (7x7), Balanced and Smooth have 25 (5x5), and Basic has 9 (3x3). Simpler skyline blocks fill in for four blocks past the detailed area.

## Graphics Presets

| Preset | Maximum pixel ratio | Maximum framebuffer pixels |
| --- | ---: | ---: |
| High | 2 | 3,840,000 |
| Balanced | 1.5 | 2,073,600 |
| Smooth | 1.25 | 1,280,000 |
| Basic | 1 | 640,000 |

Setting the density slider manually overrides these limits and is saved locally. VR uses its own framebuffer.

Ambient occlusion (Soft shading) is on by default only on computers with a dedicated graphics card: NVIDIA RTX and GTX 960 or newer, AMD Radeon RX, Pro and VII, Intel Arc A and B, and Apple's Pro, Max and Ultra chips. The computer also has to start on High or Balanced. It stays off on phones, tablets, built-in graphics and anything the browser won't name. Turning it on or off in the Display settings is saved and always wins over the default. If the default slows the frame rate, the game turns it off and remembers that for the next visit. Add `?ao=0` to the URL to start without it.

Soft shading loads behind the loading screen when it's on, and frees its GPU resources when turned off. The offline cache includes it.

Smooth and Basic turn off the background blur behind the driving HUD.

## Shadows

The sun's shadow map covers less ground on the lower presets, so it stays sharp and draws fewer objects.

| Preset | Shadow map | Shadow distance | Small objects cast shadows |
| --- | ---: | ---: | --- |
| High | 2048 (4096 with a dedicated graphics card) | 100 m (140 m) | Yes |
| Balanced | 1536 | 80 m | Yes |
| Smooth | 1024 | 60 m | No |
| Basic | 512 | 45 m | No |

Small objects are people, short street furniture like bins and signs, and the trim on buildings like window frames and sills. Buildings, trees, cars, street lamps and signal poles always cast shadows. Shadows fade out at the edge of the covered area.

Phones and tablets leave small objects out below High. Their shadows are a texel or two wide and don't show on a phone screen, and at Balanced they were about three quarters of the shadow pass's triangles.

In VR the shadows cover the area around the headset in every direction. Standalone headsets like the Meta Quest use a 1024 map, 50 m and no small objects. Headsets on a dedicated graphics card use a 2048 map and 90 m.

## Rendering

- The island-wide ground, roads and quay walls are split into 480 m tiles so the parts off screen can be culled.
- A whole block is hidden when it's outside both the camera and the sun's shadow area. Skyline blocks that are out of range or under a detailed block are removed from the scene.
- Detailed blocks instance their scenery (trees, lamps, benches, bins, signals, stops and small roof parts). Small batches of up to 32 instances that share a material merge into one mesh, up to 18,000 vertices per block. `blockBatches()` lists a block's batches.
- Parked cars share the traffic cars' bodies and ten-sided tyres, at 568-640 triangles each. Pedestrians, signal lights, boats and water stay instanced because they change after building.
- Residents, bus and taxi passengers and the walking player share one 620-triangle, 693-vertex model. Outfits, hair and hats, faces and bags are morph targets of it, mixed per person, with one instanced draw per resident chunk (and one for everyone at the bus stops) and no textures. Each vertex reads only its own part's shape, and shadows use the same shortcut. A head turning to watch a passing car costs one number per resident each frame. The walking player's own copy can also squash its body and move and tilt its head, through three uniforms only its material and shadow read.
- Pigeons are three instanced draws (bodies, and each side's wings) for every bird near the player, with no shadows. Where each bird is comes from the clock and when its flock was last scared, so nothing is stepped. All of it, with speech bubbles and the on-foot checks, costs a few tens of microseconds a frame.
- Static matrices are cached. Off-screen objects skip updates until they're visible again, except traffic signals. Collision checks skip blocks that are too far away before checking individual colliders.
- Perspective cameras stop drawing one metre past the point where the fog is fully opaque. In VR the headset's eyes use the same far plane.
- Blocks and the static streets never move once placed, so the per-frame matrix update skips them. Before this it walked 1,400 to 2,500 objects every frame, most of them skyline blocks hidden by fog.
- Each block's residents are bounded by the loops they walk plus 40 m, instead of a sphere round the whole block and its neighbours. That sphere kept every block's residents drawn and animated, and stopped whole blocks from being culled.
- Window panes don't cast shadows, and in skyline blocks only buildings do.
- Loading compiles every shader before the first frame, including stand-ins for things that aren't on screen yet, like fare markers. Compiling a shader mid-drive stalls a phone for 50-200 ms.
- Loading also uploads every texture, so the 4096 px sign atlas doesn't upload in the first frame that shows a sign.
- Each shadow caster has its own depth material, so the shadow pass never has to build a new shader.
- Each traffic car is one draw, shadow included. Its paint, trim and lamps share one material that paints only the parts marked as paint and lights the lamps from shared uniforms. The player's road cars, taxis and special vehicles draw their body the same way, and road cars and the classic car draw each wheel (tyre and hub) in one draw. That took traffic from four draws a car to one and a taxi from 15 to 8.
- Rain and snow move on the CPU, but snow's sway uses a per-flake table instead of 3,600 `Math.sin` calls a frame (about 150 microseconds down to 28 in Node).
- The HUD and minimap only write to the page when something changed.

## Streaming

The 3x3 blocks around the car are needed for collision, so they're built straight away after a jump (the start, a reset or a new route) or when the car gets within 80 m of a block. Everything else is built in the background with a 3 ms budget per frame, and blocks aren't added to the scene until they're finished.

Blocks the car leaves are kept in a spare cache, up to 2 × (2r + 1) blocks for a detail radius r. Spare frame time is used to build the next ring of blocks ahead of the car, so crossing into a new block usually doesn't need to build anything.

A build step can't be interrupted, so each one has to stay well under the budget. Lots are planned one per step, the lawn fringe stops every 3,000 or so point checks, and the square furniture templates (market stalls, cafes, flower beds, sculptures) are built when the game loads instead of the first time a square streams in. On a desktop no step now takes much over 1 ms. The worst used to be 35 ms, 150 ms or more on a phone.

## Frame Pacing

The simulation runs in fixed 1/120 s steps and the display interpolates between them, so motion stays smooth at any frame rate.

The Frame rate slider in the Display settings caps how often the page draws: Auto, 30, 60, 72, 90, 120, 144 or Uncapped. A browser never draws faster than the display refreshes, so Uncapped means the display's own rate. The choice is saved.

On Auto, a computer with a dedicated graphics card draws at the display's rate. Everything else (phones, tablets, built-in graphics) gets an even share of a fast display near 60: 60 fps on a 120 Hz display and 72 on 144 Hz. Without it the quality controller, which aims for 60, would settle on a level running somewhere between 60 and 120, and those frames arrive at a mix of 8 and 17 ms, which looks like stutter and heats the phone. A 90 Hz display is left alone, since 60 there can only come out as alternating 11 and 22 ms frames.

A cap that divides the display's rate is held exactly (60 on 120 Hz draws every other frame). Any other cap averages out without going over it, so 60 on a 144 Hz display alternates two and three refreshes. The quality controller measures against the cap when it's under 60, so a steady 30 isn't treated as slow.

## VR

Each frame is drawn once for each eye, since three.js's WebGL renderer has no multiview. Draw calls cost the most there, so the headset has its own quality handling:

- The eyes stop drawing at the fog, like the screen's camera does. They used to draw out to 1,200 m, so every skyline block within reach was drawn twice and then covered by fog. On an emulated Quest 3 at Balanced that was about 1,120 draws a frame, now about 410.
- Whole blocks outside the headset's view and the sun's shadow area are hidden, and residents are only animated in blocks the last frame could see.
- Quality steps through its own ladder. A rung is a graphics level (in VR that sets how much of the city is built and the shadows) and a viewport scale, the share of each eye's framebuffer that is drawn. Standalone headsets use Balanced at full scale, Balanced at .85, Basic at .85 and Basic at .7, and start on the second rung. Headsets on a dedicated graphics card start at High. Two slow 1.5 s windows step down a rung, four fast ones step back up, and a rung that proved too slow isn't tried again. A chosen graphics level stays fixed and only the scale changes.
- The framebuffer is still 1.5 times the default and foveation stays off. .7 of each side is about the headset's own resolution.
- The headset's refresh rate is its own setting, Refresh rate in the headset's pause menu. On Auto it asks for 90 Hz, and if even the lowest rung can't hold 90 it drops to 72 and climbs the ladder again there. A rate the player picks is kept.
- The page's street map and fare arrow aren't drawn while the headset is on.

Nothing here has been measured on a real headset yet. The numbers come from Meta's IWER emulator on a desktop, which shows draw calls and CPU time but not the Quest's GPU. Viewport scaling needs Quest Browser 36 or newer and does nothing in the emulator.

## Night Lighting

Streetlamps and headlights light the ground with textured patches instead of real lights. There are four instanced draws (lamp pools, headlight beams, lamp lenses and glowing halos) using three 64x64 masks. They're limited to 96 lamps and 25 headlights within 145 m. The patches fade with the weather and are hidden in daylight.

They only light flat ground, so there's no lighting on walls, no occlusion and no extra shadows. They're left out of the ambient occlusion pass.

Run `node scripts/night-lighting-test.mjs` with the dev server running to check the cameras, switching between day and night, shader errors and draw counts. `node scripts/lighting-review.mjs .artifacts/lighting-review` takes night and storm screenshots in three districts.

## Tests

With the dev server running:

```sh
npm run test:smoke
```

The smoke test uses seed 4817 at 1280x800 and reports a rough frame rate after a short drive. Set `TEST_URL` or `CHROME_PATH` to change the server or browser. Screenshots go to `.artifacts/smoke/`.

The browser checks cover ambient occlusion loading and unloading, all cameras, streaming, origin rebasing, screen sizes and density overrides. Unit tests run with `npm test`.

Timings are recorded with Chromium's software renderer, so they're only useful for comparing builds on the same machine. They don't predict frame rates on phones.
