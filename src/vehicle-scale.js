import * as THREE from 'three';
import { footprintMass } from './impact.js';

// The road cars are modeled chunky: about two meters to the roof on big
// wheels, taller than the people who walk past them and as tall as a front
// door. Each shape says how big it is built against how it is modeled
// (`scale`), so a car's roof comes to a person's shoulder and a street has
// room for it. The trucks, the bus and the aircraft are modeled at their real
// size and keep it.
//
// A shape's model is still built from the numbers it was modeled with
// (see `modeled`), and the finished model is scaled where it joins the scene
// (createCar, createTrafficModels, the parked cars). Everything else (the
// collision box, the door, the driver's eye) reads the sized shape, in meters
// of the street.
export const CAR_SCALE = .8, SLEEK_SCALE = .9;

const KEPT = new Set(['scale', 'mass', 'accel']);
const scaled = (value, k) => typeof value === 'number' ? value * k
  : Array.isArray(value) ? value.map(item => scaled(item, k))
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, KEPT.has(key) ? item : scaled(item, k)]))
      : value;

// A shape at the size it is built, from the shape as modeled. It keeps the
// weight of its modeled footprint: the blows between cars, and what a lamp
// costs one, were tuned for those.
export function sized(shape) {
  const k = shape.scale ?? 1, mass = shape.mass ?? footprintMass(shape.width, shape.length);
  return k === 1 ? { ...shape, scale: 1, mass } : { ...scaled(shape, k), scale: k, mass, modeled: shape };
}
// The shape a model is built from, whichever it is given
export const modeled = shape => shape.modeled ?? shape;
export const scaleOf = shape => shape.scale ?? 1;

// A built model at its shape's size: everything it holds goes into one scaled
// group under its root, so the root keeps the street's meters for whoever
// places it, and the body, wheels and lamps keep the model's.
export function sizeModel(model, scale) {
  if (scale === 1) return model;
  const rig = new THREE.Group(); rig.name = 'rig'; rig.scale.setScalar(scale);
  for (const child of [...model.car.children]) rig.add(child);
  model.car.add(rig);
  return model;
}
