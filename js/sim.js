// The world: a clock, the sun and solar indices, space weather, a few hundred stations
// and the contacts (QSOs) they make. Each simulated minute some stations call CQ; a
// caller picks a band that's open from where it is and works whoever answers best. DOM-free
// and fully determined by the seed.

import { createRng } from './rng.js';
import { BANDS, MODES, path, subsolar, distance, report, cosZenith, MAX_ES_HOP } from './iono.js';
import { makeStations, CENTRES } from './stations.js';

export const STEP = 1; // simulated minutes per step
const STATIONS = 240;
const CQ_RATE = 0.6; // calls per minute across the world
const KEEP_QSOS = 240;
const PROBES = 90; // fixed station pairs used to grade each band
// How popular each band is with operators, all else equal.
const POPULARITY = { '160m': 0.4, '80m': 0.8, '40m': 1.3, '30m': 0.8, '20m': 1.6, '17m': 0.9, '15m': 1.1, '12m': 0.6, '10m': 1, '6m': 0.7 };
export const LEVELS = ['closed', 'poor', 'fair', 'good'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createWorld(seed) {
  const rng = createRng(seed);
  const stations = makeStations(rng, STATIONS);
  const day = rng.int(0, 364);
  const world = {
    seed, rng, stations,
    minute: day * 1440 + rng.int(0, 23) * 60,
    startMinute: 0,
    year: 2026,
    sfiBase: Math.round(rng.range(70, 230)),
    sfi: 0,
    kp: rng.range(0.5, 2.5),
    kpQuiet: rng.range(0.7, 2.3),
    storm: 0, // minutes of storm left
    flare: 0, // extra D-layer absorption, decays
    es: [], // sporadic-E clouds
    qsos: [], // newest last
    nextQso: 1,
    events: [],
    bands: BANDS.map((b) => ({ ...b, open: 0, level: 0, best: null, count: 0 })),
    probes: [],
    totals: { qsos: 0, km: 0, flares: 0, storms: 0, es: 0 },
  };
  world.startMinute = world.minute;
  // Each station's neighbours (within one sporadic-E hop), for regional contacts.
  for (const a of stations) a.near = stations.filter((b) => b !== a && distance(a, b) < MAX_ES_HOP);
  world.sfi = world.sfiBase;
  // Probe paths: long enough to need the ionosphere, spread over the stations.
  while (world.probes.length < PROBES) {
    const a = rng.pick(stations);
    const b = rng.pick(stations);
    if (a !== b && distance(a, b) > 1500) world.probes.push([a, b]);
  }
  world.sun = subsolar(world.minute);
  grade(world, true);
  return world;
}

export function context(world) {
  return { sun: world.sun, sfi: world.sfi, kp: world.kp, flare: world.flare, es: world.es };
}

function emit(world, type, data) {
  world.events.push({ type, minute: world.minute, ...data });
}

// Station gain on a band: beams only work on the higher bands, and the low bands need
// antennas far bigger than most people have room for, so they lose a lot.
const gain = (s, band) => (band.f >= 14 ? s.antenna.high : s.antenna.low) - Math.max(0, 14 - 1.9 * band.f);
const asEnd = (s, band) => ({ lat: s.lat, lon: s.lon, power: s.power, gain: gain(s, band) });

// How likely a station is to be on the air now, from its local solar time and habits.
function activity(s, minute) {
  const local = ((minute % 1440) / 60 + s.lon / 15 + 24) % 24;
  const d = Math.min(Math.abs(local - s.habit), 24 - Math.abs(local - s.habit));
  const awake = local > 6.5 && local < 23.5 ? 1 : 0.15;
  return s.keenness * awake * (0.35 + 0.65 * Math.exp(-((d / 3) ** 2)));
}

// --- space weather -----------------------------------------------------------------

function nearestPlace(lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const c of CENTRES) {
    const d = distance({ lat, lon }, { lat: c[1], lon: c[2] });
    if (d < bestD) {
      bestD = d;
      best = c[0];
    }
  }
  return bestD < 1500 ? best : null;
}

