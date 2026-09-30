// render/threeAdapter.js — the ONLY module that imports three.js (via import map / CDN).
// Consumes a World + FlightState, owns the scene/camera/meshes. Emits nothing; just draws.
import * as THREE from 'three';
import { cross, normalize, scale, add } from '../core/vec3.js';
import { noseDirection } from '../core/flightModel.js';

// Map a physics attitude to an orthonormal world-space body basis {R,U,F}.
// F (nose) reuses the exact physics forward() so visuals always match the sim.
// Roll is applied about the nose axis so banking is visible; pitch/yaw come from F.
function attitudeToBasis(attitude) {
  const F = normalize(noseDirection(attitude));          // world-space nose direction
  const up0 = { x: 0, y: 1, z: 0 };
  let R = cross(up0, F);                                  // right (perp to nose & world-up)
  if (R.x * R.x + R.y * R.y + R.z * R.z < 1e-8) R = { x: 1, y: 0, z: 0 }; // nose ~vertical fallback
  R = normalize(R);
  const U1 = cross(F, R);                                 // level up in vertical plane of F
  const cr = Math.cos(attitude.roll), sr = Math.sin(attitude.roll);
  // Roll is applied as a rotation about the nose axis by -attitude.roll so the
  // canopy always leans INTO the turn: positive roll (left bank, A) tilts the top
  // toward +R; negative roll (right bank, D) tilts it toward -R. (Rotating both
  // U and Rr by the same angle keeps the body basis a proper rotation.)
  const U = add(scale(U1, cr), scale(R, sr));
  const Rr = add(scale(R, cr), scale(U1, -sr));
  return { R: normalize(Rr), U: normalize(U), F };
}

function elevationColor(h, waterLevel) {
  // low-poly stylized bands by altitude
  if (h < waterLevel + 4) return [0.36, 0.52, 0.42];      // shallow sand/grass edge
  if (h < 40) return [0.30, 0.58, 0.30];                  // lowland green
  if (h < 110) return [0.24, 0.47, 0.26];                 // mid forest
  if (h < 190) return [0.45, 0.42, 0.34];                  // rock
  if (h < 250) return [0.58, 0.57, 0.56];                 // high rock
  return [0.93, 0.95, 0.98];                              // snow
}

function buildTerrain(world) {
  const size = world.size;
  const seg = 120;
  let geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);                              // flat on ground: spans X/Z, normal +Y
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, world.heightAt(x, z));
  }
  geo.computeVertexNormals();
  // non-indexed => per-face normals => faceted low-poly look
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  const p2 = geo.attributes.position;
  const colors = new Float32Array(p2.count * 3);
  for (let i = 0; i < p2.count; i++) {
    const c = elevationColor(p2.getY(i), world.waterLevel);
    colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new THREE.Mesh(geo, mat);
}

function buildJet() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 0.35, roughness: 0.5, flatShading: true });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xe2483d, metalness: 0.3, roughness: 0.5, flatShading: true });

  // fuselage: nose toward +Z (local forward)
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.7, 9, 8), bodyMat);
  fus.rotation.x = Math.PI / 2;                            // cylinder axis Y -> Z
  g.add(fus);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.2, 8), accentMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 6.1;
  g.add(nose);

  // main wings (swept boxes)
  const wingGeo = new THREE.BoxGeometry(14, 0.5, 3.4);
  const wingL = new THREE.Mesh(wingGeo, bodyMat); wingL.position.set(-6.2, 0.2, -0.5); wingL.rotation.y = -0.28;
  const wingR = new THREE.Mesh(wingGeo, bodyMat); wingR.position.set(6.2, 0.2, -0.5); wingR.rotation.y = 0.28;
  g.add(wingL, wingR);

  // tail wings + vertical stabilizer
  const tailGeo = new THREE.BoxGeometry(6, 0.4, 1.8);
  const tailL = new THREE.Mesh(tailGeo, accentMat); tailL.position.set(-2.6, 0.3, -4.2);
  const tailR = new THREE.Mesh(tailGeo, accentMat); tailR.position.set(2.6, 0.3, -4.2);
  g.add(tailL, tailR);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.2, 2.2), accentMat);
  fin.position.set(0, 1.8, -4.6);
  g.add(fin);

  // cockpit canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x2b3a55, metalness: 0.6, roughness: 0.2 }));
  canopy.scale.set(1, 0.7, 1.6);
  canopy.position.set(0, 1.0, 1.5);
  g.add(canopy);

  g.scale.setScalar(1.4);
  return g;
}

