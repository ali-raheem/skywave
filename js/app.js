// App wiring: the simulation loop, HUD, narration, panels, controls and offline support.

import { createWorld, step, clock, kpLabel, LEVELS } from './sim.js';
import { BANDS, MODES } from './iono.js';
import { randomSeed } from './rng.js';
import { Renderer } from './render.js';
import { SoundEngine } from './audio.js';
import { VERSION, BUILT } from './version.js';

const MINUTES_PER_SECOND = 2; // at 1×
const SPEEDS = [0.5, 1, 2, 4, 8];
const MAX_STEPS = 40;
const MUF_KEY = 'skywave.muf';
const CALLS_KEY = 'skywave.calls';

const $ = (id) => document.getElementById(id);
const el = {
  canvas: $('view'), hud: $('hud'), clockCard: $('card-clock'), logCard: $('card-log'),
  dayNo: $('day-no'), clock: $('clock'), meta: $('meta'), seed: $('seed'), feed: $('feed'),
  pause: $('btn-pause'), speed: $('btn-speed'), next: $('btn-next'), controls: $('controls'),
  bands: $('bands'), log: $('log'), settings: $('settings'),
  sound: $('set-sound'), muf: $('set-muf'), calls: $('set-calls'), full: $('set-full'), hide: $('set-hide'), install: $('set-install'),
  version: $('version'),
};
const panels = {
  bands: { panel: el.bands, button: $('btn-bands'), onOpen: () => buildBands() },
  log: { panel: el.log, button: $('btn-log'), onOpen: () => buildLog() },
  settings: { panel: el.settings, button: $('btn-settings') },
};

const useIcon = (button, name) => button.querySelector('use').setAttribute('href', `#i-${name}`);

const renderer = new Renderer(el.canvas);
const sound = new SoundEngine();
let world = null;
let paused = false;
let speedIndex = 1;
let acc = 0;
let hudTimer = 0;
let panelTimer = 0;
let runTime = 0;
let lastSix = -Infinity;
let qsosAtMidnight = 0;

function loadSwitch(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'on';
  } catch {
    return fallback;
  }
}
function saveSwitch(key, on) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch { /* won't persist */ }
}
renderer.showMuf = loadSwitch(MUF_KEY, true);
renderer.showCalls = loadSwitch(CALLS_KEY, true);

function seedFromHash(hash = location.hash) {
  const m = hash.match(/seed=([0-9a-f]+)/i);
  return m ? parseInt(m[1], 16) >>> 0 : null;
}

const hex = (seed) => seed.toString(16).padStart(8, '0');
const km = (d) => `${Math.round(d).toLocaleString('en-GB')} km`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function newRun(seed = randomSeed()) {
  world = createWorld(seed);
  window.history.replaceState(null, '', `#seed=${hex(seed)}`);
  el.seed.textContent = `seed ${hex(seed)}`;
  el.feed.replaceChildren();
  acc = 0;
  runTime = 0;
  lastSix = -Infinity;
  qsosAtMidnight = 0;
  renderer.reset(world);
  const c = clock(world.minute);
  const cycle = world.sfiBase > 170 ? 'near solar maximum' : world.sfiBase < 95 ? 'near solar minimum' : 'mid-cycle';
  feed(`<b>${c.date}, ${c.hhmm} UTC</b> · ${world.stations.length} stations on the air <span class="w">· solar flux ${world.sfiBase}, ${cycle}</span>`, '#7fc4ff');
  updateHud();
  for (const name of ['bands', 'log']) if (!panels[name].panel.hidden) panels[name].onOpen();
  placePanels();
}

function placePanels() {
  const top = Math.ceil(el.meta.getBoundingClientRect().bottom) + 10;
  el.hud.style.setProperty('--hud-top', `${top}px`);
  const band = Math.min(el.controls.getBoundingClientRect().top, el.feed.getBoundingClientRect().top);
  renderer.setInsets(top, window.innerHeight - band + 8);
}

// --- HUD ---------------------------------------------------------------------------

