// browser-smoke.js — end-to-end check: boots index.html in real Chromium, starts a Gate Run,
// flies ~8 s with throttle up, forces a stall, verifies sim state + rendered pixels.
// Requires: `npm install puppeteer-core` (uses your local Chromium; set CHROME_PATH to override).
// Usage: node browser-smoke.js [url]   (default http://127.0.0.1:8000/index.html?debug)
const path = require('node:path');

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const c of candidates) { try { require('node:fs').accessSync(c); return c; } catch {} }
  const pw = path.join(process.env.HOME || '~', '.cache/ms-playwright');
  try {
    const fs = require('node:fs');
    for (const d of fs.readdirSync(pw)) {
      if (!d.startsWith('chromium-')) continue;
      const exe = path.join(pw, d, 'chrome-linux64', 'chrome');
      try { fs.accessSync(exe); return exe; } catch {}
    }
  } catch {}
  throw new Error('No Chromium found. Set CHROME_PATH=/path/to/chrome and retry.');
}

const URL = process.argv[2] || 'http://127.0.0.1:8000/index.html?debug';

(async () => {
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const badUrls = new Set();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) badUrls.add(r.url()); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  let hook = null;
  for (let i = 0; i < 60 && hook !== 'object'; i++) {
    await new Promise((r) => setTimeout(r, 500));
    hook = await page.evaluate(() => typeof window.__skyward);
  }
  if (hook !== 'object') throw new Error('boot failed: no __skyward hook');

  const px = await page.evaluate(() => {
    const c = document.getElementById('skyward-canvas');
    const t = document.createElement('canvas'); t.width = 64; t.height = 36;
    const g = t.getContext('2d'); g.drawImage(c, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    const s = new Set(); for (let i = 0; i < d.length; i += 16) s.add(d[i] + ',' + d[i+1] + ',' + d[i+2]);
    return { distinct: s.size };
  });

  await page.evaluate(() => window.__skyward.startGame('gateRun'));
  await new Promise((r) => setTimeout(r, 400));
  const t0 = await page.evaluate(() => ({ z: window.__skyward.flightState.pos.z }));
  await page.keyboard.down('ShiftLeft');
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 1000));
  const t1 = await page.evaluate(() => ({ z: window.__skyward.flightState.pos.z, speed: window.__skyward.flightState.speed }));

  await page.keyboard.up('ShiftLeft');
  await page.keyboard.down('ControlRight');
  let stalled = false;
  for (let i = 0; i < 16 && !stalled; i++) {
    await new Promise((r) => setTimeout(r, 500));
    stalled = await page.evaluate(() => window.__skyward.flightState.stalled);
  }

  console.log('pixels distinct:', px.distinct, '| dz(+8s):', (t1.z - t0.z).toFixed(0), 'm | stall:', stalled);
  const pass = px.distinct > 8 && (t1.z - t0.z) > 300 && stalled && badUrls.size === 0 && jsErrors.length === 0;
  if (badUrls.size) console.log('HTTP errors:', [...badUrls]);
  if (jsErrors.length) console.log('JS errors:', jsErrors);
  await browser.close();
  console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
