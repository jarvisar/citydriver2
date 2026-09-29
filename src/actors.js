import * as THREE from 'three';

let nextId = 1;

export function actorBody(state = {}) {
  return {
    actor: null, car: null, s: state.s ?? 24, u: state.u ?? 2.4, heading: state.heading ?? 0, speed: 0,
    spec: null, profile: null, position: new THREE.Vector3(), previousPosition: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(), previousQuaternion: new THREE.Quaternion(),
    loose: null, rock: null, handbrake: false, index: -1, generation: 0, dazed: 0, moved: false, perch: undefined,
  };
}

// A body keeps its identity and scene root when a different controller takes
// over. Traffic's cheap model and the drivable model are views of that body.
export class Actor {
  constructor(body, { source = 'garage', kind = 'vehicle', model = null, control = 'inactive' } = {}) {
    this.id = nextId++; this.body = body; this.source = source; this.kind = kind; this.control = control;
    this.motion = null; this.home = null; this.disposed = false; this.models = new Map(); this.view = null;
    this.trafficProfile = body.profile;
    this.visual = new THREE.Group(); this.visual.name = model?.car.name ?? 'actor';
    body.actor = this; body.car = this.visual;
    if (model) { this.addModel('traffic', model); this.show('traffic'); }
  }
  get model() { return this.motion?.model; }
  get carId() { return this.motion?.carId ?? this.body.spec.name; }
  get paint() { return this.motion?.paintColor; }
  set paint(value) { this.motion?.setPaint(value); }
  addModel(name, model) {
    if (this.models.has(name)) throw new Error(`Actor ${this.id} already has a ${name} model`);
    this.models.set(name, model); this.visual.add(model.car); model.car.visible = false;
  }
  show(name) {
    const model = this.models.get(name);
    if (!model) throw new Error(`Actor ${this.id} has no ${name} model`);
    this.view = name;
    for (const [key, item] of this.models) item.car.visible = key === name;
    for (const key of Object.keys(this.visual.userData)) delete this.visual.userData[key];
    Object.assign(this.visual.userData, model.car.userData);
    this.visual.name = model.car.name;
    return model;
  }
  transfer(control, parent = null) {
    if (this.disposed) throw new Error(`Actor ${this.id} has been disposed`);
    this.control = control;
    if (parent && this.visual.parent !== parent) parent.add(this.visual);
  }
  returnToTraffic(parent, control = 'traffic') {
    const model = this.show('traffic');
    this.body.spec = model.spec; this.body.profile = this.trafficProfile;
    this.transfer(control, parent);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.control = 'disposed'; this.visual.removeFromParent();
    const motion = this.motion;
    if (motion?.walker?.down) motion.props?.release(motion.walker.down.body);
    for (const model of this.models.values()) model.disposeModel?.();
    this.models.clear();
  }
}