function updateHud() {
  const c = clock(world.minute);
  el.clockCard.querySelector('.name').textContent = `${c.hhmm} UTC`;
  el.clockCard.querySelector('.date').textContent = c.date;
  el.clockCard.querySelector('.sun').textContent = `SFI ${Math.round(world.sfi)} · Kp ${world.kp.toFixed(0)} ${kpLabel(world.kp)}`;
  el.clockCard.querySelector('.bar > i').style.width = `${(((world.minute % 1440) / 1440) * 100).toFixed(1)}%`;
  const hourAgo = world.minute - 60;
  const lastHour = world.qsos.filter((q) => q.minute > hourAgo).length;
  el.logCard.querySelector('.name').textContent = `${world.totals.qsos.toLocaleString('en-GB')} QSOs`;
  el.logCard.querySelector('.hour').textContent = `${lastHour} in the last hour`;
  const best = world.bands.reduce((b, x) => (x.best && (!b || x.best.D > b.D) ? x.best : b), null);
  el.logCard.querySelector('.best').textContent = best ? `best ${km(best.D)}` : '';
  el.dayNo.textContent = `Day ${Math.floor((world.minute - world.startMinute) / 1440) + 1}`;
  const secs = Math.floor(runTime);
  el.clock.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

function feed(html, color) {
  const li = document.createElement('li');
  li.style.setProperty('--c', color);
  li.innerHTML = html;
  el.feed.append(li);
  while (el.feed.children.length > 6) el.feed.firstElementChild.remove();
}

const bandColor = (name) => BANDS.find((b) => b.name === name)?.color ?? '#7fc4ff';
const station = (s) => `${escapeHtml(s.call)} <span class="w">(${s.grid.slice(0, 4)})</span>`;

function narrate(e) {
  const t = clock(e.minute).hhmm;
  switch (e.type) {
    case 'open':
      feed(`${t} · <b>${e.band} opens</b> <span class="w">· ${Math.round(e.open * 100)}% of paths</span>`, bandColor(e.band));
      break;
    case 'close':
      feed(`${t} · ${e.band} closes`, bandColor(e.band));
      break;
    case 'record': {
      const q = e.qso;
      feed(`${t} · <b>New ${q.band} best</b> ${station(q.a)} ↔ ${station(q.b)} <span class="w">· ${km(q.D)}, ${q.hops} hop${q.hops === 1 ? '' : 's'}, ${q.mode} ${q.rst}</span>`, q.color);
      break;
    }
    case 'six':
      if (e.minute - lastSix < 30) break;
      lastSix = e.minute;
      feed(`${t} · <b>6m sporadic-E</b> ${station(e.qso.a)} ↔ ${station(e.qso.b)} <span class="w">· ${km(e.qso.D)}</span>`, bandColor('6m'));
      break;
    case 'greyline':
      feed(`${t} · <b>Grey line on ${e.qso.band}</b> ${station(e.qso.a)} ↔ ${station(e.qso.b)} <span class="w">· ${km(e.qso.D)} along the edge of night</span>`, '#ffb36b');
      break;
    case 'es':
      feed(`${t} · <b>Sporadic-E</b> ${e.place ? `over ${escapeHtml(e.place)}` : 'over open water'} <span class="w">· the high bands open out to ~2,000 km</span>`, '#ff6ab0');
      break;
    case 'flare':
      if (e.x) {
        feed(`${t} · <b>${e.cls} solar flare</b> <span class="w">· shortwave blackout across the sunlit side</span>`, '#fff2b0');
        renderer.flare();
      } else {
        feed(`${t} · <b>${e.cls} flare</b> <span class="w">· the low bands fade on the sunlit side</span>`, '#fff2b0');
      }
      break;
    case 'storm':
      feed(`${t} · <b>Geomagnetic storm, Kp ${e.kp}</b> <span class="w">· polar paths fade, aurora spreads south</span>`, '#5bff9a');
      break;
    case 'calm':
      feed(`${t} · The geomagnetic storm subsides`, '#5bff9a');
      break;
    case 'day': {
      const n = world.totals.qsos - qsosAtMidnight;
      qsosAtMidnight = world.totals.qsos;
      feed(`<b>${clock(e.minute).date}</b> · 00:00 UTC <span class="w">· ${n.toLocaleString('en-GB')} contacts in the last day · SFI ${e.sfi}</span>`, '#7fc4ff');
      break;
    }
    default:
  }
}

// --- panels --------------------------------------------------------------------------

function buildBands() {
  const hourAgo = world.minute - 60;
  const counts = new Map();
  for (const q of world.qsos) if (q.minute > hourAgo) counts.set(q.band, (counts.get(q.band) ?? 0) + 1);
  const rows = world.bands.map((b) => `
    <tr style="--bc:${b.color}">
      <td class="band">${b.name}</td>
      <td class="r">${b.f.toFixed(b.f < 10 ? 2 : 1)}</td>
      <td><span class="lvl"><i style="width:${Math.min(100, (b.open / 0.6) * 100).toFixed(0)}%"></i></span> ${LEVELS[b.level]}</td>
      <td class="r">${counts.get(b.name) ?? 0}</td>
      <td class="dx">${b.best ? `${km(b.best.D)}` : '–'}</td>
    </tr>`).join('');
  const cycle = world.sfi > 170 ? 'high: the upper bands open widely' : world.sfi < 95 ? 'low: 20m and below do most of the work' : 'moderate';
  el.bands.innerHTML = `
    <h2>Band conditions</h2>
    <table>
      <tr><th>band</th><th class="r">MHz</th><th>paths open</th><th class="r">/h</th><th>best DX</th></tr>
      ${rows}
    </table>
    <p>Solar flux <b>${Math.round(world.sfi)}</b>, ${cycle}. Kp <b>${world.kp.toFixed(1)}</b>, ${kpLabel(world.kp)}.
      ${world.es.length ? `<b>${world.es.length}</b> sporadic-E cloud${world.es.length === 1 ? '' : 's'} up.` : ''}
      ${world.flare > 1 ? 'A flare is still absorbing the low bands on the sunlit side.' : ''}</p>
    <h3>How shortwave gets around the world</h3>
    <p>Sunlight ionises the upper atmosphere. The <b>F2 layer</b>, about 300 km up, bends radio waves back to earth.
      How high a frequency it can return depends on how strongly it's ionised (its critical frequency, foF2) and on
      the angle the wave meets it: a long, shallow hop can use about three times foF2. That limit is the
      <b>maximum usable frequency</b> (MUF). A long path takes several hops, and must be under the MUF at every one.</p>
    <p>The F2 layer follows the sun, so the <b>high bands</b> (15–10m) open in daylight and close at night, while
      the <b>low bands</b> (160–40m) come alive after dark. By day the lower <b>D layer</b> absorbs them, more
      strongly the lower the frequency. Along the <b>grey line</b> (dawn and dusk) the low bands escape that absorption.</p>
    <p>The <b>solar flux</b> (SFI) tracks the 11-year sunspot cycle. More flux means a denser F2 layer and higher MUFs.
      <b>Flares</b> flood the D layer with X-rays and black out the sunlit side for an hour or so.
      <b>Geomagnetic storms</b> (high Kp) weaken the polar ionosphere and push the aurora, which absorbs signals, towards the equator.
      <b>Sporadic-E</b> is patchy, dense ionisation 110 km up, mostly on summer days. It reflects 10m and 6m for one
      hop of up to about 2,000 km.</p>
    <p>Each contact here is checked against that model: every hop under the MUF, and enough signal left after
      spreading, absorption and ground losses to beat the noise for its mode
      (FT8 works ${MODES.FT8} dB below the noise, CW needs about ${MODES.CW} dB, SSB about +${MODES.SSB}). It's a toy compared with VOACAP,
      but it's the same physics, so bands open and close at the right times.</p>
    <p>Map colours (MUF map on): the highest band a 3,000 km hop could use from each point. White dots on an arc are its
      reflection points; pink ones are sporadic-E.</p>`;
}

function buildLog() {
  const recent = world.qsos.slice(-30).reverse();
  if (!recent.length) {
    el.log.innerHTML = '<h2>Log</h2><p class="empty">Contacts will appear here.</p>';
    return;
  }
  el.log.innerHTML = `<h2>Log · last ${recent.length}</h2><table>
    <tr><th>UTC</th><th>band</th><th>contact</th><th class="hide-sm">mode</th><th class="r">rpt</th><th class="r">km</th></tr>
    ${recent.map((q) => `<tr style="--bc:${q.color}">
      <td class="w">${clock(q.minute).hhmm}</td>
      <td class="band">${q.band}</td>
      <td><span class="call">${escapeHtml(q.a.call)}</span> <span class="w">↔</span> <span class="call">${escapeHtml(q.b.call)}</span></td>
      <td class="hide-sm w">${q.mode}${q.prop === 'Es' ? ' Es' : ''}</td>
      <td class="r">${q.rst}</td>
      <td class="r">${Math.round(q.D).toLocaleString('en-GB')}</td>
    </tr>`).join('')}</table>`;
}

// --- loop --------------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const speed = SPEEDS[speedIndex];
  if (!paused) {
    runTime += realDt;
    acc += realDt * speed * MINUTES_PER_SECOND;
    let steps = 0;
    const before = world.nextQso;
    while (acc >= 1 && steps < MAX_STEPS) {
      step(world);
      acc -= 1;
      steps++;
    }
    if (steps === MAX_STEPS) acc = Math.min(acc, 1);
    for (const e of world.events) narrate(e);
    world.events.length = 0;
    // Key one of the new CW contacts, now and then.
    if (speed <= 2 && world.nextQso > before) {
      const cw = world.qsos.filter((q) => q.id >= before && q.mode === 'CW');
      if (cw.length) {
        const q = cw[cw.length - 1];
        sound.cw(`${q.b.call} DE ${q.a.call} ${q.rst.replace(/9/g, 'N')}`, {
          wpm: 20 + (q.id % 9), pitch: 560 + (q.id % 7) * 30, strength: Math.max(0, Math.min(1, (q.snr + 5) / 30)),
        });
      }
    }
  }
  renderer.update(realDt, world, speed);
  renderer.draw();

  hudTimer -= realDt;
  if (hudTimer <= 0) {
    updateHud();
    hudTimer = 0.25;
  }
  panelTimer -= realDt;
  if (panelTimer <= 0) {
    panelTimer = 1;
    if (!el.bands.hidden) buildBands();
    if (!el.log.hidden) buildLog();
  }
  requestAnimationFrame(frame);
}