export function createRenderer(canvas, world, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const skyColor = new THREE.Color(0x9fd3ff);
  scene.background = skyColor;
  scene.fog = new THREE.Fog(skyColor.getHex(), 600, 2600);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 8000);
  camera.position.set(0, world.spawn.pos.y + 30, world.spawn.pos.z - 40);

  // lighting: sky/ground hemisphere + a sun
  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x5a6b4f, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.1);
  sun.position.set(-800, 1200, -600);
  scene.add(sun);

  // terrain + water
  scene.add(buildTerrain(world));
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(world.size * 3, world.size * 3),
    new THREE.MeshLambertMaterial({ color: 0x2f6fb0, transparent: true, opacity: 0.85 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = world.waterLevel;
  scene.add(water);

  // gates: vertical rings oriented along the local path direction
  const gateGroup = new THREE.Group();
  const gateMeshes = [];
  const ringGeo = new THREE.TorusGeometry(1, 0.6, 8, 24);
  for (let i = 0; i < world.gates.length; i++) {
    const g = world.gates[i];
    const prev = i === 0 ? world.spawn.pos : world.gates[i - 1].pos;
    let dir = { x: g.pos.x - prev.x, y: g.pos.y - prev.y, z: g.pos.z - prev.z };
    const dl = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
    dir = scale(dir, 1 / dl);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x224466, flatShading: true });
    const m = new THREE.Mesh(ringGeo, mat);
    m.position.set(g.pos.x, g.pos.y, g.pos.z);
    m.scale.setScalar(g.radius);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dir.x, dir.y, dir.z));
    gateGroup.add(m);
    gateMeshes.push(m);
  }
  scene.add(gateGroup);

  const jet = buildJet();
  scene.add(jet);

  // ---------- crash feedback (renderer-owned clock) ----------
  // The sim is frozen after a crash (main.js stops stepping flightState), so all
  // effects below animate on performance.now() deltas, not sim dt. Triggered by the
  // context contract: update(flightState, { nextGate, phase, crash }). If `phase`
  // is absent (old callers) nothing here ever activates — behavior is identical to
  // before. The renderer records crash.firstSeenAt itself on transition.
  const CRASH = {
    active: false,
    firstSeenAt: 0,      // ms timestamp when the crashed state was first observed
    reason: null,
    impact: new THREE.Vector3(),   // world-space impact point (from flightState.pos)
    targetY: 0,                 // wreck rest height at the crash location
    spinAxis: new THREE.Vector3(),
    spinRate: 0,                // rad/s tumble about spinAxis
    lastNow: performance.now(),
  };

  const DEBRIS_COUNT = 64;
  const debrisGeo = new THREE.BufferGeometry();
  const debrisPos = new Float32Array(DEBRIS_COUNT * 3);
  const debrisVel = new Float32Array(DEBRIS_COUNT * 3);
  debrisGeo.setAttribute('position', new THREE.BufferAttribute(debrisPos, 3));
  const debrisMat = new THREE.PointsMaterial({ color: 0xffb45e, size: 1.7, transparent: true, opacity: 1 });
  const debris = new THREE.Points(debrisGeo, debrisMat);
  debris.visible = false;
  debris.frustumCulled = false; // particles fly far from the initial bounds
  scene.add(debris);

  const SMOKE_COUNT = 7;
  const smokeGeo = new THREE.SphereGeometry(1, 8, 6);
  const smokes = [];
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const m = new THREE.Mesh(smokeGeo,
      new THREE.MeshBasicMaterial({ color: 0x8d949c, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    smokes.push({ mesh: m, off: new THREE.Vector3(), vel: new THREE.Vector3(), start: 0 });
  }

  const _qDelta = new THREE.Quaternion();
  const _dir = new THREE.Vector3();

  function beginCrash(flightState, context, nowMs) {
    const p = flightState.pos;
    CRASH.active = true;
    CRASH.firstSeenAt = nowMs;
    CRASH.lastNow = nowMs;
    // record the timestamp on the caller's crash object too (contract: renderer owns it)
    if (context && context.crash && typeof context.crash === 'object') {
      context.crash.firstSeenAt = nowMs;
      CRASH.reason = context.crash.reason || null;
    } else {
      CRASH.reason = null;
    }
    CRASH.impact.set(p.x, p.y, p.z);
    // rest height: terrain at the crash location (slightly above so wings don't clip);
    // for water crashes this sinks the wreck just below the surface instead of hovering
    CRASH.targetY = Math.max(world.heightAt(p.x, p.z) + 0.6, world.waterLevel - 4);

    // random tumble axis + rate (renderer-only randomness; visuals don't affect sim)
    _dir.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    if (_dir.lengthSq() < 1e-4) _dir.set(0.3, 1, -0.2);
    CRASH.spinAxis.copy(_dir).normalize();
    CRASH.spinRate = 2.5 + Math.random() * 2;

    // debris burst: outward velocities biased upward, gravity pulls them back down
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const i3 = i * 3;
      debrisPos[i3]     = p.x + (Math.random() - 0.5) * 2;
      debrisPos[i3 + 1] = p.y + (Math.random() - 0.5) * 2;
      debrisPos[i3 + 2] = p.z + (Math.random() - 0.5) * 2;
      _dir.set(Math.random() * 2 - 1, Math.random() * 1.4 + 0.25, Math.random() * 2 - 1).normalize();
      const sp = 8 + Math.random() * 26;
      debrisVel[i3]     = _dir.x * sp;
      debrisVel[i3 + 1] = _dir.y * sp;
      debrisVel[i3 + 2] = _dir.z * sp;
    }
    debrisGeo.attributes.position.needsUpdate = true;
    debrisMat.opacity = 1;
    debris.visible = true;

    // smoke puffs: staggered starts so the plume lasts ~3s total
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const s = smokes[i];
      s.off.set((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3);
      s.vel.set((Math.random() - 0.5) * 2, 2.5 + Math.random() * 2.5, (Math.random() - 0.5) * 2);
      s.start = i * 0.18;
      s.mesh.visible = true;
      s.mesh.material.opacity = 0;
      s.mesh.scale.setScalar(0.6);
    }
  }

  function endCrash() {
    CRASH.active = false;
    debris.visible = false;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      smokes[i].mesh.visible = false;
      smokes[i].mesh.material.opacity = 0;
    }
  }

  function stepCrashEffects(nowMs, dtFx) {
    const t = (nowMs - CRASH.firstSeenAt) / 1000; // seconds since impact

    // --- jet wreck: slide/sink to terrain height while tumbling about a random axis ---
    const SINK_DUR = 1.4;
    const k = Math.min(1, t / SINK_DUR);
    const ease = 1 - Math.pow(1 - k, 3); // easeOutCubic: fast drop, gentle settle
    jet.position.set(CRASH.impact.x, CRASH.impact.y + (CRASH.targetY - CRASH.impact.y) * ease, CRASH.impact.z);
    if (k < 1) {
      _qDelta.setFromAxisAngle(CRASH.spinAxis, CRASH.spinRate * dtFx * (1 - k * 0.7)); // slows as it settles
      jet.quaternion.premultiply(_qDelta); // world-space tumble about a fixed axis
    }

    // --- debris: outward + gravity, fading out over ~1.5s ---
    const DEBRIS_LIFE = 1.5;
    if (t < DEBRIS_LIFE) {
      for (let i = 0; i < DEBRIS_COUNT * 3; i += 3) {
        debrisVel[i + 1] -= 24 * dtFx; // heavy gravity: punchy arcs that fall back fast
        debrisPos[i]     += debrisVel[i] * dtFx;
        debrisPos[i + 1] += debrisVel[i + 1] * dtFx;
        debrisPos[i + 2] += debrisVel[i + 2] * dtFx;
      }
      debrisGeo.attributes.position.needsUpdate = true;
      debrisMat.opacity = Math.max(0, 1 - t / DEBRIS_LIFE);
    } else if (debris.visible) {
      debris.visible = false;
    }

    // --- smoke: rise from the impact point, grow and fade over ~3s total ---
    const SMOKE_LIFE = 2.6;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const s = smokes[i];
      const st = t - s.start;
      if (st <= 0) { s.mesh.visible = false; continue; }
      if (st >= SMOKE_LIFE) { s.mesh.visible = false; s.mesh.material.opacity = 0; continue; }
      const f = st / SMOKE_LIFE; // 0..1 through this puff's life
      s.mesh.position.set(
        CRASH.impact.x + s.off.x + s.vel.x * st,
        CRASH.impact.y + s.off.y + s.vel.y * st,
        CRASH.impact.z + s.off.z + s.vel.z * st);
      s.mesh.scale.setScalar(0.8 + f * 5.2); // grows as it rises
      s.mesh.material.opacity = 0.42 * Math.sin(Math.PI * Math.min(1, f * 1.15)); // quick in, slow out
      s.mesh.visible = true;
    }
  }

  let cameraMode = 'chase';
  const _m4 = new THREE.Matrix4();
  const _vR = new THREE.Vector3(), _vU = new THREE.Vector3(), _vF = new THREE.Vector3();
  const _camPos = new THREE.Vector3(), _lookAt = new THREE.Vector3();

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resize).observe(canvas);
  } else {
    window.addEventListener('resize', resize);
  }

  function update(flightState, gameSnapshot) {
    const p = flightState.pos;
    // extended context contract: { nextGate, phase, crash }. `phase`/`crash` are optional —
    // old callers that omit them get exactly the previous behavior.
    const phase = (gameSnapshot && typeof gameSnapshot.phase === 'string') ? gameSnapshot.phase : null;

    // crash state transitions (the renderer records firstSeenAt itself)
    if (phase === 'crashed' && !CRASH.active) {
      beginCrash(flightState, gameSnapshot, performance.now());
    } else if (phase !== 'crashed' && CRASH.active) {
      endCrash(); // e.g. R restarts the run: back to normal flight rendering
    }

    const nowMs = performance.now();
    let dtFx = 0;
    if (CRASH.active) {
      dtFx = Math.min(0.05, Math.max(0, (nowMs - CRASH.lastNow) / 1000)); // clamp tab-switch jumps
      CRASH.lastNow = nowMs;
    }

    const b = attitudeToBasis(flightState.attitude); // frozen state after crash: same basis every frame
    _vR.set(b.R.x, b.R.y, b.R.z);
    _vU.set(b.U.x, b.U.y, b.U.z);
    _vF.set(b.F.x, b.F.y, b.F.z);
    if (!CRASH.active) {
      jet.position.set(p.x, p.y, p.z);
      _m4.makeBasis(_vR, _vU, _vF);
      jet.quaternion.setFromRotationMatrix(_m4);
    } else {
      stepCrashEffects(nowMs, dtFx); // owns the wreck's position + tumble while crashed
    }

    // gate highlight: next = bright amber, passed = green, future = dim
    const nextGate = gameSnapshot && typeof gameSnapshot.nextGate === 'number' ? gameSnapshot.nextGate : -1;
    for (let i = 0; i < gateMeshes.length; i++) {
      const mat = gateMeshes[i].material;
      if (i < nextGate) { mat.color.setHex(0x39d98a); mat.emissive.setHex(0x0a3a24); }
      else if (i === nextGate) { mat.color.setHex(0xffc23d); mat.emissive.setHex(0x6b4a05); }
      else { mat.color.setHex(0xb9c2cc); mat.emissive.setHex(0x101820); }
    }

    // camera
    if (cameraMode === 'cockpit') {
      _camPos.set(p.x + b.U.x * 1.5, p.y + b.U.y * 1.5, p.z + b.U.z * 1.5)
        .addScaledVector(_vF, -0.5);
      camera.position.copy(_camPos);
      _lookAt.set(p.x + b.F.x * 50, p.y + b.F.y * 50, p.z + b.F.z * 50);
      camera.up.set(b.U.x, b.U.y, b.U.z);
      camera.lookAt(_lookAt);
    } else { // chase
      const dist = 26, height = 9;
      _camPos.set(p.x - b.F.x * dist, p.y + height, p.z - b.F.z * dist);
      camera.position.lerp(_camPos, 0.15);                 // smooth follow
      if (CRASH.active) {
        // impact shake: small decaying positional noise for ~0.8s after the crash
        const SHAKE_DUR = 0.8;
        const st = (nowMs - CRASH.firstSeenAt) / 1000;
        if (st < SHAKE_DUR) {
          const a = 2.2 * Math.pow(1 - st / SHAKE_DUR, 2); // amplitude decays to zero
          camera.position.x += a * Math.sin(st * 47.3);
          camera.position.y += a * 0.6 * Math.sin(st * 59.7 + 1.3);
          camera.position.z += a * 0.8 * Math.sin(st * 41.1 + 2.1);
        }
      }
      _lookAt.set(p.x + b.F.x * 20, p.y + b.F.y * 20, p.z + b.F.z * 20);
      camera.up.set(0, 1, 0);
      camera.lookAt(_lookAt);
    }

    renderer.render(scene, camera);
  }

  function setCameraMode(mode) { if (mode === 'chase' || mode === 'cockpit') cameraMode = mode; }

  function dispose() {
    endCrash(); // hide effect objects before teardown
    debrisGeo.dispose();
    debrisMat.dispose();
    smokeGeo.dispose();
    for (let i = 0; i < SMOKE_COUNT; i++) smokes[i].mesh.material.dispose();
    renderer.dispose();
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }

  return { update, setCameraMode, dispose };
}
