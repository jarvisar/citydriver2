// Builds the world in Node and prints how long it took and how much it draws.
// node scripts/world-stats.mjs
globalThis.location = new URL('http://localhost/?seed=4817');
const THREE = await import('three');
const t0 = performance.now();
const { CitydriverWorld } = await import('../src/world/citydriver-world.js');
const { journeyStart } = await import('../src/world/city-route.js');
const t1 = performance.now();
const world = new CitydriverWorld(new THREE.Scene());
const t2 = performance.now();
const start = journeyStart();
world.update(start.s, start.u);
while (world.pending.length) world.update(start.s, start.u);
const t3 = performance.now();
let triangles = 0, instances = 0, meshes = 0;
const count = group => group.traverse(o => { if (o.isMesh) { meshes++; const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3; triangles += n * (o.isInstancedMesh ? o.count : 1); if (o.isInstancedMesh) instances += o.count; } });
count(world.staticGroup); const staticTriangles = triangles, staticMeshes = meshes;
count(world.distantGroup); const distantTriangles = triangles - staticTriangles;
for (const c of world.chunks.values()) count(c.group);
console.log({ importMs: Math.round(t1 - t0), constructMs: Math.round(t2 - t1), updateMs: Math.round(t3 - t2), staticTriangles, staticMeshes, distantTriangles, distantChunks: world.distant.size, detailed: world.chunks.size, totalTriangles: triangles, meshes, instances, colliders: [...world.chunks.values()].reduce((n, c) => n + c.features.colliders.length, 0) });
console.log('furniture', [...world.furnitureByChunk.values()].reduce((n, list) => n + list.length, 0), 'bridges', world.bridges.length, 'lots/chunk max', Math.max(...[...world.lotsByChunk.values()].map(l => l.length)));
