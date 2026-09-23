import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CityChunk, CitydriverWorld, blockBatches } from '../src/world/citydriver-world.js';

// Build a block step by step, keeping hold of its batch list, which the block
// releases once its meshes exist.
function buildWithBatches(ix, iz, world) {
  const chunk = new CityChunk(world, ix, iz, false, true);
  let batches = null;
  while (chunk.construction) {
    batches = chunk.batches ?? batches;
    if (chunk.construction.next().done) chunk.construction = null;
  }
  return { chunk, batches };
}

test('merged furniture reproduces every instance exactly as the instancing shader draws it', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3(), normal = new THREE.Vector3(), expected = new THREE.Vector3();
  const tint = new THREE.Color(), basis = new THREE.Matrix3();
  let merged = 0;
  try {
    for (const [ix, iz] of [[0, 0], [1, 0], [3, 0], [-2, -3], [2, 5], [-4, 1]]) {
      const { chunk, batches } = buildWithBatches(ix, iz, world);
      // Nothing that animates after building is ever merged.
      for (const name of ['residents', 'signal-lens', 'canal-boat', 'water']) {
        const mesh = chunk.group.getObjectByName(`citydriver-${name}`);
        if (batches.get(name)?.items.length) assert.ok(mesh?.isInstancedMesh, `${name} stays instanced`);
      }
      // Every batch is drawn exactly once, instanced or merged.
      const drawn = [...blockBatches(chunk.group)].map(batch => batch.name).sort();
      assert.deepEqual(drawn, [...batches].filter(([, batch]) => batch.items.length).map(([key]) => key).sort());
      for (const mesh of chunk.group.children.filter(child => !child.isInstancedMesh && !child.userData.bodies)) {
        merged++;
        const { position, normal: normals, color } = mesh.geometry.attributes;
        assert.ok(Object.keys(mesh.userData.batches).length > 1, 'a merge saves at least one draw');
        let vertex = 0;
        for (const [key, matrices] of Object.entries(mesh.userData.batches)) {
          const { geometry, items, material, structure } = batches.get(key);
          assert.ok(items.length <= 32);
          assert.equal(mesh.renderOrder, structure ? -2 : 0);
          assert.equal(mesh.material.color.getHex(), material.color.getHex());
          const source = geometry.attributes;
          for (let k = 0; k < items.length; k++) {
            matrix.fromArray(matrices, k * 16);
            const e = matrix.elements;
            const scale = [e[0] ** 2 + e[1] ** 2 + e[2] ** 2, e[4] ** 2 + e[5] ** 2 + e[6] ** 2, e[8] ** 2 + e[9] ** 2 + e[10] ** 2];
            basis.setFromMatrix4(matrix);
            tint.set(items[k].color);
            for (let i = 0; i < source.position.count; i++, vertex++) {
              expected.fromBufferAttribute(source.position, i).applyMatrix4(matrix);
              assert.ok(point.fromBufferAttribute(position, vertex).distanceTo(expected) < 1e-4, `${key} vertex position`);
              expected.fromBufferAttribute(source.normal, i).divide(point.fromArray(scale)).applyMatrix3(basis).normalize();
              assert.ok(normal.fromBufferAttribute(normals, vertex).normalize().dot(expected) > .99999, `${key} vertex normal`);
              const r = (source.color ? source.color.getX(i) : 1) * tint.r, g = (source.color ? source.color.getY(i) : 1) * tint.g;
              const b = (source.color ? source.color.getZ(i) : 1) * tint.b;
              assert.ok(Math.abs(color.getX(vertex) - r) < 1e-4 && Math.abs(color.getY(vertex) - g) < 1e-4 && Math.abs(color.getZ(vertex) - b) < 1e-4, `${key} vertex colour`);
            }
          }
        }
        assert.equal(vertex, position.count);
      }
      chunk.dispose();
    }
    assert.ok(merged > 0, 'ordinary blocks merge their furniture');
  } finally { world.dispose(); }
});

test('merging cuts each block\'s draws without growing its memory much', () => {
  const world = new CitydriverWorld(new THREE.Scene());
  try {
    for (const [ix, iz] of [[0, 0], [1, 0], [-2, -3]]) {
      const { chunk, batches } = buildWithBatches(ix, iz, world);
      const batchCount = [...batches.values()].filter(batch => batch.items.length).length;
      if (batchCount >= 6) assert.ok(chunk.group.children.length <= batchCount - 2, `merging saves draws (${chunk.group.children.length} of ${batchCount})`);
      let bytes = 0;
      for (const mesh of chunk.group.children) if (!mesh.isInstancedMesh && !mesh.userData.bodies) {
        for (const attribute of Object.values(mesh.geometry.attributes)) bytes += attribute.array.byteLength;
        bytes += mesh.geometry.index.array.byteLength;
      }
      assert.ok(bytes < 640 * 1024, `merged geometry stays small (${Math.round(bytes / 1024)} KB)`);
      chunk.dispose();
    }
  } finally { world.dispose(); }
});
