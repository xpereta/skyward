// audio/engineSound.js — WebAudio synth for the jet engine. Takes numbers only; no DOM.
// Contract: createEngineAudio(context?) -> Audio { update(throttle, speed), dispose() }
// Autoplay-safe: starts silent until the context is running (resumed on first user gesture).

export function createEngineAudio(audioContext) {
  const AC = audioContext || (typeof window !== 'undefined' && window.AudioContext);
  if (!AC) return { update() {}, unlock() {}, dispose() {} }; // no WebAudio: degrade to silence

  let ctx;
  try { ctx = new AC(); } catch (e) { return { update() {}, unlock() {}, dispose() {} }; }

  const master = ctx.createGain();
  master.gain.value = 0.0;
  master.connect(ctx.destination);

  // low rumble: sawtooth through a lowpass, plus a detuned sub-oscillator for body
  const osc1 = ctx.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.value = 60;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  lp.Q.value = 0.8;

  const osc2 = ctx.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.value = 31;
  const g2 = ctx.createGain();
  g2.gain.value = 0.5;

  osc1.connect(lp); lp.connect(master);
  osc2.connect(g2); g2.connect(master);
  osc1.start(); osc2.start();

  let lastT = 0;
  // Called on a user gesture so the browser lets us start sound.
  function unlock() {
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function update(throttle, speed) {
    if (ctx.state !== 'running') return; // silent until user gesture resumes it
    const t = ctx.currentTime;
    const thr = Math.max(0, Math.min(1, throttle || 0));
    const spd = Math.max(0, speed || 0);

    // pitch follows throttle (idle ~55Hz -> full ~170Hz), slight speed contribution
    const f = 52 + thr * 118 + Math.min(40, spd * 0.12);
    osc1.frequency.setTargetAtTime(f, t, 0.06);
    osc2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
    lp.frequency.setTargetAtTime(300 + thr * 900, t, 0.08);

    // gain: quiet at idle, loud at full throttle; fade in/out smoothly
    const target = ctx.state === 'running' ? (0.05 + thr * 0.22) : 0.0;
    master.gain.setTargetAtTime(target, t, 0.1);

    // resume on first audible request after a user gesture
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
    lastT = t;
  }

  function dispose() {
    try { osc1.stop(); osc2.stop(); } catch (e) {}
    master.disconnect();
    setTimeout(() => { try { ctx.close(); } catch (e) {} }, 50);
  }

  return { update, unlock, dispose };
}
