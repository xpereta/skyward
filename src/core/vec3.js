// core/vec3.js — pure vector math on plain {x,y,z} objects. No mutation of inputs.

export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function scale(v, s) { return { x: v.x * s, y: v.y * s, z: v.z * s }; }
export function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function length(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
export function normalize(v) {
  const l = length(v);
  if (l < 1e-9) return { x: 0, y: 0, z: 0 };
  return scale(v, 1 / l);
}
export function lerp(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}
export function clone(v) { return { x: v.x, y: v.y, z: v.z }; }