// --- controls ----------------------------------------------------------------------

function setPaused(p) {
  paused = p;
  sound.setPaused(p);
  useIcon(el.pause, paused ? 'play' : 'pause');
  el.pause.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  el.pause.setAttribute('aria-pressed', String(paused));
}
function changeSpeed(delta) {
  speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, speedIndex + delta));
  el.speed.textContent = `${SPEEDS[speedIndex]}×`;
}
function cycleSpeed() {
  speedIndex = (speedIndex + 1) % SPEEDS.length;
  changeSpeed(0);
}
function showPanel(name) {
  for (const [key, p] of Object.entries(panels)) {
    p.panel.hidden = key !== name;
    p.button.setAttribute('aria-pressed', String(key === name));
  }
  if (name) panels[name].onOpen?.();
}
const togglePanel = (name) => showPanel(panels[name].panel.hidden ? name : null);
const anyPanelOpen = () => Object.values(panels).some((p) => !p.panel.hidden);

function setSwitch(row, on) {
  row.setAttribute('aria-checked', String(on));
}
function toggleMuf() {
  renderer.showMuf = !renderer.showMuf;
  renderer.overlayAt = -Infinity;
  setSwitch(el.muf, renderer.showMuf);
  saveSwitch(MUF_KEY, renderer.showMuf);
}
function toggleCalls() {
  renderer.showCalls = !renderer.showCalls;
  setSwitch(el.calls, renderer.showCalls);
  saveSwitch(CALLS_KEY, renderer.showCalls);
}
function renderSound() {
  setSwitch(el.sound, sound.enabled);
  useIcon(el.sound, sound.enabled ? 'sound' : 'sound-off');
}
function toggleSound() {
  sound.setEnabled(!sound.enabled);
  renderSound();
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
function setHudHidden(hidden) {
  el.hud.classList.toggle('hidden', hidden);
}

el.pause.addEventListener('click', () => setPaused(!paused));
el.speed.addEventListener('click', cycleSpeed);
el.next.addEventListener('click', () => newRun());
for (const [name, p] of Object.entries(panels)) p.button.addEventListener('click', () => togglePanel(name));
el.sound.addEventListener('click', toggleSound);
el.muf.addEventListener('click', toggleMuf);
el.calls.addEventListener('click', toggleCalls);
el.full.addEventListener('click', toggleFullscreen);
el.hide.addEventListener('click', () => {
  showPanel(null);
  setHudHidden(true);
});
el.seed.addEventListener('click', async () => {
  const label = el.seed.textContent;
  try {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}#seed=${hex(world.seed)}`);
    el.seed.textContent = 'link copied';
  } catch {
    el.seed.textContent = 'copy failed';
  }
  setTimeout(() => (el.seed.textContent = label), 1200);
});
document.addEventListener('fullscreenchange', () => setSwitch(el.full, !!document.fullscreenElement));
el.full.hidden = !document.documentElement.requestFullscreen;
renderSound();
setSwitch(el.muf, renderer.showMuf);
setSwitch(el.calls, renderer.showCalls);
setSwitch(el.full, false);
el.version.textContent = `v${VERSION} · built ${new Date(BUILT).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
el.version.title = BUILT;

// Install: Chromium hands us a deferred prompt; iOS Safari has no install API, so the
// row explains Share → Add to Home Screen instead. Hidden when already installed.
let installPrompt = null;
const runningInstalled = navigator.standalone === true ||
  matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function renderInstall() {
  const hint = el.install.querySelector('small');
  if (installPrompt) hint.textContent = 'adds it to your home screen or desktop; works offline';
  else if (isIOS) hint.textContent = 'in Safari, tap Share, then Add to Home Screen';
  el.install.hidden = runningInstalled || (!installPrompt && !isIOS);
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  renderInstall();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  el.install.hidden = true;
});
el.install.addEventListener('click', async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === 'accepted') el.install.hidden = true;
  else renderInstall();
});
renderInstall();

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case ' ': setPaused(!paused); break;
    case 'n': case 'N': newRun(); break;
    case '+': case '=': changeSpeed(1); break;
    case '-': case '_': changeSpeed(-1); break;
    case 'b': case 'B': togglePanel('bands'); break;
    case 'l': case 'L': togglePanel('log'); break;
    case 's': case 'S': togglePanel('settings'); break;
    case 'u': case 'U': toggleMuf(); break;
    case 'k': case 'K': toggleCalls(); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case 'm': case 'M': toggleSound(); break;
    case 'h': case 'H': setHudHidden(!el.hud.classList.contains('hidden')); break;
    case 'Escape': if (!anyPanelOpen()) return; showPanel(null); break;
    default: return;
  }
  e.preventDefault();
  wakeHud();
});

// Auto-hide the controls after a few idle seconds so it works as a screensaver. A tap
// while they're hidden only brings them back; the click that follows it is swallowed.
let idleTimer = null;
let swallowClick = false;
function wakeHud() {
  el.hud.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!anyPanelOpen()) el.hud.classList.add('idle');
  }, 4000);
}
window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wakeHud(); });
window.addEventListener('pointerdown', () => {
  swallowClick = el.hud.classList.contains('idle') || el.hud.classList.contains('hidden');
  setHudHidden(false);
  wakeHud();
}, { capture: true });
window.addEventListener('click', (e) => {
  if (swallowClick) {
    e.preventDefault();
    e.stopPropagation();
  }
  swallowClick = false;
}, { capture: true });

for (const type of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(type, () => sound.unlock(), { capture: true });
}

window.addEventListener('resize', () => {
  renderer.resize();
  placePanels();
});
window.addEventListener('hashchange', () => {
  const seed = seedFromHash();
  if (seed !== null && seed !== world.seed) newRun(seed);
});

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* not allowed; fine */ }
}
document.addEventListener('visibilitychange', () => {
  sound.setPaused(document.visibilityState !== 'visible' || paused);
  if (document.visibilityState === 'visible') {
    last = performance.now();
    if (!wakeLock || wakeLock.released) requestWakeLock();
  }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register(`./sw.js?v=${VERSION}`).catch(() => {});
}

newRun(seedFromHash() ?? randomSeed());
wakeHud();
requestWakeLock();
requestAnimationFrame(frame);
