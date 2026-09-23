import { BufferAttribute } from 'three';

// Index exact duplicates only. Normals, UV seams and vertex colours are part
// of the key, so hard edges, smooth residents and shadow bias stay unchanged.
// Run once on shared static assets, never while streaming or rendering.
export function compactGeometry(geometry) {
  const attributes = Object.entries(geometry.attributes);
  if (geometry.index || !attributes.length || Object.keys(geometry.morphAttributes).length ||
      attributes.some(([, attribute]) => attribute.isInterleavedBufferAttribute || attribute.isInstancedBufferAttribute)) return geometry;
  const count = geometry.attributes.position.count, unique = new Map(), sources = [], indices = [];
  for (let i = 0; i < count; i++) {
    let key = '';
    for (const [, attribute] of attributes) {
      for (let n = 0; n < attribute.itemSize; n++) {
        const value = attribute.array[i * attribute.itemSize + n];
        key += `${Object.is(value, -0) ? '-0' : value},`;
      }
    }
    let index = unique.get(key);
    if (index === undefined) { index = sources.length; unique.set(key, index); sources.push(i); }
    indices.push(index);
  }
  const bytesPerVertex = attributes.reduce((sum, [, attribute]) => sum + attribute.itemSize * attribute.array.BYTES_PER_ELEMENT, 0);
  // Three.js reserves 65535 for primitive restart and selects Uint32 there.
  const indexBytes = sources.length >= 65535 ? 4 : 2;
  if (sources.length * bytesPerVertex + count * indexBytes >= count * bytesPerVertex) return geometry;
  for (const [name, attribute] of attributes) {
    const values = new attribute.array.constructor(sources.length * attribute.itemSize);
    for (let i = 0; i < sources.length; i++) {
      const offset = sources[i] * attribute.itemSize;
      values.set(attribute.array.subarray(offset, offset + attribute.itemSize), i * attribute.itemSize);
    }
    const compact = new BufferAttribute(values, attribute.itemSize, attribute.normalized);
    compact.name = attribute.name; compact.setUsage(attribute.usage); compact.gpuType = attribute.gpuType;
    geometry.setAttribute(name, compact);
  }
  geometry.setIndex(indices);
  return geometry;
}
