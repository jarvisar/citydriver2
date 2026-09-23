import * as THREE from 'three';

// A tiny transparent canvas in the navigation card. Redraw only when its
// bearing changes; the mesh needs no lights, shadows, textures or effects.
export class DestinationArrow {
  constructor(canvas = null) {
    this.canvas = canvas; this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1.25, 1.25, 1.25, -1.25, .1, 10);
    this.camera.position.z = 5;
    const shape = new THREE.Shape();
    shape.moveTo(0, 1); shape.lineTo(-.75, .15); shape.lineTo(-.3, .15);
    shape.lineTo(-.3, -1); shape.lineTo(.3, -1); shape.lineTo(.3, .15);
    shape.lineTo(.75, .15); shape.closePath();
    this.geometry = new THREE.ExtrudeGeometry(shape, { depth: .22, steps: 1, bevelEnabled: true, bevelSize: .055, bevelThickness: .055, bevelSegments: 1 });
    this.geometry.translate(0, 0, -.11); this.geometry.rotateX(-Math.PI / 2);
    this.geometry.clearGroups();
    const normals = this.geometry.getAttribute('normal'), colors = new Float32Array(normals.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < normals.count; i++) {
      color.set(normals.getY(i) > .9 ? '#b7ff43' : normals.getY(i) > .1 ? '#73bd28' : '#356e20');
      color.toArray(colors, i * 3);
    }
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.group = new THREE.Group(); this.group.name = 'destination-arrow';
    this.group.add(this.mesh); this.group.visible = false; this.scene.add(this.group);
    this.group.rotation.x = .85;
    this.forward = new THREE.Vector3();
  }
  update(run, vehicle, camera) {
    this.group.visible = run.running && run.status === 'driving' && Boolean(run.target);
    if (!this.group.visible) { this.lastAngle = undefined; return; }
    camera.updateMatrixWorld();
    camera.getWorldDirection(this.forward);
    const cameraHeading = Math.atan2(this.forward.x, -this.forward.z);
    const bearing = Math.atan2(run.target.u - vehicle.u, run.target.s - vehicle.s);
    this.mesh.rotation.y = cameraHeading - bearing;
    // The chase camera sways a little every frame. A turn this small moves the
    // arrow's tip by less than a tenth of a pixel, so keep the last frame.
    if (!this.canvas || Math.abs(this.mesh.rotation.y - this.lastAngle) < .004) return;
    this.prepare();
    this.renderer.render(this.scene, this.camera);
    this.lastAngle = this.mesh.rotation.y;
  }
  // Create the context and compile its program while the city loads, rather
  // than stalling the first fare.
  prepare() {
    if (!this.canvas || this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0, 0);
    // At most 104 x 104 pixels, independent of the city's render resolution.
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.setSize(52, 52, false);
    this.renderer.compile(this.scene, this.camera);
  }
  dispose() { this.geometry.dispose(); this.material.dispose(); this.group.removeFromParent(); this.renderer?.dispose(); }
}
