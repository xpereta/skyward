// main.js — composition root. The ONLY place that imports all modules and knows they exist.
// Owns the rAF loop, a fixed 60Hz logic timestep (accumulator), and wires:
//   keyboard events -> InputState -> FlightModel.step -> GameLogic.update -> Renderer / Hud / Audio

import { createInput } from './core/input.js';
import { createFlightState, step as flightStep } from './core/flightModel.js';
import { generateWorld, WORLD_PRESETS } from './core/worldGen.js';
import { createGame, update as gameUpdate } from './core/gameLogic.js';
import { createRenderer } from './render/threeAdapter.js';
import { createHud } from './ui/hud.js';
import { createEngineAudio } from './audio/engineSound.js';

const STEP = 1 / 60;          // fixed logic timestep (seconds)
const MAX_FRAME_DT = 0.25;    // clamp long frames (tab switch) to avoid spiral of death
const BEST_KEY = 'skyward.bestTime.gateRun';

function headingDeg(yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // horizontal nose direction
  return ((Math.atan2(fx, fz) * 180 / Math.PI) % 360 + 360) % 360;
}

export function boot({ canvas, container }) {
  // World selection: ?world=<id> picks a terrain preset; falls back to 'alpine'.
  const worldId = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('world')) || 'alpine';
  const worldConfig = WORLD_PRESETS[worldId] || WORLD_PRESETS.alpine;
  const world = generateWorld(31337, worldConfig);   // fixed seed: a known-good flyable layout per world
  const input = createInput();
  let renderer, hud, audio;
  const preserve = typeof location !== 'undefined' && /[?&]debug\b/.test(location.search);
  try {
    renderer = createRenderer(canvas, world, { preserveDrawingBuffer: preserve });
  } catch (e) {
    container.textContent = 'WebGL is not available in this browser.';
    throw e;
  }
  hud = createHud(container);
  audio = createEngineAudio();

  let mode = null;
  let game = null;
  let flightState = null;
  const idleFlight = createFlightState(world.spawn); // shown parked at spawn while in menu
  let cameraMode = 'chase';
  let bestTime = Number(localStorage.getItem(BEST_KEY)) || 0;

  // ---------- menu overlay (main.js is allowed to touch the DOM) ----------
  const menu = document.createElement('div');
  menu.className = 'sw-menu';
  const worldOptions = Object.keys(WORLD_PRESETS)
    .map((id) => `<option value="${id}"${id === worldId ? ' selected' : ''}>${WORLD_PRESETS[id].name}</option>`)
    .join('');
  menu.innerHTML = `
    <h1>SKYWARD</h1>
    <p class="sub">low-poly arcade flight · ${world.gates.length} gates over the mountains</p>
    <label class="sw-world">WORLD <select id="sw-world">${worldOptions}</select></label>
    <button data-mode="gateRun">GATE RUN</button>
    <button data-mode="freeFlight">FREE FLIGHT</button>
    <p class="best" id="sw-best"></p>`;
  container.appendChild(menu);

  // World switch reloads with the new ?world= param (terrain is built at boot).
  menu.querySelector('#sw-world').addEventListener('change', (e) => {
    const url = new URL(location.href);
    url.searchParams.set('world', e.target.value);
    location.href = url.toString();
  });

  function refreshBest() {
    const b = menu.querySelector('#sw-best');
    b.textContent = bestTime > 0 ? `best run: ${bestTime.toFixed(1)}s` : 'no completed runs yet';
  }
  refreshBest();

  function showMenu(show) {
    menu.style.display = show ? '' : 'none';
    if (show && game) hud.hideBanner();
  }

  function startGame(m) {
    mode = m;
    game = createGame(mode, world);
    flightState = createFlightState(world.spawn);
    prevFlightState = null; // no interpolation across a (re)start jump
    cameraMode = 'chase';
    renderer.setCameraMode(cameraMode);
    showMenu(false);
    hud.showBanner(mode === 'gateRun' ? 'GATE RUN — fly through every ring' : 'FREE FLIGHT — enjoy the sky', 2600);
  }

  function restart() {
    if (!mode) return;
    startGame(mode);
  }

  menu.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => { audio.unlock(); startGame(btn.dataset.mode); });
  });

  // ---------- keyboard: feed the pure input state machine + UI keys ----------
  const UI_KEYS = new Set(['KeyC', 'KeyR', 'KeyM']);
  window.addEventListener('keydown', (e) => {
    if (UI_KEYS.has(e.code)) return;               // handled below, not flight input
    e.preventDefault();                            // stop page scroll on arrows/space etc.
    audio.unlock();
    input.update([{ type: 'down', code: e.code }]);
  });
  window.addEventListener('keyup', (e) => {
    if (UI_KEYS.has(e.code)) return;
    input.update([{ type: 'up', code: e.code }]);
  });

  function onUiKey(code) {
    audio.unlock();
    if (code === 'KeyC' && mode) {
      cameraMode = cameraMode === 'chase' ? 'cockpit' : 'chase';
      renderer.setCameraMode(cameraMode);
      hud.showBanner('CAMERA: ' + cameraMode.toUpperCase(), 900);
    } else if (code === 'KeyR') {
      restart();
    } else if (code === 'KeyM') {
      showMenu(true);
    }
  }
  window.addEventListener('keydown', (e) => { if (UI_KEYS.has(e.code)) onUiKey(e.code); });

  // ---------- game events -> presentation ----------
  function handleEvents(events) {
    for (const ev of events) {
      switch (ev.type) {
        case 'gatePassed':
          hud.showBanner(`GATE ${ev.index + 1}/${world.gates.length}`, 900);
          break;
        case 'nearMiss':
          hud.showBanner('NEAR MISS +25', 800);
          break;
        case 'stalled':
          hud.showBanner('STALL — nose down, full throttle!', 1600);
          break;
        case 'runComplete': {
          const isBest = bestTime === 0 || ev.time < bestTime;
          if (isBest) { bestTime = ev.time; localStorage.setItem(BEST_KEY, String(ev.time)); }
          hud.showBanner(`RUN COMPLETE — ${ev.score} pts in ${ev.time.toFixed(1)}s${isBest ? ' · NEW BEST!' : ''}`, 6000);
          break;
        }
        case 'crash':
          // persistent restart prompt (ms=0): stays until R restarts or M opens the menu
          hud.showBanner('CRASHED (' + ev.reason + ') — press R to retry', 0);
          break;
      }
    }
  }

  // ---------- main loop: fixed-timestep logic, per-frame render ----------
  let last = performance.now();
  let acc = 0;
  let prevFlightState = null;   // state before the latest sim step (for render interpolation)

  // Interpolate between two flight states so rendering is smooth on displays
  // faster than the 60Hz logic rate: pos lerps linearly, pitch/roll lerp
  // directly (they are clamped, never wrapped), yaw takes the shortest arc.
  function lerpAngle(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  function renderState(alpha) {
    const cur = flightState || idleFlight;
    const prev = prevFlightState && prevFlightState !== cur ? prevFlightState : cur;
    if (alpha <= 0 || prev === cur) return cur;
    return {
      pos: {
        x: prev.pos.x + (cur.pos.x - prev.pos.x) * alpha,
        y: prev.pos.y + (cur.pos.y - prev.pos.y) * alpha,
        z: prev.pos.z + (cur.pos.z - prev.pos.z) * alpha,
      },
      vel: cur.vel, // not used by the renderer; keep current
      speed: cur.speed,
      attitude: {
        pitch: prev.attitude.pitch + (cur.attitude.pitch - prev.attitude.pitch) * alpha,
        roll: prev.attitude.roll + (cur.attitude.roll - prev.attitude.roll) * alpha,
        yaw: lerpAngle(prev.attitude.yaw, cur.attitude.yaw, alpha),
      },
      throttle: cur.throttle,
      stalled: cur.stalled,
    };
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(MAX_FRAME_DT, (now - last) / 1000);
    last = now;

    if (mode && game && flightState) {
      acc += dt;
      while (acc >= STEP) {
        acc -= STEP;
        prevFlightState = flightState; // remember pre-step state for interpolation
        if (game.phase === 'crashed') continue; // frozen after crash: no flight/logic steps until R restarts
        const snap = input.snapshot();
        flightState = flightStep(flightState, snap, STEP);
        const res = gameUpdate(game, flightState, STEP);
        game = res.game;
        handleEvents(res.events);
      }

      // HUD snapshot (plain numbers only) — real sim state, never interpolated
      hud.update({
        speed: flightState.speed,
        alt: Math.max(0, flightState.pos.y - world.heightAt(flightState.pos.x, flightState.pos.z)),
        headingDeg: headingDeg(flightState.attitude.yaw),
        throttle: flightState.throttle,
        score: game.score,
        time: game.time,
        mode: game.mode,
        phase: game.phase,
        nextGate: game.nextGate,
        gateCount: world.gates.length,
        stalled: flightState.stalled,
      });

      audio.update(flightState.throttle, flightState.speed);
    } else {
      acc = 0; // idle at menu: no logic steps
    }

    renderer.update(
      renderState(Math.min(1, acc / STEP)),
      game ? { nextGate: game.nextGate, phase: game.phase } : null
    );
  }
  requestAnimationFrame(frame);

  // minimal read-only debug/test hook (browser only)
  if (typeof window !== 'undefined') {
    window.__skyward = {
      get flightState() { return flightState; },
      get game() { return game; },
      startGame,
    };
  }

  return { dispose() { audio.dispose(); hud.dispose(); renderer.dispose(); } };
}

// auto-boot when running in a browser with the expected DOM ids
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const canvas = document.getElementById('skyward-canvas');
  const container = document.getElementById('skyward-ui');
  if (canvas && container) boot({ canvas, container });
}
