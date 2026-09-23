// Give the Node suite the same reproducible URL seed supported by the browser.
// Set TEST_WORLD_SEED to exercise the complete suite against another world.
globalThis.location = new URL(`http://localhost/?seed=${process.env.TEST_WORLD_SEED ?? 4817}`);
