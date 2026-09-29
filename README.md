# Skyward — low-poly arcade flight

A 3D flight simulation game that runs entirely in your browser. Fly a stylized jet over
procedurally generated mountains through a chain of gates (Gate Run) or just enjoy the sky
(Free Flight). Built with Three.js; all game logic is pure, deterministic JavaScript that is
tested headlessly without a browser.

## Play it

**Live:** https://xpereta.github.io/skyward/ (deployed automatically on every push to `main` via GitHub Pages)

Or open `index.html` in any modern browser (double-click works — the only network fetch is
Three.js from a CDN via an import map), or serve the repo:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000/index.html
```

### Controls

| Key | Action |
|---|---|
| W / S (or ↑/↓) | Pitch up / down |
| A / D (or ←/→) | Roll left / right (banked turns) |
| Q / E | Yaw left / right |
| Shift / Ctrl | Throttle up / down |
| C | Toggle chase / cockpit camera |
| R | Restart run |
| M | Back to menu |

### Gameplay

- **Gate Run** — fly through all 12 rings in order. 100 pts per gate (+50 speed bonus above
  160 m/s), 25 for a near miss. Best time is saved locally.
- **Free Flight** — sandbox, no gates, no score pressure.
- **Stalls are real**: below ~55 m/s the jet stalls (red pulsing HUD + banner). Recover by
  pitching down and applying full throttle to trade altitude for airspeed.
- Crashing into terrain or water ends the run; press R to retry.

## Architecture

Modular with hard boundaries: **core modules are pure** — no DOM, no Three.js, no globals.
They exchange plain objects only, so every rule of the game is testable headlessly and can be
mocked in isolation. Only `render/`, `ui/` and `audio/` touch the browser; only `main.js`
knows that all modules exist (composition root).

```
src/
  core/vec3.js         # vector math on plain {x,y,z}
  core/input.js        # input state machine — consumes key-event arrays, never DOM
  core/flightModel.js  # deterministic physics step: thrust/drag/gravity, stall + hysteresis
  core/worldGen.js     # seeded terrain (periodic value noise) + ordered gate chain
  core/gameLogic.js    # modes, scoring, crash/stall events — emits plain events
  render/threeAdapter.js  # ONLY module importing three.js; scene/camera/meshes
  ui/hud.js            # DOM overlay reading plain snapshots
  audio/engineSound.js # WebAudio engine synth (numbers in, sound out)
  main.js              # composition root: rAF loop + fixed 60 Hz timestep accumulator
build.mjs              # bundles src/ into a single self-contained index.html
test/*.test.js         # headless unit tests (node:test, zero dependencies)
tools/browser-smoke.js # optional end-to-end check in real Chromium (needs puppeteer-core)
```

Key contracts: `flightModel.step(state, input, dt) → newState` is a pure function — same
inputs always give the same output. `gameLogic.update(game, flightState, dt)` returns
`{ game, events }` and never renders. The renderer consumes `{ pos, attitude, speed }` and
a gate index; it has no say in scoring or physics.

## Build & test

```sh
./run-tests.sh        # headless unit tests (node --test), zero dependencies
node build.mjs        # regenerate index.html from src/
```

Deployment: `.github/workflows/deploy-pages.yml` rebuilds `index.html` on every push to
`main` and publishes it to GitHub Pages (`xpereta.github.io/skyward`).

Optional browser smoke test (boots the real page in Chromium, flies 8 s, forces a stall,
checks pixels + sim state):

```sh
cd tools && npm install puppeteer-core   # one-time; uses your local Chromium
node browser-smoke.js                    # set CHROME_PATH if it can't auto-detect
```

## Design notes

- **Physics**: velocity is always aligned to the nose (arcade, no sideslip). Airspeed is a
  scalar driven by thrust − quadratic drag ± gravity along the flight path — climbing bleeds
  speed, diving gains it. That single rule makes stalls and recovery converge naturally.
  Pitch is clamped (~77°) so a stall dives instead of spinning; roll self-levels when released.
- **Terrain**: periodic (toroidal) value noise with gentle octave growth, so the heightfield
  is continuous everywhere and slopes stay flyable. A flattened corridor along the gate path
  keeps runs fair. Every gate has ≥50 m terrain clearance by construction.
- **Determinism**: one seeded PRNG (mulberry32); same seed ⇒ identical world. The shipped
  build uses a fixed, hand-checked seed.
