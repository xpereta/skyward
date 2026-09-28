import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as v from '../src/core/vec3.js';

test('add/sub are inverses', () => {
  const a = { x: 1, y: -2, z: 3 }, b = { x: 4, y: 5, z: -6 };
  assert.deepEqual(v.sub(v.add(a, b), b), a);
});

test('dot of orthogonal vectors is 0', () => {
  assert.equal(v.dot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), 0);
});

test('cross product is orthogonal to both inputs and right-handed', () => {
  const a = { x: 1, y: 0, z: 0 }, b = { x: 0, y: 1, z: 0 };
  const c = v.cross(a, b);
  assert.deepEqual(c, { x: 0, y: 0, z: 1 });
  assert.equal(v.dot(c, a), 0);
  assert.equal(v.dot(c, b), 0);
});

test('cross product magnitude equals |a||b|sin(theta)', () => {
  const a = { x: 3, y: 0, z: 0 }, b = { x: 0, y: 4, z: 0 };
  assert.equal(v.length(v.cross(a, b)), 12);
});

test('normalize yields unit length', () => {
  const n = v.normalize({ x: 3, y: 4, z: 0 });
  assert.ok(Math.abs(v.length(n) - 1) < 1e-9);
});

test('normalize of near-zero vector returns zero (no NaN)', () => {
  const n = v.normalize({ x: 1e-12, y: 0, z: 0 });
  assert.deepEqual(n, { x: 0, y: 0, z: 0 });
});

test('scale and dot distribute', () => {
  const a = { x: 1, y: 2, z: 3 };
  assert.equal(v.dot(v.scale(a, 2), a), 2 * v.dot(a, a));
});

test('lerp endpoints and midpoint', () => {
  const a = { x: 0, y: 0, z: 0 }, b = { x: 10, y: -4, z: 6 };
  assert.deepEqual(v.lerp(a, b, 0), a);
  assert.deepEqual(v.lerp(a, b, 1), b);
  assert.deepEqual(v.lerp(a, b, 0.5), { x: 5, y: -2, z: 3 });
});

test('functions do not mutate inputs', () => {
  const a = { x: 1, y: 2, z: 3 }, copy = { ...a };
  v.add(a, a); v.scale(a, 5); v.normalize(a); v.lerp(a, a, 0.5);
  assert.deepEqual(a, copy);
});
