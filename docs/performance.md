# Performance

The city is streamed in 160 m blocks around the car. High has 49 detailed blocks (7×7), Balanced and Smooth have 25 (5×5), and Basic has 9 (3×3). Simpler skyline blocks fill in for four blocks past the detailed area.

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

In VR the shadows cover the area around the headset in every direction. Standalone headsets like the Meta Quest use a 1024 map, 50 m and no small objects. Headsets on a dedicated graphics card use a 2048 map and 90 m.

## Rendering

- The island-wide ground, roads and quay walls are split into 480 m tiles so the parts off screen can be culled.
- A whole block is hidden when it's outside both the camera and the sun's shadow area. Skyline blocks that are out of range or under a detailed block are removed from the scene.
- Detailed blocks instance their scenery (trees, lamps, benches, bins, signals, stops and small roof parts). Small batches of up to 32 instances that share a material merge into one mesh, up to 18,000 vertices per block. `blockBatches()` lists a block's batches.
- Parked cars share the traffic cars' bodies and ten-sided tyres, at 568–640 triangles each. Pedestrians, signal lights, boats and water stay instanced because they change after building.
- Residents, taxi passengers and the walking player share one 620-triangle, 693-vertex model. Outfits, hair and hats, faces and bags are morph targets of it, mixed per person, with one instanced draw per resident chunk and no textures. Each vertex reads only its own part's shape, and shadows use the same shortcut. A head turning to watch a passing car costs one number per resident each frame.
- Static matrices are cached. Off-screen objects skip updates until they're visible again, except traffic signals. Collision checks skip blocks that are too far away before checking individual colliders.
- Perspective cameras stop drawing one metre past the point where the fog is fully opaque.
- Loading compiles every shader before the first frame, including stand-ins for things that aren't on screen yet, like fare markers. Compiling a shader mid-drive stalls a phone for 50–200 ms.
- Each shadow caster has its own depth material, so the shadow pass never has to build a new shader. Each traffic car casts its shadow in one draw.
- The HUD and minimap only write to the page when something changed.

## Streaming

The 3×3 blocks around the car are needed for collision, so they're built straight away after a jump (the start, a reset or a new route) or when the car gets within 80 m of a block. Everything else is built in the background with a 3 ms budget per frame, and blocks aren't added to the scene until they're finished.

Blocks the car leaves are kept in a spare cache, up to 2 × (2r + 1) blocks for a detail radius r. Spare frame time is used to build the next ring of blocks ahead of the car, so crossing into a new block usually doesn't need to build anything.

## Night Lighting

Streetlamps and headlights light the ground with textured patches instead of real lights. There are four instanced draws (lamp pools, headlight beams, lamp lenses and glowing halos) using three 64×64 masks. They're limited to 96 lamps and 25 headlights within 145 m. The patches fade with the weather and are hidden in daylight.

They only light flat ground, so there's no lighting on walls, no occlusion and no extra shadows. They're left out of the ambient occlusion pass.

Run `node scripts/night-lighting-test.mjs` with the dev server running to check the cameras, switching between day and night, shader errors and draw counts. `node scripts/lighting-review.mjs .artifacts/lighting-review` takes night and storm screenshots in three districts.

## Tests

With the dev server running:

```sh
npm run test:smoke
```

The smoke test uses seed 4817 at 1280×800 and reports a rough frame rate after a short drive. Set `TEST_URL` or `CHROME_PATH` to change the server or browser. Screenshots go to `.artifacts/smoke/`.

The browser checks cover ambient occlusion loading and unloading, all cameras, streaming, origin rebasing, screen sizes and density overrides. Unit tests run with `npm test`.

Timings are recorded with Chromium's software renderer, so they're only useful for comparing builds on the same machine. They don't predict frame rates on phones.
