import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, WORLD_CONST, DEFAULT_CONFIG, WORLD_PRESETS, listWorlds } from '../src/core/worldGen.js';

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

// --- world presets (configurable terrain) -----------------------------------------

test('no-config world is byte-identical to the original hardcoded behavior', () => {
  // Reference values captured from the pre-preset module at seed 31337.
  const w = generateWorld(31337);
  assert.deepEqual(w.spawn.pos, { x: 0, y: 91.77532175065616, z: -1700 });
  assert.equal(w.gates.length, 12);
  assert.deepEqual(w.gates[0].pos, { x: 0, y: 234.29087766286258, z: -1600 });
  assert.deepEqual(w.gates[w.gates.length - 1].pos, { x: 900, y: 285.5395802935285, z: 1600 });
  const ref = [[0, 0, 10.586814], [500, -1200, 49.514277], [-900, 800, 79.811847],
               [1500, 1500, 63.691691], [-2000, 2000, 88.932017]];
  for (const [x, z, h] of ref) {
    assert.ok(Math.abs(w.heightAt(x, z) - h) < 1e-4, `heightAt(${x},${z}) drifted from original`);
  }
});

test('each preset is deterministic: same seed+config twice → identical world', () => {
  for (const id of Object.keys(WORLD_PRESETS)) {
    const a = generateWorld(777, WORLD_PRESETS[id]);
    const b = generateWorld(777, WORLD_PRESETS[id]);
    assert.equal(a.seed, b.seed);
    assert.deepEqual(a.gates.map(g => ({ ...g.pos })), b.gates.map(g => ({ ...g.pos })));
    for (let x = -1500; x <= 1500; x += 750) {
      for (let z = -1500; z <= 1500; z += 750) {
        assert.equal(a.heightAt(x, z), b.heightAt(x, z));
      }
    }
  }
});

test('different seeds produce different terrain within a preset', () => {
  for (const id of Object.keys(WORLD_PRESETS)) {
    const a = generateWorld(101, WORLD_PRESETS[id]);
    const b = generateWorld(202, WORLD_PRESETS[id]);
    let diffs = 0;
    for (let x = -1500; x <= 1500; x += 375) {
      for (let z = -1500; z <= 1500; z += 375) {
        if (a.heightAt(x, z) !== b.heightAt(x, z)) diffs++;
      }
    }
    assert.ok(diffs > 8, `preset ${id}: seeds should differ, only ${diffs} samples differed`);
  }
});

test('every preset keeps flyability invariants (clearances, ordering, bounds)', () => {
  for (const id of Object.keys(WORLD_PRESETS)) {
    const w = generateWorld(31337, WORLD_PRESETS[id]);
    // spawn clearance
    assert.ok(w.spawn.pos.y - w.heightAt(w.spawn.pos.x, w.spawn.pos.z) > 40,
      `${id}: spawn too close to terrain`);
    // gate clearances + ordering + bounds
    const half = WORLD_CONST.SIZE / 2;
    for (let i = 0; i < w.gates.length; i++) {
      const g = w.gates[i];
      assert.ok(g.pos.y - w.heightAt(g.pos.x, g.pos.z) >= WORLD_CONST.MIN_GATE_CLEARANCE,
        `${id}: gate ${i} clearance too small`);
      if (i > 0) assert.ok(g.pos.z > w.gates[i - 1].pos.z, `${id}: gates must be ordered along z`);
      assert.ok(Math.abs(g.pos.x) < half && Math.abs(g.pos.z) < half, `${id}: gate out of bounds`);
    }
  }
});

test('presets are visually distinct: islands mostly sea, alpine mostly land', () => {
  function waterFraction(w) {
    let below = 0, total = 0;
    for (let x = -2000; x <= 2000; x += 100) {
      for (let z = -2000; z <= 2000; z += 100) {
        total++;
        if (w.heightAt(x, z) < w.waterLevel) below++;
      }
    }
    return below / total;
  }
  const islands = waterFraction(generateWorld(31337, WORLD_PRESETS.islands));
  const alpine = waterFraction(generateWorld(31337, WORLD_PRESETS.alpine));
  assert.ok(islands > 0.45, `islands should be mostly sea (got ${islands})`);
  assert.ok(alpine < 0.25, `alpine should be mostly land (got ${alpine})`);
});

test('presets are frozen and listWorlds exposes id/label pairs', () => {
  assert.ok(Object.isFrozen(WORLD_PRESETS));
  for (const id of Object.keys(WORLD_PRESETS)) assert.ok(Object.isFrozen(WORLD_PRESETS[id]));
  assert.ok(Object.isFrozen(DEFAULT_CONFIG));
  const worlds = listWorlds();
  assert.ok(worlds.length >= 3, 'expected at least 3 selectable worlds');
  for (const w of worlds) {
    assert.equal(typeof w.id, 'string');
    assert.equal(typeof w.label, 'string');
    assert.ok(WORLD_PRESETS[w.id], `listWorlds id ${w.id} must exist in WORLD_PRESETS`);
  }
});

test('partial config overrides merge over the named preset deterministically', () => {
  const a = generateWorld(501, { name: 'islands', mountainHeight: 200 });
  const b = generateWorld(501, { name: 'islands', mountainHeight: 200 });
  for (let x = -1000; x <= 1000; x += 500) {
    assert.equal(a.heightAt(x, 300), b.heightAt(x, 300));
  }
  // override must actually change the terrain vs the plain preset
  const plain = generateWorld(501, WORLD_PRESETS.islands);
  let diffs = 0;
  for (let x = -1000; x <= 1000; x += 250) {
    if (a.heightAt(x, 300) !== plain.heightAt(x, 300)) diffs++;
  }
  assert.ok(diffs > 4, 'mountainHeight override should alter the terrain');
});
