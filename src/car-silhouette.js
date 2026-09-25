import * as THREE from 'three';

// Reuse the car's geometry and world matrices: no render targets or building
// queries. Only structures draw before the silhouette; other scenery and the
// normal car draw afterward, so trees and vehicles cannot trigger it.
export class CarSilhouette {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'car-silhouette';
    scene.add(this.group);
    this.material = new THREE.MeshBasicMaterial({
      color: '#506678', depthFunc: THREE.GreaterDepth, depthWrite: false,
      toneMapped: false, fog: false,
    });
    this.parts = new Map();
    // A stand-in compiled with the city before any car is outlined, so the
    // first overhead view does not stall on this program; it is never drawn
    this.warmup = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
    this.showPart = source => {
      const part = this.parts.get(source);
      if (part) part.mesh.visible = source.material.visible !== false;
    };
  }

  update(car, enabled) {
    if (car !== this.car) {
      for (const [source, part] of this.parts) source.renderOrder = part.renderOrder;
      this.parts.clear();
      this.group.clear();
      this.car = car;
      car?.traverse(source => {
        if (!source.isMesh) return;
        const mesh = new THREE.Mesh(source.geometry, this.material);
        mesh.matrixAutoUpdate = false;
        mesh.matrixWorldAutoUpdate = false;
        mesh.matrixWorld = source.matrixWorld;
        mesh.renderOrder = -1;
        mesh.userData.ambientOcclusion = false;
        this.parts.set(source, { mesh, renderOrder: source.renderOrder });
        source.renderOrder = 2;
        this.group.add(mesh);
      });
    }
    this.group.visible = Boolean(enabled && car?.visible);
    if (!this.group.visible) return;
    // Accessories can be hidden by a parent, and wheels animate independently.
    for (const part of this.parts.values()) part.mesh.visible = false;
    car.traverseVisible(this.showPart);
  }
}
