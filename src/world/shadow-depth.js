import * as THREE from 'three';

// Three.js renders every shadow caster with one shared MeshDepthMaterial, so a
// scene that mixes plain meshes, instanced meshes and per-instance colours
// re-derives that material's program on nearly every shadow draw call. Handing
// each signature its own material lets the renderer keep a cached program.
// The renderer still overwrites side, alphaTest and the maps from the caster's
// own material before drawing, so each variant only has to agree on those.
// Instanced walkers also carry a per-instance morph texture, which is part of
// the program too.
//
// PCF shadows sample the map's depth attachment and never read its colour, so
// the depth pass skips colour writes entirely.
const shadowSide = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
const depthMaterials = new Map();

function depthMaterial(object, material) {
  const side = material.shadowSide ?? shadowSide[material.side] ?? THREE.BackSide;
  const kind = object.isInstancedMesh ? (object.instanceColor ? 'instanced-colored' : 'instanced') + (object.morphTexture ? '-morphed' : '') : 'mesh';
  const morphs = object.geometry.morphAttributes.position?.length ?? 0;
  const key = `${kind}/${side}/${morphs}`;
  let depth = depthMaterials.get(key);
  if (!depth) {
    depth = new THREE.MeshDepthMaterial({ side, colorWrite: false });
    depth.name = `shadow-depth-${key}`;
    depthMaterials.set(key, depth);
  }
  return depth;
}

// Materials that make the renderer clone a depth variant of its own (cutouts,
// displacement, clipped shadows) keep the stock path.
const needsOwnVariant = material => Boolean(material.displacementMap && material.displacementScale !== 0)
  || Boolean(material.alphaMap && material.alphaTest > 0) || Boolean(material.map && material.alphaTest > 0)
  || material.alphaToCoverage === true || (material.clipShadows && material.clippingPlanes?.length);

export function stableShadowDepth(object) {
  if (!object.isMesh || !object.castShadow || object.customDepthMaterial) return;
  const material = object.material;
  if (Array.isArray(material) || needsOwnVariant(material)) return;
  object.customDepthMaterial = depthMaterial(object, material);
}
