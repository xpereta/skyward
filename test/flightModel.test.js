import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlightState, step, FLIGHT_CONST } from '../src/core/flightModel.js';

const SPAWN = { pos: { x: 0, y: 500, z: -1000 }, heading: Math.PI };
const NO_INPUT = { throttleDelta: 0, pitch: 0, roll: 0, yaw: 0 };

function fly(state, input, seconds, dt = 1 / 60) {
  let s = state;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) s = step(s, input, dt);
  return s;
}

test('createFlightState starts at cruise speed along spawn heading', () => {
  const s = createFlightState(SPAWN);
  assert.ok(Math.abs(s.speed - 90) < 1e-6);
  // heading PI -> forward points +z
  assert.ok(s.vel.z > 80 && Math.abs(s.vel.x) < 1e-6);
});

test('step is deterministic: same state+input+dt => identical output', () => {
  let a = createFlightState(SPAWN), b = createFlightState(SPAWN);
  const input = { throttleDelta: 0.5, pitch: 0.3, roll: -1, yaw: 0 };
  for (let i = 0; i < 120; i++) {
    a = step(a, input, 1 / 60);
    b = step(b, input, 1 / 60);
  }
  assert.deepEqual(a, b);
});

test('step does not mutate its input state', () => {
  const s = createFlightState(SPAWN);
  const frozen = JSON.parse(JSON.stringify(s));
  step(s, NO_INPUT, 1 / 60);
  assert.deepEqual(s, frozen);
});

test('throttle up increases speed; throttle down decreases it', () => {
  const s0 = createFlightState(SPAWN);
  const fast = fly(s0, { ...NO_INPUT, throttleDelta: 1 }, 3);
  const slow = fly(s0, { ...NO_INPUT, throttleDelta: -1 }, 3);
  assert.ok(fast.speed > s0.speed, `fast ${fast.speed} should exceed ${s0.speed}`);
  assert.ok(slow.speed < s0.speed, `slow ${slow.speed} should be below ${s0.speed}`);
});

test('throttle clamps to [0,1]', () => {
  const hi = fly(createFlightState(SPAWN), { ...NO_INPUT, throttleDelta: 1 }, 30);
  assert.equal(hi.throttle, 1);
  const lo = fly(createFlightState(SPAWN), { ...NO_INPUT, throttleDelta: -1 }, 30);
  assert.equal(lo.throttle, 0);
});

test('stall triggers below STALL_SPEED and recovers above STALL_RECOVERY_SPEED', () => {
  // bleed speed with full reverse throttle until stalled
  let s = createFlightState(SPAWN);
  s = fly(s, { ...NO_INPUT, throttleDelta: -1 }, 6);
  assert.ok(s.speed < FLIGHT_CONST.STALL_SPEED + 5, `expected low speed, got ${s.speed}`);
  // keep coasting (no thrust) — should eventually stall
  let stalledSeen = false;
  for (let i = 0; i < 60 * 10 && !stalledSeen; i++) {
    s = step(s, NO_INPUT, 1 / 60);
    if (s.stalled) stalledSeen = true;
  }
  assert.ok(stalledSeen, 'aircraft should stall when speed drops below STALL_SPEED');

  // recovery: full throttle + pitch down until unstalled
  let recovered = false;
  for (let i = 0; i < 60 * 20 && !recovered; i++) {
    s = step(s, { ...NO_INPUT, throttleDelta: 1, pitch: -1 }, 1 / 60);
    if (!s.stalled) recovered = true;
  }
  assert.ok(recovered, 'aircraft should recover from stall with thrust + nose down');
});

test('stall forces the nose down toward the dive limit', () => {
  let s = createFlightState(SPAWN);
  // bleed speed until stalled
  s = fly(s, { ...NO_INPUT, throttleDelta: -1 }, 6);
  for (let i = 0; i < 60 * 5 && !s.stalled; i++) s = step(s, NO_INPUT, 1 / 60);
  assert.ok(s.stalled, 'should be stalled');

  // isolate the mechanism: level the nose while still stalled, then release.
  // The stall's forced nose-down must drive pitch negative again (and only to the limit).
  s = Object.assign({}, s, { attitude: { pitch: 0, roll: 0, yaw: s.attitude.yaw } });
  const after = fly(s, NO_INPUT, 1);
  assert.ok(after.stalled, 'still stalled during the observation window');
  assert.ok(after.attitude.pitch < -0.3, `stall should drive the nose down from level, got ${after.attitude.pitch}`);
  // saturates at (not beyond) the dive limit — no full rotations
  assert.ok(after.attitude.pitch >= -FLIGHT_CONST.PITCH_LIMIT - 1e-6,
    `pitch must not exceed dive limit, got ${after.attitude.pitch}`);
});

test('left and right bank inputs curve in the matching world-space direction', () => {
  const s0 = createFlightState(SPAWN); // heading PI points along +z
  const left = fly(s0, { ...NO_INPUT, roll: 1 }, 1);
  const right = fly(s0, { ...NO_INPUT, roll: -1 }, 1);
  assert.ok(left.attitude.roll > 0.5, 'positive roll should hold a left bank');
  assert.ok(right.attitude.roll < -0.5, 'negative roll should hold a right bank');
  assert.ok(left.pos.x < s0.pos.x, `left bank should curve toward -x from +z, got x=${left.pos.x}`);
  assert.ok(right.pos.x > s0.pos.x, `right bank should curve toward +x from +z, got x=${right.pos.x}`);
});

test('direct yaw inputs curve left/right from the spawn heading', () => {
  const s0 = createFlightState(SPAWN); // heading PI points along +z
  const left = fly(s0, { ...NO_INPUT, yaw: 1 }, 1);
  const right = fly(s0, { ...NO_INPUT, yaw: -1 }, 1);
  assert.ok(left.pos.x < s0.pos.x, `left yaw input should curve toward -x, got x=${left.pos.x}`);
  assert.ok(right.pos.x > s0.pos.x, `right yaw input should curve toward +x, got x=${right.pos.x}`);
});

test('pitch input changes pitch attitude', () => {
  const s0 = createFlightState(SPAWN);
  const up = fly(s0, { ...NO_INPUT, pitch: 1 }, 1.5);
  assert.ok(up.attitude.pitch > 0.3, `pitch up should raise nose, got ${up.attitude.pitch}`);
});

test('wings level when roll input released (arcade stability)', () => {
  let s = fly(createFlightState(SPAWN), { ...NO_INPUT, roll: 1 }, 2);
  assert.ok(Math.abs(s.attitude.roll) > 0.5);
  s = fly(s, NO_INPUT, 3);
  assert.ok(Math.abs(s.attitude.roll) < 0.15, `roll should decay to level, got ${s.attitude.roll}`);
});

test('position integrates velocity over time', () => {
  const s0 = createFlightState(SPAWN);
  const s1 = fly(s0, NO_INPUT, 2);
  assert.ok(Math.abs(s1.pos.z - (s0.pos.z + 90 * 2)) < 30, 'should travel roughly speed*dt forward');
});