function weather(world) {
  const { rng } = world;
  // Solar flux wanders a little day to day around the run's level.
  if (world.minute % 60 === 0) world.sfi = clamp(world.sfi + rng.gauss() * 2 + (world.sfiBase - world.sfi) * 0.02, 66, 260);

  // Geomagnetic storms: a few times a month, more often near solar maximum.
  if (world.storm > 0) {
    world.storm -= STEP;
    if (world.storm <= 0) emit(world, 'calm', {});
  } else if (rng.chance((STEP / (1440 * 9)) * (0.5 + world.sfi / 200))) {
    world.storm = rng.int(18, 40) * 60;
    world.stormKp = rng.weighted([[5, 0.45], [6, 0.3], [7, 0.17], [8, 0.08]]);
    world.totals.storms++;
    emit(world, 'storm', { kp: world.stormKp });
  }
  const kpTarget = world.storm > 0 ? world.stormKp + rng.gauss() * 0.4 : world.kpQuiet;
  world.kp = clamp(world.kp + (kpTarget - world.kp) * 0.01 * STEP, 0, 9);

  // Flares: X-ray bursts that black out the sunlit side, mostly the low bands.
  world.flare *= Math.exp(-STEP / 25);
  if (rng.chance((STEP / 1440) * Math.max(0, (world.sfi - 75) / 70))) {
    const x = rng.chance(0.15);
    const size = x ? rng.range(1, 4) : rng.range(1, 9);
    world.flare += x ? 6 + size * 3 : 1.5 + size * 0.3;
    world.totals.flares++;
    emit(world, 'flare', { cls: `${x ? 'X' : 'M'}${size.toFixed(1)}`, x });
  }

  // Sporadic E: patchy clouds in local summer daytime at mid-latitudes.
  world.es = world.es.filter((c) => (c.life -= STEP) > 0);
  for (const c of world.es) c.foEs = clamp(c.foEs + rng.gauss() * 0.25, 3, 18);
  const dayOfYear = (world.minute / 1440) % 365;
  const nSummer = Math.max(0, Math.cos(((dayOfYear - 172) / 365) * 2 * Math.PI));
  const sSummer = Math.max(0, -Math.cos(((dayOfYear - 172) / 365) * 2 * Math.PI));
  for (const [hemi, season] of [[1, nSummer], [-1, sSummer]]) {
    if (season < 0.4 || world.es.length >= 4) continue;
    if (!rng.chance(STEP * 0.004 * season ** 2)) continue;
    // Clouds form over the sunlit mid-latitudes; put them where someone will notice.
    const over = rng.pick(world.stations);
    if (Math.sign(over.lat) !== hemi || Math.abs(over.lat) < 25 || Math.abs(over.lat) > 58) continue;
    const lat = over.lat + rng.range(-6, 6);
    const wrapped = ((over.lon + rng.range(-8, 8) + 540) % 360) - 180;
    if (cosZenith(lat, wrapped, world.sun) < 0.25) continue;
    const cloud = { lat, lon: wrapped, radius: rng.range(250, 600), foEs: rng.range(7, 14), life: rng.range(40, 180) };
    world.es.push(cloud);
    world.totals.es++;
    emit(world, 'es', { place: nearestPlace(lat, wrapped), lat, lon: wrapped, foEs: cloud.foEs });
  }
}

// --- band grading --------------------------------------------------------------------

// Fraction of the probe paths each band can carry by CW, as a level from closed to good.
function grade(world, quiet = false) {
  const ctx = context(world);
  for (const band of world.bands) {
    let ok = 0;
    for (const [a, b] of world.probes) {
      const p = path(asEnd(a, band), asEnd(b, band), band, ctx);
      if (p && p.snr >= MODES.CW) ok++;
    }
    band.open = ok / world.probes.length;
    // Closed below 2% of paths, or below 5% if it was already closed, so a band hovering
    // at the edge doesn't flap open and shut.
    const closed = band.open < (band.level === 0 ? 0.05 : 0.02);
    const level = closed ? 0 : band.open < 0.15 ? 1 : band.open < 0.35 ? 2 : 3;
    if (!quiet && level === 0 && band.level > 0) emit(world, 'close', { band: band.name });
    if (!quiet && level > 0 && band.level === 0) emit(world, 'open', { band: band.name, open: band.open });
    band.level = level;
  }
}

// --- contacts ------------------------------------------------------------------------

