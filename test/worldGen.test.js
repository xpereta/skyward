import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, WORLD_CONST } from '../src/core/worldGen.js';

test('same seed produces identical worlds (sampled terrain + gates)', () => {
  const a = generateWorld(1234);
  const b = generateWorld(1234);
  assert.equal(a.seed, b.seed);
  // sample terrain on a grid — must match exactly
  for (let x = -2000; x <= 2000; x += 500) {
    for (let z = -2000; z <= 2000; z += 500) {
      assert.equal(a.heightAt(x, z), b.heightAt(x, z));
    }
  }
  // gates identical
  assert.deepEqual(a.gates.map(g => ({ ...g.pos, radius: g.radius })),
                   b.gates.map(g => ({ ...g.pos, radius: g.radius })));
});

test('different seeds produce different terrain', () => {
  const a = generateWorld(1);
  const b = generateWorld(2);
  let diffs = 0;
  for (let x = -2000; x <= 2000; x += 400) {
    for (let z = -2000; z <= 2000; z += 400) {
      if (a.heightAt(x, z) !== b.heightAt(x, z)) diffs++;
    }
  }
  assert.ok(diffs > 10, `expected terrain to differ between seeds, only ${diffs} samples differed`);
});

test('every gate has at least MIN_GATE_CLEARANCE above local terrain', () => {
  const w = generateWorld(42);
  for (const g of w.gates) {
    const clearance = g.pos.y - w.heightAt(g.pos.x, g.pos.z);
    assert.ok(clearance >= WORLD_CONST.MIN_GATE_CLEARANCE,
      `gate at (${g.pos.x}, ${g.pos.z}) has only ${clearance}m clearance`);
  }
});

test('gates are ordered along the world (monotonic z) and within bounds', () => {
  const w = generateWorld(7);
  assert.equal(w.gates.length, WORLD_CONST.GATE_COUNT);
  for (let i = 1; i < w.gates.length; i++) {
    assert.ok(w.gates[i].pos.z > w.gates[i - 1].pos.z, 'gate z must increase along the chain');
  }
  const half = WORLD_CONST.SIZE / 2;
  for (const g of w.gates) {
    assert.ok(Math.abs(g.pos.x) < half && Math.abs(g.pos.z) < half, 'gates inside world bounds');
  }
});

test('consecutive gates are reachable: horizontal spacing under a sane flight distance', () => {
  const w = generateWorld(99);
  for (let i = 1; i < w.gates.length; i++) {
    const dx = w.gates[i].pos.x - w.gates[i - 1].pos.x;
    const dz = w.gates[i].pos.z - w.gates[i - 1].pos.z;
    const dy = w.gates[i].pos.y - w.gates[i - 1].pos.y;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    assert.ok(d < 900, `gate gap ${d}m too large to fly comfortably`);
  }
});

test('spawn point is above terrain with margin', () => {
  const w = generateWorld(5);
  const clearance = w.spawn.pos.y - w.heightAt(w.spawn.pos.x, w.spawn.pos.z);
  assert.ok(clearance > 40, `spawn only ${clearance}m above ground`);
});

test('heightAt is continuous and slopes stay flyable', () => {
  const w = generateWorld(31337);
  // fine resolution: no discontinuities (a true cliff would jump arbitrarily in 1m)
  let maxJump1 = 0;
  for (let x = -1999; x < 2000; x += 50) {
    for (let z = -1999; z < 2000; z += 50) {
      maxJump1 = Math.max(maxJump1,
        Math.abs(w.heightAt(x + 1, z) - w.heightAt(x, z)),
        Math.abs(w.heightAt(x, z + 1) - w.heightAt(x, z)));
    }
  }
  assert.ok(maxJump1 < 8, `terrain has a ${maxJump1}m discontinuity over 1m`);

  // coarse resolution: bounded gradient — mountains may be steep but not vertical.
  // Measured across seeds: max ~60-70m per 25m; bound leaves margin.
  let maxJump25 = 0;
  for (let x = -1900; x < 1900; x += 25) {
    for (let z = -1900; z < 1900; z += 25) {
      maxJump25 = Math.max(maxJump25,
        Math.abs(w.heightAt(x + 25, z) - w.heightAt(x, z)),
        Math.abs(w.heightAt(x, z + 25) - w.heightAt(x, z)));
    }
  }
  assert.ok(maxJump25 < 75, `terrain slope ${maxJump25}m/25m too steep to fly`);
});

test('world exposes documented shape', () => {
  const w = generateWorld(8);
  assert.equal(typeof w.heightAt, 'function');
  assert.ok(Array.isArray(w.gates));
  assert.ok(w.spawn.pos && typeof w.spawn.heading === 'number');
  assert.equal(w.bounds.size, WORLD_CONST.SIZE);
});
