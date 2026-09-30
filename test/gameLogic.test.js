import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, update, GAME_CONST } from '../src/core/gameLogic.js';

// minimal fake world for logic tests (no real terrain needed unless testing crash)
function makeWorld(gates, heightAt = () => -1000, waterLevel = -500) {
  return { gates, heightAt, waterLevel };
}

const FLIGHT = (pos, speed = 90, stalled = false) => ({ pos, vel: { x: 0, y: 0, z: speed }, speed, attitude: { pitch: 0, roll: 0, yaw: Math.PI }, throttle: 0.6, stalled, stallTimer: 0 });

test('unknown mode throws', () => {
  assert.throws(() => createGame('dogfight', null));
});

test('ready -> flying on first update; time accumulates', () => {
  let g = createGame('freeFlight', makeWorld([]));
  assert.equal(g.phase, 'ready');
  const r1 = update(g, FLIGHT({ x: 0, y: 500, z: 0 }), 1 / 60);
  assert.equal(r1.game.phase, 'flying');
  const r2 = update(r1.game, FLIGHT({ x: 0, y: 500, z: 1 }), 1 / 60);
  assert.ok(Math.abs(r2.game.time - 2 / 60) < 1e-9);
});

test('passing a gate in order awards base score and advances nextGate', () => {
  const gates = [{ pos: { x: 0, y: 500, z: 100 }, radius: 45 }];
  let g = createGame('gateRun', makeWorld(gates));
  // fly through the gate center
  const r = update(g, FLIGHT({ x: 0, y: 500, z: 100 }), 1 / 60);
  assert.equal(r.game.nextGate, 1);
  assert.equal(r.game.score, GAME_CONST.GATE_BASE_SCORE);
  assert.ok(r.events.some(e => e.type === 'gatePassed' && e.index === 0));
  assert.ok(r.events.some(e => e.type === 'scoreChanged'));
});

test('speed bonus applies above threshold', () => {
  const gates = [{ pos: { x: 0, y: 500, z: 100 }, radius: 45 }];
  let g = createGame('gateRun', makeWorld(gates));
  const r = update(g, FLIGHT({ x: 0, y: 500, z: 100 }, 200), 1 / 60);
  assert.equal(r.game.score, GAME_CONST.GATE_BASE_SCORE + GAME_CONST.SPEED_BONUS_MAX);
});

test('out-of-order gates are ignored (must pass gate 0 first)', () => {
  const gates = [
    { pos: { x: 0, y: 500, z: 100 }, radius: 45 },
    { pos: { x: 0, y: 500, z: 300 }, radius: 45 },
  ];
  let g = createGame('gateRun', makeWorld(gates));
  // fly through gate 1's position while nextGate is still 0
  const r = update(g, FLIGHT({ x: 0, y: 500, z: 300 }), 1 / 60);
  assert.equal(r.game.nextGate, 0, 'gate 1 must not count before gate 0');
  assert.equal(r.game.score, 0);
});

test('near-miss awards once within 2x radius and does not advance the chain', () => {
  const gates = [{ pos: { x: 0, y: 500, z: 100 }, radius: 45 }];
  let g = createGame('gateRun', makeWorld(gates));
  // 60m from center: inside 2x radius (90), outside gate (45)
  const r1 = update(g, FLIGHT({ x: 60, y: 500, z: 100 }), 1 / 60);
  assert.equal(r1.game.score, GAME_CONST.NEAR_MISS_SCORE);
  assert.equal(r1.game.nextGate, 0, 'near-miss must not advance the chain');
  // second pass at same spot: no double award
  const r2 = update(r1.game, FLIGHT({ x: 60, y: 500, z: 100 }), 1 / 60);
  assert.equal(r2.game.score, GAME_CONST.NEAR_MISS_SCORE);
});

test('runComplete fires when the last gate is passed', () => {
  const gates = [
    { pos: { x: 0, y: 500, z: 100 }, radius: 45 },
    { pos: { x: 0, y: 500, z: 300 }, radius: 45 },
  ];
  let g = createGame('gateRun', makeWorld(gates));
  const r1 = update(g, FLIGHT({ x: 0, y: 500, z: 100 }), 1 / 60);
  assert.equal(r1.game.phase, 'flying');
  const r2 = update(r1.game, FLIGHT({ x: 0, y: 500, z: 300 }), 1 / 60);
  assert.equal(r2.game.phase, 'complete');
  const done = r2.events.find(e => e.type === 'runComplete');
  assert.ok(done && done.score === r2.game.score);
});

test('terminal states stop updating (no time/score changes)', () => {
  const gates = [{ pos: { x: 0, y: 500, z: 100 }, radius: 45 }];
  let g = createGame('gateRun', makeWorld(gates));
  g = update(g, FLIGHT({ x: 0, y: 500, z: 100 }), 1 / 60).game; // complete
  const before = JSON.parse(JSON.stringify(g));
  const r = update(g, FLIGHT({ x: 999, y: 500, z: 999 }, 300), 1);
  assert.equal(r.game.phase, 'complete');
  assert.deepEqual(r.events, []);
  assert.equal(r.game.time, before.time);
});