function pickCaller(world) {
  const { rng, stations } = world;
  for (let tries = 0; tries < 30; tries++) {
    const s = rng.pick(stations);
    if (rng.chance(activity(s, world.minute))) return s;
  }
  return null;
}

function cq(world) {
  const { rng, stations } = world;
  const caller = pickCaller(world);
  if (!caller) return;
  const ctx = context(world);
  const need = MODES[caller.mode];
  // Who could answer: a handful of other stations that are on the air.
  // Mostly anyone, anywhere; a few from the caller's own region.
  const pool = [];
  for (let i = 0; i < 18; i++) {
    const s = i < 5 && caller.near.length ? rng.pick(caller.near) : rng.pick(stations);
    if (s !== caller && rng.chance(0.3 + activity(s, world.minute))) pool.push(s);
  }
  // Which bands work from here, and to whom.
  const options = [];
  for (const band of world.bands) {
    const heard = [];
    for (const s of pool) {
      const p = path(asEnd(caller, band), asEnd(s, band), band, ctx);
      if (!p) continue;
      const snr = p.snr + rng.gauss() * 4; // fading
      if (snr >= need) heard.push({ s, p, snr });
    }
    // Operators pile onto an opening on the magic band.
    const magic = band.name === '6m' ? 4 : 1;
    if (heard.length) options.push([{ band, heard }, magic * POPULARITY[band.name] * Math.sqrt(heard.length) * (caller.dxer ? band.f / 14 : 1)]);
  }
  if (!options.length) return;
  const { band, heard } = rng.weighted(options);
  // A DXer works the furthest station; anyone else the loudest, more or less.
  const pickFrom = caller.dxer
    ? heard.sort((x, y) => y.p.D - x.p.D)
    : heard.sort((x, y) => y.snr - x.snr + rng.gauss() * 6);
  const { s: other, p, snr } = pickFrom[0];
  const qso = {
    id: world.nextQso++, minute: world.minute, a: caller, b: other, band: band.name, color: band.color, f: band.f,
    mode: caller.mode, snr, rst: report(caller.mode, snr), D: p.D, hops: p.hops, prop: p.mode,
    points: p.points, grey: p.grey,
  };
  world.qsos.push(qso);
  if (world.qsos.length > KEEP_QSOS) world.qsos.shift();
  caller.qsos++;
  other.qsos++;
  band.count++;
  world.totals.qsos++;
  world.totals.km += p.D;
  if (!band.best || p.D > band.best.D) {
    // Only a clear new best is news, and not while the first few hours fill the table.
    const news = band.best && p.D > band.best.D + 800 && world.minute - world.startMinute > 360;
    band.best = qso;
    if (news) emit(world, 'record', { qso });
  } else if (p.mode === 'Es' && band.name === '6m') {
    emit(world, 'six', { qso });
  } else if (p.grey && band.f < 8 && p.D > 8000) {
    emit(world, 'greyline', { qso });
  }
}

// Poisson-distributed count with mean m.
function poisson(rng, m) {
  let k = 0;
  let p = Math.exp(-m);
  let s = p;
  const u = rng.next();
  while (u > s && k < 20) {
    k++;
    p *= m / k;
    s += p;
  }
  return k;
}

export function step(world) {
  world.minute += STEP;
  world.sun = subsolar(world.minute);
  weather(world);
  if (world.minute % 15 === 0) grade(world);
  const n = poisson(world.rng, CQ_RATE * STEP);
  for (let i = 0; i < n; i++) cq(world);
  if (world.minute % 1440 === 0) emit(world, 'day', { sfi: Math.round(world.sfi), kp: world.kp });
}

// Clock helpers.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
export function clock(minute) {
  const m = ((minute % 1440) + 1440) % 1440;
  const doy = Math.floor(minute / 1440) % 365;
  let mo = 11;
  while (MONTH_START[mo] > doy) mo--;
  return {
    hhmm: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
    date: `${doy - MONTH_START[mo] + 1} ${MONTHS[mo]}`,
  };
}

export const kpLabel = (kp) => (kp >= 7 ? 'severe storm' : kp >= 6 ? 'strong storm' : kp >= 5 ? 'storm' : kp >= 4 ? 'unsettled' : 'quiet');

export { MAX_ES_HOP };
