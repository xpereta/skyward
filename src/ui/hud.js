// ui/hud.js — DOM overlay. Reads plain snapshot objects only; never imports core/render.
// Contract: createHud(containerEl) -> Hud { update(snapshot), showBanner(text), hideBanner(), dispose() }
// Snapshot = { speed, alt, headingDeg, throttle, score, time, mode, phase, nextGate, gateCount, stalled }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = 'sw-' + cls;
  if (text != null) e.textContent = text;
  return e;
}

export function createHud(containerEl) {
  const root = el('div', 'hud');
  containerEl.appendChild(root);

  // top-left: flight data readout
  const dataBox = el('div', 'data');
  const speedRow = row('SPD', 'speed');
  const altRow = row('ALT', 'alt');
  const hdgRow = row('HDG', 'hdg');
  const thrRow = row('THR', 'thr');
  dataBox.append(speedRow, altRow, hdgRow, thrRow);
  root.appendChild(dataBox);

  // top-right: score / time / mode
  const statusBox = el('div', 'status');
  const modeEl = el('div', 'mode', '');
  const scoreEl = el('div', 'score', 'SCORE 0');
  const timeEl = el('div', 'time', 'TIME 0.0s');
  statusBox.append(modeEl, scoreEl, timeEl);
  root.appendChild(statusBox);

  // center banner (gate passed / stall warning / crash / complete)
  const banner = el('div', 'banner');
  root.appendChild(banner);

  // bottom hint bar
  const hints = el('div', 'hints',
    'W/S pitch · A/D roll · Q/E yaw · Shift/Ctrl throttle · C camera · R restart');
  root.appendChild(hints);

  function row(label, key) {
    const r = el('div', 'row');
    r.append(el('span', 'label', label), el('span', 'value sw-' + key, ''));
    return r;
  }
  const speedVal = dataBox.querySelector('.sw-speed');
  const altVal = dataBox.querySelector('.sw-alt');
  const hdgVal = dataBox.querySelector('.sw-hdg');
  const thrVal = dataBox.querySelector('.sw-thr');

  let bannerTimer = null;

  function update(s) {
    if (!s) return;
    speedVal.textContent = Math.round(s.speed || 0);
    altVal.textContent = Math.max(0, Math.round((s.alt || 0)));
    hdgVal.textContent = String(Math.round(((s.headingDeg % 360) + 360) % 360)).padStart(3, '0') + '°';
    const thrPct = Math.round((s.throttle || 0) * 100);
    thrVal.textContent = thrPct + '%';

    if (s.mode === 'gateRun' && s.phase !== 'complete' && s.phase !== 'crashed') {
      modeEl.textContent = 'GATE RUN · ' + Math.min(s.nextGate || 0, s.gateCount) + '/' + s.gateCount;
    } else if (s.mode === 'freeFlight') {
      modeEl.textContent = 'FREE FLIGHT';
    } else {
      modeEl.textContent = s.phase === 'complete' ? 'RUN COMPLETE' : s.phase === 'crashed' ? 'CRASHED' : '';
    }
    scoreEl.textContent = 'SCORE ' + (s.score || 0);
    timeEl.textContent = 'TIME ' + ((s.time || 0).toFixed(1)) + 's';

    // stall warning: pulse the data box red while stalled
    root.classList.toggle('stalled', !!s.stalled && s.phase === 'flying');
  }

  function showBanner(text, ms = 2200) {
    banner.textContent = text;
    banner.classList.add('show');
    if (bannerTimer) clearTimeout(bannerTimer);
    if (ms > 0) bannerTimer = setTimeout(() => banner.classList.remove('show'), ms);
  }

  function hideBanner() {
    if (bannerTimer) clearTimeout(bannerTimer);
    banner.classList.remove('show');
  }

  function dispose() {
    if (bannerTimer) clearTimeout(bannerTimer);
    root.remove();
  }

  return { update, showBanner, hideBanner, dispose };
}
