// core/worldGen.js — deterministic world generation: terrain heightfield + ordered gate chain.
// Same seed always produces an identical world (deep-equal). No unseeded randomness.

import { add, scale } from './vec3.js';

// --- seeded PRNG (mulberry32) ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- deterministic value noise on a periodic (toroidal) grid: bilinear + smoothstep ---
// Periodic in both axes, so fbm's modulo-wrapped octaves stay continuous everywhere.
function makeNoise(rng, gridSize = 24) {
  const grid = new Float32Array(gridSize * gridSize);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  function smooth(t) { return t * t * (3 - 2 * t); }
  // sample at normalized coords u,v in [0,1] -> [0,1]; wraps periodically
  function sample(u, v) {
    u = ((u % 1) + 1) % 1;
    v = ((v % 1) + 1) % 1;
    const gu = u * gridSize, gv = v * gridSize;
    const x0 = Math.floor(gu), y0 = Math.floor(gv);
    const fx = smooth(gu - x0), fy = smooth(gv - y0);
    const a = grid[(y0 % gridSize) * gridSize + (x0 % gridSize)];
    const b = grid[(y0 % gridSize) * gridSize + ((x0 + 1) % gridSize)];
    const c = grid[((y0 + 1) % gridSize) * gridSize + (x0 % gridSize)];
    const d = grid[((y0 + 1) % gridSize) * gridSize + ((x0 + 1) % gridSize)];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  // fractal brownian motion: octaves of the same grid at increasing frequency.
  // freq growth kept gentle (1.6x) so high-frequency detail stays low-amplitude and
  // slopes remain flyable rather than cliff-like.
  function fbm(u, v, octaves = 3) {
    let val = 0, amp = 1, freq = 1, sum = 0;
    for (let o = 0; o < octaves; o++) {
      // deterministic per-octave offset so octaves differ without extra rng state
      const ou = ((u * freq + o * 0.37) % 1 + 1) % 1;
      const ov = ((v * freq + o * 0.61) % 1 + 1) % 1;
      val += sample(ou, ov) * amp;
      sum += amp;
      amp *= 0.5; freq *= 1.6;
    }
    return val / sum; // [0,1]
  }
  return { fbm };
}

export const WORLD_CONST = Object.freeze({
  SIZE: 4000,            // world extent in meters (centered on origin)
  MOUNTAIN_HEIGHT: 320,  // max terrain elevation
  WATER_LEVEL: -18,      // below this is water
  GATE_COUNT: 12,        // gates in a Gate Run
  GATE_RADIUS: 45,       // meters
  MIN_GATE_CLEARANCE: 50,// required clearance above terrain (meters)
});

export function generateWorld(seed) {
  const rng = mulberry32(Math.floor(seed));
  const noise = makeNoise(rng);
  const { SIZE, MOUNTAIN_HEIGHT } = WORLD_CONST;
  const half = SIZE / 2;

  // terrain: ridged-ish mountains with a flatter corridor near the spawn axis
  function heightAt(x, z) {
    const u = (x + half) / SIZE, v = (z + half) / SIZE;
    let h = noise.fbm(u, v, 3);
    // sharpen peaks mildly: push distribution toward extremes without steepening slopes too much
    h = Math.pow(h, 1.35);
    let elev = -30 + h * MOUNTAIN_HEIGHT;
    // flatten a corridor along the gate path (z axis) so runs are flyable
    const corridor = Math.exp(-(x * x) / (2 * 500 * 500));
    elev *= (1 - 0.75 * corridor);
    return elev;
  }

  // --- gates: ordered chain snaking across the world ---
  const gates = [];
  const n = WORLD_CONST.GATE_COUNT;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const z = -half + 400 + t * (SIZE - 800);           // spread along z with margins
    const x = Math.sin(t * Math.PI * 2.5) * 900;        // snake across x
    let y = heightAt(x, z) + WORLD_CONST.MIN_GATE_CLEARANCE + 60 + rng() * 120;
    gates.push({ pos: { x, y, z }, radius: WORLD_CONST.GATE_RADIUS });
  }

  const spawnPos = { x: 0, y: heightAt(0, -half + 300) + 80, z: -half + 300 };

  return {
    seed: Math.floor(seed),
    size: SIZE,
    waterLevel: WORLD_CONST.WATER_LEVEL,
    heightAt,
    gates,
    // gates lie toward +z from spawn; flightModel forward(yaw=PI) points +z
    spawn: { pos: spawnPos, heading: Math.PI },
    bounds: { size: SIZE },
  };
}
