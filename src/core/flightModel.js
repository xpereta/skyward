// core/flightModel.js — pure aircraft physics step function.
// Same state + input + dt always produces the same output (deterministic).
//
// Model: arcade with light realism. Velocity is always aligned to the nose
// direction (no sideslip), so "lift" is implicit — the jet flies where it points.
// Airspeed (a scalar) is driven by thrust minus quadratic drag, plus/minus gravity
// along the flight path: climbing bleeds airspeed, diving gains it. That single rule
// makes stalling and stall-recovery converge cleanly (dive + throttle to regain speed).

import { add, scale, clone } from './vec3.js';

export const FLIGHT_CONST = Object.freeze({
  MAX_THROTTLE_RATE: 0.5,      // throttle units per second
  THRUST_ACCEL: 42,            // m/s^2 at full throttle
  DRAG_COEFF: 0.0028,          // quadratic drag (m/s^-1); tuned so spawn speed is near equilibrium at default throttle
  GRAVITY: 9.8,                // m/s^2; acts along the flight path via forward.y
  STALL_SPEED: 55,             // m/s — below this, lift insufficient -> stall
  STALL_RECOVERY_SPEED: 70,    // hysteresis: recover above this
  PITCH_RATE: 1.1,             // rad/s at full stick
  ROLL_RATE: 2.2,              // rad/s at full stick
  YAW_RATE: 0.5,               // rad/s direct yaw input
  BANK_TURN_FACTOR: 1.6,       // heading change per rad of bank per second (speed-scaled)
  PITCH_LIMIT: 1.34,           // ~77 deg — clamp so a stall dives instead of spinning
  ROLL_LIMIT: 1.4,             // ~80 deg max bank
  MIN_SPEED: 8,                // m/s floor (arcade: never fully stops in the air)
});

export function forward(attitude) {
  const cp = Math.cos(attitude.pitch), sp = Math.sin(attitude.pitch);
  const cy = Math.cos(attitude.yaw), sy = Math.sin(attitude.yaw);
  return { x: -sy * cp, y: sp, z: -cy * cp }; // pitch up => +y; yaw left (+) turns toward -x
}

// World-space unit nose direction for a given attitude (used by the renderer).
export function noseDirection(attitude) { return forward(attitude); }

export function createFlightState(spawn) {
  const fwd = forward({ pitch: 0, roll: 0, yaw: spawn.heading });
  const speed = 90;
  return {
    pos: clone(spawn.pos),
    vel: scale(fwd, speed),
    speed,
    attitude: { pitch: 0, roll: 0, yaw: spawn.heading },
    throttle: 0.6,
    stalled: false,
    stallTimer: 0,
  };
}

export function step(state, inputSnapshot, dt) {
  const C = FLIGHT_CONST;
  if (dt <= 0) return state;

  // --- throttle ---
  const throttle = Math.min(1, Math.max(0,
    state.throttle + (inputSnapshot.throttleDelta || 0) * C.MAX_THROTTLE_RATE * dt));

  // --- attitude rates ---
  let pitchRate = (inputSnapshot.pitch || 0) * C.PITCH_RATE;
  let rollRate = (inputSnapshot.roll || 0) * C.ROLL_RATE;
  const yawInput = (inputSnapshot.yaw || 0) * C.YAW_RATE;

  if (state.stalled) {
    pitchRate -= 1.4;   // forced nose-down while stalled
    rollRate *= 0.35;   // weakened aileron authority
  }

  let pitch = state.attitude.pitch + pitchRate * dt;
  pitch = Math.max(-C.PITCH_LIMIT, Math.min(C.PITCH_LIMIT, pitch)); // no full rotations

  let roll = state.attitude.roll + rollRate * dt;
  if (!inputSnapshot.roll) roll *= Math.max(0, 1 - 2.5 * dt); // wings level when released
  roll = Math.max(-C.ROLL_LIMIT, Math.min(C.ROLL_LIMIT, roll));

  const speedFactor = Math.min(1, state.speed / 140);
  // Positive yaw input/roll are leftward, but the rendered +Z-forward convention
  // means leftward world rotation increases yaw from the spawn heading (PI).
  let yaw = state.attitude.yaw + (yawInput + roll * C.BANK_TURN_FACTOR * speedFactor) * dt;

  const attitude = { pitch, roll, yaw };
  const fwd = forward(attitude);

  // --- airspeed dynamics along the nose direction ---
  const thrustAccel = throttle * C.THRUST_ACCEL;
  const dragAccel = C.DRAG_COEFF * state.speed * state.speed;
  const gravityAlongNose = -C.GRAVITY * fwd.y; // climbing (fwd.y>0) bleeds speed, diving gains it
  let speed = state.speed + (thrustAccel - dragAccel + gravityAlongNose) * dt;
  speed = Math.max(C.MIN_SPEED, speed);

  const vel = scale(fwd, speed);
  const pos = add(state.pos, scale(vel, dt));

  // --- stall state machine with hysteresis ---
  let stalled = state.stalled;
  if (!stalled && speed < C.STALL_SPEED) {
    stalled = true;
  } else if (stalled && speed > C.STALL_RECOVERY_SPEED) {
    stalled = false;
  }

  return {
    pos, vel, speed, attitude, throttle, stalled,
    stallTimer: stalled ? state.stallTimer + dt : 0,
  };
}