test('stall event is edge-triggered (fires once per stall episode)', () => {
  let g = createGame('freeFlight', makeWorld([]));
  const f1 = FLIGHT({ x: 0, y: 500, z: 0 }, 90, true);
  const r1 = update(g, f1, 1 / 60);
  assert.ok(r1.events.some(e => e.type === 'stalled'));
  const r2 = update(r1.game, FLIGHT({ x: 0, y: 500, z: 1 }, 90, true), 1 / 60);
  assert.ok(!r2.events.some(e => e.type === 'stalled'), 'no repeat while still stalled');
  const r3 = update(r2.game, FLIGHT({ x: 0, y: 500, z: 2 }, 90, false), 1 / 60);
  const r4 = update(r3.game, FLIGHT({ x: 0, y: 500, z: 3 }, 90, true), 1 / 60);
  assert.ok(r4.events.some(e => e.type === 'stalled'), 're-fires after recovery');
});

test('crash on terrain collision', () => {
  const w = makeWorld([], (x, z) => 500, -9999); // ground at y=500 everywhere
  let g = createGame('freeFlight', w);
  const r = update(g, FLIGHT({ x: 0, y: 480, z: 0 }), 1 / 60);
  assert.equal(r.game.phase, 'crashed');
  assert.ok(r.events.some(e => e.type === 'crash' && e.reason === 'terrain'));
});

test('crash on water', () => {
  const w = makeWorld([], (x, z) => -9999, -50); // water at y=-50
  let g = createGame('freeFlight', w);
  const r = update(g, FLIGHT({ x: 0, y: -60, z: 0 }), 1 / 60);
  assert.equal(r.game.phase, 'crashed');
  assert.ok(r.events.some(e => e.type === 'crash' && e.reason === 'water'));
});

test('jet at altitude above terrain does NOT crash', () => {
  const w = makeWorld([], (x, z) => 500, -9999); // ground at y=500 everywhere
  let g = createGame('freeFlight', w);
  const r1 = update(g, FLIGHT({ x: 0, y: 600, z: 0 }), 1 / 60);
  assert.equal(r1.game.phase, 'flying');
  assert.ok(!r1.events.some(e => e.type === 'crash'));
  // keep flying above the terrain for several more steps — still no crash
  let g2 = r1.game;
  for (let i = 0; i < 5; i++) {
    g2 = update(g2, FLIGHT({ x: i, y: 600 + i * 10, z: i }), 1 / 60).game;
  }
  assert.equal(g2.phase, 'flying');
});

test('jet driven below terrain heightAt crashes on the next step', () => {
  const w = makeWorld([], (x, z) => 500, -9999); // ground at y=500 everywhere
  let g = createGame('freeFlight', w);
  // first step: safely above terrain -> still flying
  const r1 = update(g, FLIGHT({ x: 0, y: 520, z: 0 }), 1 / 60);
  assert.equal(r1.game.phase, 'flying');
  // next step: driven below heightAt(0,0)=500 -> crash detected on that step
  const r2 = update(r1.game, FLIGHT({ x: 0, y: 480, z: 1 }), 1 / 60);
  assert.equal(r2.game.phase, 'crashed');
  assert.ok(r2.events.some(e => e.type === 'crash' && e.reason === 'terrain'));
});

test('after crash the flight state no longer advances; restart resets to flying', () => {
  const w = makeWorld([], (x, z) => 500, -9999); // ground at y=500 everywhere
  let g = createGame('freeFlight', w);
  g = update(g, FLIGHT({ x: 0, y: 480, z: 0 }), 1 / 60).game; // crash into terrain
  assert.equal(g.phase, 'crashed');

  // further steps are no-ops: time/score/phase frozen, no events (even from below terrain)
  const before = JSON.parse(JSON.stringify(g));
  for (let i = 0; i < 3; i++) {
    const r = update(g, FLIGHT({ x: i * 100, y: -500, z: i * 100 }, 200), 1 / 60);
    assert.equal(r.game.phase, 'crashed');
    assert.deepEqual(r.events, []);
    g = r.game;
  }
  assert.equal(g.time, before.time);
  assert.equal(g.score, before.score);

  // restart: a fresh game in the same mode resets to ready -> flying on first step
  const g2 = createGame('freeFlight', w);
  assert.equal(g2.phase, 'ready');
  assert.equal(g2.score, 0);
  assert.equal(g2.time, 0);
  const r2 = update(g2, FLIGHT({ x: 0, y: 600, z: 0 }), 1 / 60); // back above terrain
  assert.equal(r2.game.phase, 'flying');
});

test('freeFlight never completes and ignores gates', () => {
  const gates = [{ pos: { x: 0, y: 500, z: 100 }, radius: 45 }];
  let g = createGame('freeFlight', makeWorld(gates));
  const r = update(g, FLIGHT({ x: 0, y: 500, z: 100 }), 1 / 60);
  assert.equal(r.game.phase, 'flying');
  assert.equal(r.game.score, 0);
});

test('update with dt<=0 is a no-op', () => {
  const g = createGame('freeFlight', makeWorld([]));
  const r = update(g, FLIGHT({ x: 0, y: 500, z: 0 }), 0);
  assert.deepEqual(r.events, []);
  assert.equal(r.game.time, 0);
});
