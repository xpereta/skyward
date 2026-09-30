// core/worldGen.js — deterministic world generation: terrain heightfield + ordered gate chain.
// Same seed always produces an identical world (deep-equal). No unseeded randomness.
//
// Worlds are data-driven: WORLD_PRESETS maps a preset id to a plain config object, and
// generateWorld(seed, config) merges that config over DEFAULT_CONFIG. Adding a new world
// is one entry in WORLD_PRESETS — no code changes needed.

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
  // freq growth kept gentle by default so high-frequency detail stays low-amplitude and
  // slopes remain flyable rather than cliff-like (presets may raise it for dunes).
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

// --- world configuration -----------------------------------------------------------
// A config object is plain data; every field optional. generateWorld(seed, config)
// merges it over DEFAULT_CONFIG (shallow — configs are flat). The default below
// reproduces the original hardcoded behavior EXACTLY: same noise call signature,
// same peak exponent 1.35, base -30, corridor sigma 500 / strength 0.75, no falloff.
export const DEFAULT_CONFIG = Object.freeze({
  name: 'alpine',        // display label (menu uses listWorlds() for id/label pairs)
  mountainHeight: WORLD_CONST.MOUNTAIN_HEIGHT,
  waterLevel: WORLD_CONST.WATER_LEVEL,
  octaves: 3,            // fbm octaves (more = finer detail)
  frequencyScale: 1.0,   // multiplies base noise frequency (higher = smaller features)
  peakSharpness: 1.35,   // exponent on the normalized height field (>1 sharpens peaks)
  corridorWidth: 500,    // gaussian sigma of the flyable corridor along the gate path
  corridorStrength: 0.75,// how much terrain is flattened inside the corridor (0..1)
  radialFalloff: false,  // true: edges sink below waterLevel (islands/archipelago look)
  falloffRadius: 2600,   // distance from center where elevation reaches its floor
  falloffFloor: -70,     // elevation at the world edge when radialFalloff is on
  gateCount: WORLD_CONST.GATE_COUNT,
});

// Named worlds. Each entry is a plain config object (frozen); adding a world = one entry.
export const WORLD_PRESETS = Object.freeze({
  alpine: Object.freeze({ ...DEFAULT_CONFIG }),
  islands: Object.freeze({
    name: 'islands',
    mountainHeight: 150,   // low hills — most of the map is sea
    waterLevel: -2,        // high water level → archipelago
    octaves: 3,
    frequencyScale: 1.0,
    peakSharpness: 1.2,    // gentle dune-like crests
    corridorWidth: 500,
    corridorStrength: 0.75,
    radialFalloff: true,   // edges sink to ocean so the world reads as an island chain
    falloffRadius: 2600,
    falloffFloor: -80,
    gateCount: WORLD_CONST.GATE_COUNT,
  }),
  canyon: Object.freeze({
    name: 'canyon',
    mountainHeight: 340,   // tall walls
    waterLevel: -18,
    octaves: 5,            // extra detail for eroded rock
    frequencyScale: 1.6,   // tighter features → narrow ridges and gorges
    peakSharpness: 2.2,    // strong peak sharpening → sharp canyon rims
    corridorWidth: 400,    // narrower flyable slot through the walls
    corridorStrength: 0.75,
    radialFalloff: false,
    gateCount: WORLD_CONST.GATE_COUNT,
  }),
  dunes: Object.freeze({
    name: 'dunes',
    mountainHeight: 120,   // low rolling sand
    waterLevel: -30,       // almost no water — a desert sea of sand
    octaves: 4,            // smooth base + fine ripple detail
    frequencyScale: 0.7,   // long-wavelength swells
    peakSharpness: 1.05,   // nearly round crests (no rocky peaks)
    corridorWidth: 600,    // wide open flight lanes between dunes
    corridorStrength: 0.6,
    radialFalloff: false,
    gateCount: WORLD_CONST.GATE_COUNT,
  }),
});

// Menu helper: enumerate selectable worlds as { id, label } pairs (no internals).
export function listWorlds() {
  return Object.keys(WORLD_PRESETS).map((id) => ({ id, label: WORLD_PRESETS[id].name }));
}

function resolveConfig(config) {
  // Merge a preset/override object over the defaults. Accepts null/undefined (default),
  // or any partial config — including one whose `name` matches a preset id, in which case
  // that preset is used as the base and the given fields override it. Deterministic:
  // same seed + same config → identical world.
  let base = DEFAULT_CONFIG;
  if (config && typeof config === 'object') {
    const preset = WORLD_PRESETS[config.name];
    if (preset) base = preset;
    return Object.freeze({ ...base, ...config });
  }
  return base;
}

export function generateWorld(seed, config) {
  const cfg = resolveConfig(config);
  const rng = mulberry32(Math.floor(seed));
  const noise = makeNoise(rng);
  const { SIZE } = WORLD_CONST;
  const half = SIZE / 2;

  // terrain: fbm mountains shaped by the config, with a flatter corridor near the gate path
  function heightAt(x, z) {
    const u = ((x + half) / SIZE) * cfg.frequencyScale;
    const v = ((z + half) / SIZE) * cfg.frequencyScale;
    let h = noise.fbm(u, v, cfg.octaves);
    // sharpen peaks: push distribution toward extremes without steepening slopes too much
    h = Math.pow(h, cfg.peakSharpness);
    let elev = -30 + h * cfg.mountainHeight;
    if (cfg.radialFalloff) {
      // sink the world edges to falloffFloor so borders read as open ocean
      const d = Math.sqrt(x * x + z * z) / cfg.falloffRadius;
      const f = 1 - Math.exp(-d * d);
      elev += (cfg.falloffFloor - elev) * f;
    }
    // flatten a corridor along the gate path (z axis) so runs are flyable
    const sigma = cfg.corridorWidth;
    const corridor = Math.exp(-(x * x) / (2 * sigma * sigma));
    elev *= (1 - cfg.corridorStrength * corridor);
    return elev;
  }

  // --- gates: ordered chain snaking across the world ---
  const gates = [];
  const n = cfg.gateCount;
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
    waterLevel: cfg.waterLevel,
    heightAt,
    gates,
    // gates lie toward +z from spawn; flightModel forward(yaw=PI) points +z
    spawn: { pos: spawnPos, heading: Math.PI },
    bounds: { size: SIZE },
  };
}
