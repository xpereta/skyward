// core/gameLogic.js — game state machine, scoring, mode rules. Emits plain events; never renders.
// Contract: createGame(mode, world) attaches the world to the game object so update() can
// check gates and terrain without extra parameters.

import { sub, length } from './vec3.js';

export const GAME_CONST = Object.freeze({
  GATE_BASE_SCORE: 100,        // per gate passed
  NEAR_MISS_SCORE: 25,         // within 2x radius but not through (once per gate)
  SPEED_BONUS_MAX: 50,         // added when passing a gate above speed threshold
  SPEED_BONUS_THRESHOLD: 160,  // m/s
});

export function createGame(mode, world) {
  if (mode !== 'gateRun' && mode !== 'freeFlight') throw new Error('unknown mode: ' + mode);
  return {
    mode,
    phase: 'ready',            // ready | flying | complete | crashed
    score: 0,
    time: 0,                   // seconds of flight
    nextGate: 0,               // index into world.gates (gateRun only)
    gateResults: [],           // per-gate: {passed, nearMiss}
    world,                     // attached for terrain/gate checks in update()
    stalledWasReported: false, // internal edge-trigger state
  };
}

function distance(a, b) { return length(sub(a, b)); }

export function update(game, flightState, dt) {
  if (dt <= 0) return { game, events: [] };
  const events = [];
  const g = Object.assign({}, game, { gateResults: game.gateResults.slice() });

  // terminal states: no further updates
  if (g.phase === 'complete' || g.phase === 'crashed') return { game: g, events };

  if (g.phase === 'ready') g.phase = 'flying';
  g.time += dt;

  const gates = g.mode === 'gateRun' && g.world ? g.world.gates : [];

  // --- gate chain (in-order only) ---
  while (g.nextGate < gates.length) {
    const gate = gates[g.nextGate];
    const d = distance(flightState.pos, gate.pos);
    if (d <= gate.radius) {
      let pts = GAME_CONST.GATE_BASE_SCORE;
      if (flightState.speed >= GAME_CONST.SPEED_BONUS_THRESHOLD) pts += GAME_CONST.SPEED_BONUS_MAX;
      g.score += pts;
      g.gateResults[g.nextGate] = { passed: true, nearMiss: false };
      events.push({ type: 'gatePassed', index: g.nextGate });
      events.push({ type: 'scoreChanged', value: g.score });
      g.nextGate++;
    } else if (d <= gate.radius * 2) {
      // beside the current gate: award near-miss once, then hold position in the chain
      const rec = g.gateResults[g.nextGate];
      if (!rec || !rec.nearMissAwarded) {
        g.score += GAME_CONST.NEAR_MISS_SCORE;
        g.gateResults[g.nextGate] = Object.assign({ passed: false, nearMiss: true }, rec || {}, { nearMissAwarded: true });
        events.push({ type: 'nearMiss', index: g.nextGate });
        events.push({ type: 'scoreChanged', value: g.score });
      }
      break;
    } else {
      break; // far from current gate — nothing to do this step
    }
  }

  if (g.mode === 'gateRun' && gates.length > 0 && g.nextGate >= gates.length) {
    g.phase = 'complete';
    events.push({ type: 'runComplete', score: g.score, time: g.time });
  }

  // --- stall event (edge-triggered) ---
  if (flightState.stalled && !g.stalledWasReported) {
    events.push({ type: 'stalled' });
    g.stalledWasReported = true;
  } else if (!flightState.stalled) {
    g.stalledWasReported = false;
  }

  // --- crash checks (world attached) ---
  if (g.world) {
    const terrainY = g.world.heightAt(flightState.pos.x, flightState.pos.z);
    if (flightState.pos.y <= terrainY) {
      g.phase = 'crashed';
      events.push({ type: 'crash', reason: 'terrain' });
    } else if (flightState.pos.y < g.world.waterLevel) {
      g.phase = 'crashed';
      events.push({ type: 'crash', reason: 'water' });
    }
  }

  return { game: g, events };
}
