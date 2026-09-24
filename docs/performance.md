# Rendering and streaming

The city keeps an 11×11 block footprint. High has 49 detailed blocks, Balanced and Smooth have 25, and Basic has 9. Distant models fill the rest.

## Rendering

Distant scenery uses fixed 2×2 tiles, instanced by geometry and material. Tiles outside the camera view are culled. Changed tiles reuse buffers where capacity allows; retired buffers are disposed.

Detailed blocks instance each batch of scenery. Batches of up to 32 instances that share a material, draw order and shadow settings merge into one mesh per block, with instance transforms and colours baked into 16-bit normals and colours. These are trees, lamps, benches, bins, signals, stops and small roof parts. A block bakes at most 18,000 vertices: the cheapest groups merge first, and a group too big for what is left merges its cheapest batches, so a busy street corner stays instanced rather than growing the block's memory.

Parked cars share the traffic fleet's bodies with plain six-sided tyres, about 470 triangles each. Walkers, signal lenses, boats and water change after building and stay instanced. `blockBatches()` lists a block's batches either way.

Static matrices are cached. Offscreen residents skip uploads and catch up when visible again; traffic signals keep updating. XR updates all residents. Collision bounds skip irrelevant blocks before checking individual colliders.

| Preset | Maximum pixel ratio | Maximum framebuffer pixels |
| --- | ---: | ---: |
| High | 2 | 3,840,000 |
| Balanced | 1.5 | 2,073,600 |
| Smooth | 1.25 | 1,280,000 |
| Basic | 1 | 640,000 |

An explicit density-slider setting overrides preset caps and saves locally. XR uses its own framebuffer.

Optional ambient occlusion loads on demand and releases its GPU resources when disabled. The offline cache includes its separate bundle.

Perspective cameras clip one metre beyond fully opaque fog. Overhead and XR keep their existing projection ranges.

Loading compiles every program before the first frame: the scene with and without fog, since only perspective views use it, plus stand-ins for shared city materials and fare markers that are not on screen yet. The destination arrow's context is created during loading too. Fare markers reuse one material pair per colour, so their programs survive between fares.

Every shadow caster has its own depth material per variant, so the shadow pass never re-derives a program, and none writes colour, since PCF reads only depth. Each traffic car casts its shadow in one draw: its trim and lamp triangles follow the paint in one buffer, and only the shadow pass draws past the paint.

Smooth and Basic leave the backdrop blur off the 95%-opaque driving HUD. The HUD and minimap compare before writing to the DOM.

## Streaming

Nearby 3×3 collision blocks must be ready immediately. Background construction works toward a soft 3 ms deadline and keeps unfinished blocks outside the scene. Distant models cover deferred detail.

Prefetch caches hold up to five detailed blocks and 21 outer skyline blocks. A separate cache prepares outgoing detailed blocks for distant rendering. Turning away releases unused work. Startup, resets, and teleports can still require synchronous generation.

See [profiling and measurements](performance-overhaul.md) for cache details, buffer reuse, and recorded comparisons.

## Night lighting

Lamps and headlights use glowing lenses and ground patches. Three instanced draws share two 64×64 masks, capped at 96 lamps and 25 headlight patches within 145 m. Patches fade with weather lighting and are hidden in daylight.

They brighten horizontal ground only: no wall lighting, obstacle occlusion, or extra shadows. They stay out of the AO prepass.

Run `node scripts/night-lighting-test.mjs` with a dev server to check cameras, day/night switching, shader errors, and draw counts.

## Benchmarks and tests

With a dev server running:

```sh
npm run test:smoke
```

Set `TEST_URL`, `CHROME_PATH`, or `PERF_LABEL` to change the server, browser, or report folder. Reports go to `.artifacts/performance/<PERF_LABEL>/`.

The smoke test uses seed `4817` at 1280×800 and reports an approximate frame rate after a short drive.

Browser checks cover AO loading/disposal, all cameras, streaming coverage, rebasing, screen sizes, and density overrides. Unit tests run with `npm test`.

Recorded timings use Chromium SwiftShader. They compare builds on the same machine and don't predict phone FPS. Sustained Android/iOS performance, heat, and memory use still need physical-device testing. Individual construction steps and teleports can exceed the streaming budget.
