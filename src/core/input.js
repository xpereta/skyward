// core/input.js — input state machine. Mockable: consumes key-event arrays, never touches DOM.
// Events: { type: 'down' | 'up', code: string } using KeyboardEvent.code values.

const PITCH_UP = ['KeyW', 'ArrowUp'];
const PITCH_DOWN = ['KeyS', 'ArrowDown'];
const ROLL_LEFT = ['KeyA', 'ArrowLeft'];
const ROLL_RIGHT = ['KeyD', 'ArrowRight'];
const YAW_LEFT = ['KeyQ'];
const YAW_RIGHT = ['KeyE'];
const THROTTLE_UP = ['ShiftLeft', 'ShiftRight'];
const THROTTLE_DOWN = ['ControlLeft', 'ControlRight'];

function anyHeld(held, codes) {
  return codes.some((c) => held.has(c));
}

export function createInput() {
  const held = new Set();
  let throttleDelta = 0; // rate of change per second, set from currently-held throttle keys

  function update(events) {
    for (const ev of events || []) {
      if (!ev || !ev.code) continue;
      if (ev.type === 'down') held.add(ev.code);
      else if (ev.type === 'up') held.delete(ev.code);
    }
    throttleDelta = 0;
    if (anyHeld(held, THROTTLE_UP)) throttleDelta += 1;
    if (anyHeld(held, THROTTLE_DOWN)) throttleDelta -= 1;
  }

  function snapshot() {
    let pitch = 0, roll = 0, yaw = 0;
    if (anyHeld(held, PITCH_UP)) pitch += 1;
    if (anyHeld(held, PITCH_DOWN)) pitch -= 1;
    if (anyHeld(held, ROLL_LEFT)) roll += 1;   // positive roll = left bank
    if (anyHeld(held, ROLL_RIGHT)) roll -= 1;
    if (anyHeld(held, YAW_LEFT)) yaw += 1;
    if (anyHeld(held, YAW_RIGHT)) yaw -= 1;
    return { throttleDelta, pitch, roll, yaw };
  }

  function reset() { held.clear(); throttleDelta = 0; }

  return { update, snapshot, reset };
}
