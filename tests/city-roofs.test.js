import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { roofWedge, vaultGeometry } from '../src/world/city-roofs.js';

test('sloped roof infills and vaulted shells are closed solids without degenerate faces', () => {
  for (const geometry of [roofWedge, vaultGeometry]) {
    const points = geometry.attributes.position, edges = new Map();
    const index = geometry.index, count = index?.count ?? points.count;
    const vertex = i => new THREE.Vector3().fromBufferAttribute(points, index ? index.getX(i) : i);
    const key = p => p.toArray().map(v => Math.round(v * 1e6)).join(',');
    for (let i = 0; i < count; i += 3) {
      const a = vertex(i), b = vertex(i + 1), c = vertex(i + 2);
      assert.ok(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() > 1e-8);
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const edge = [key(p), key(q)].sort().join('/'); edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }
    assert.ok([...edges.values()].every(n => n === 2), 'every edge is shared by exactly two faces');
  }
});

