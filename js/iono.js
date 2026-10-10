// A simplified HF propagation model. The sun's position sets how strongly each point of
// the ionosphere is ionised. The F2 layer's critical frequency (foF2) follows the sun and
// the solar flux, the secant law turns it into a maximum usable frequency (MUF) for a
// hop of a given length, and the daytime D layer absorbs the low bands. A path works on
// a band when the band is under the MUF at every reflection point and the signal is still
// above the noise. Sporadic-E clouds, grey-line enhancement, flares and geomagnetic
// storms ride on top. DOM-free.
//
// It is a toy, not VOACAP: the numbers are in the right ballpark and the behaviour (which
// bands open when, and where) is right, but don't plan a contest with it.

export const R_EARTH = 6371; // km
const F2_HEIGHT = 300; // km
const ES_HEIGHT = 110; // km
export const MAX_HOP = 3800; // km, the longest F2 hop at a low take-off angle
export const MAX_ES_HOP = 2200; // km
const RAD = Math.PI / 180;

export const BANDS = [
  { name: '160m', f: 1.84, color: '#8a6bff' },
  { name: '80m', f: 3.6, color: '#5b8cff' },
  { name: '40m', f: 7.1, color: '#3fc3ff' },
  { name: '30m', f: 10.13, color: '#3fe0c0' },
  { name: '20m', f: 14.1, color: '#5be36b' },
  { name: '17m', f: 18.1, color: '#b6e84a' },
  { name: '15m', f: 21.1, color: '#ffe14a' },
  { name: '12m', f: 24.9, color: '#ffb340' },
  { name: '10m', f: 28.4, color: '#ff7b3a' },
  { name: '6m', f: 50.3, color: '#ff4a6a' },
];

// Minimum signal-to-noise (dB in 2.5 kHz) to complete a contact in each mode.
export const MODES = { FT8: -20, CW: -3, SSB: 8 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// --- the sun ---------------------------------------------------------------------

// Subsolar point for a UTC time in minutes since the start of the year (ignoring the
// equation of time, which is worth a quarter of an hour at most).
export function subsolar(minutes) {
  const day = minutes / 1440;
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10));
  const utcHours = (minutes % 1440) / 60;
  let lon = -15 * (utcHours - 12);
  if (lon < -180) lon += 360;
  return { lat: decl, lon };
}

export function cosZenith(lat, lon, sun) {
  return Math.sin(lat * RAD) * Math.sin(sun.lat * RAD) + Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos((lon - sun.lon) * RAD);
}

// --- geometry --------------------------------------------------------------------

export function distance(a, b) {
  const dlat = (b.lat - a.lat) * RAD;
  const dlon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dlon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The point a fraction t of the way along the great circle from a to b.
export function along(a, b, t) {
  const d = distance(a, b) / R_EARTH;
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const p1 = a.lat * RAD;
  const l1 = a.lon * RAD;
  const p2 = b.lat * RAD;
  const l2 = b.lon * RAD;
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lon: Math.atan2(y, x) / RAD };
}

// Take-off angle (degrees) and the secant of the angle of incidence at the layer, for one
// hop of ground length d (km) off a layer at height h.
export function hopGeometry(d, h) {
  const theta = d / (2 * R_EARTH);
  const k = R_EARTH / (R_EARTH + h);
  const elev = Math.atan2(Math.cos(theta) - k, Math.sin(theta));
  const sinI = k * Math.cos(elev);
  return { elev: elev / RAD, sec: 1 / Math.sqrt(1 - sinI * sinI) };
}

// Geomagnetic latitude, from a tilted dipole (north pole near 80.7°N 72.7°W).
const POLE = { lat: 80.7, lon: -72.7 };
export function magLat(lat, lon) {
  return 90 - distance({ lat, lon }, POLE) / (R_EARTH * RAD);
}
export const MAG_POLES = [POLE, { lat: -80.7, lon: 107.3 }];

// --- the ionosphere --------------------------------------------------------------

// F2 critical frequency (MHz) at a point. sfi is the 10.7 cm solar flux, kp the planetary
// geomagnetic index.
export function foF2(lat, lon, sun, sfi, kp = 0) {
  const c = cosZenith(lat, lon, sun);
  const day = 5.8 + 0.042 * (sfi - 70);
  const night = 2.9 + 0.016 * (sfi - 70);
  // Ionisation builds after sunrise and lingers after sunset, so use a softened zenith.
  const lit = clamp((c + 0.12) / 1.12, 0, 1) ** 0.6;
  let f = night + (day - night) * lit;
  const ml = magLat(lat, lon);
  // The equatorial anomaly: crests about 15° either side of the magnetic equator, by day.
  f *= 1 + 0.28 * lit * Math.exp(-(((Math.abs(ml) - 15) / 9) ** 2));
  // Polar regions are weaker, and a storm depresses them further.
  if (Math.abs(ml) > 55) f *= 1 - 0.18 * clamp((Math.abs(ml) - 55) / 20, 0, 1) - 0.06 * Math.max(0, kp - 4);
  return Math.max(1.5, f);
}

// D-layer absorption (dB) for one pass through the layer at frequency f (MHz).
function absorption(c, f, sfi, flare) {
  if (c <= 0) return 0;
  return (90 * (1 + 0.006 * (sfi - 70)) * (1 + flare) * c ** 1.1) / (f + 1.2) ** 2;
}

// The auroral oval absorbs when the field is disturbed.
function auroral(lat, lon, kp, f) {
  if (kp < 4) return 0;
  const ml = Math.abs(magLat(lat, lon));
  const edge = 67 - 2.5 * (kp - 4);
  if (ml < edge) return 0;
  return ((kp - 3) * 8) / (f / 5);
}

// Man-made noise in a quiet rural spot (ITU-R P.372), dBW in 2.5 kHz.
export function noiseFloor(f) {
  return -204 + 10 * Math.log10(2500) + (67.2 - 27.7 * Math.log10(f));
}

// Evaluate one path at one band. ctx: { sun, sfi, kp, flare, es }. a, b: { lat, lon,
// power (W), gain (dBi) }. Returns null if the band can't carry it, else the details.
export function path(a, b, band, ctx) {
  const D = distance(a, b);
  const f = band.f;
  // Ground wave, for a short hop around the block.
  if (D < 60) return { mode: 'ground', hops: 0, snr: 25 - D / 4 - f / 4, mufs: [], points: [], D };

  let best = null;
  // Sporadic-E: one hop off a cloud near the path's midpoint.
  if (D <= MAX_ES_HOP && ctx.es?.length) {
    const mid = along(a, b, 0.5);
    for (const cloud of ctx.es) {
      if (distance(mid, cloud) > cloud.radius) continue;
      const g = hopGeometry(Math.max(D, 400), ES_HEIGHT);
      const muf = cloud.foEs * g.sec;
      if (f <= muf) best = { mode: 'Es', hops: 1, mufs: [muf], points: [mid], D, sec: g.sec };
    }
  }
  if (!best) {
    const hops = Math.max(1, Math.ceil(D / MAX_HOP));
    const g = hopGeometry(D / hops, F2_HEIGHT);
    const points = [];
    const mufs = [];
    for (let k = 0; k < hops; k++) {
      const p = along(a, b, (k + 0.5) / hops);
      const muf = foF2(p.lat, p.lon, ctx.sun, ctx.sfi, ctx.kp) * g.sec;
      points.push(p);
      mufs.push(muf);
      if (f > muf) return null;
    }
    // (The skip zone falls out of the secant law: a short hop meets the layer steeply, so
    // its MUF is barely above foF2 and the higher bands punch straight through.)
    best = { mode: 'F2', hops, mufs, points, D, sec: g.sec };
  }

  // Signal budget.
  const slant = best.D * Math.max(1, best.sec * 0.55);
  const spreading = 32.45 + 20 * Math.log10(f) + 20 * Math.log10(slant);
  let loss = spreading + 2.5 * (best.hops - 1);
  // D-layer absorption: twice per hop (up and down), at the hop ends and the middle.
  const ends = [a, ...best.points, b];
  let absorb = 0;
  for (const p of ends) {
    const c = cosZenith(p.lat, p.lon, ctx.sun);
    absorb += absorption(c, f, ctx.sfi, ctx.flare) * (best.sec ?? 1) + auroral(p.lat, p.lon, ctx.kp, f);
  }
  // Grey line: both ends near the terminator, so the low bands escape absorption and
  // signals duct along the edge of night.
  const ca = cosZenith(a.lat, a.lon, ctx.sun);
  const cb = cosZenith(b.lat, b.lon, ctx.sun);
  const grey = Math.abs(ca) < 0.12 && Math.abs(cb) < 0.12;
  if (grey) absorb *= 0.4;
  // Even at night the low bands lose a little in the residual E region on every hop.
  absorb += (best.hops * 8) / (f * f);
  loss += absorb;
  // Margin below the MUF: signals right at the MUF are weak and fluttery.
  const minMuf = Math.min(...best.mufs);
  const nearMuf = clamp((f / minMuf - 0.85) / 0.15, 0, 1) * 10;
  loss += nearMuf;
  const signal = 10 * Math.log10(a.power) + a.gain + b.gain - loss + (grey ? 4 : 0);
  const snr = signal - noiseFloor(f);
  return { ...best, snr, absorb, grey, minMuf };
}

// RST-style report from SNR.
export function report(mode, snr) {
  if (mode === 'FT8') return `${snr >= 0 ? '+' : ''}${String(Math.round(clamp(snr, -24, 20))).padStart(2, '0')}`;
  const s = clamp(Math.round(1 + (snr + 5) / 4), 1, 9);
  const r = snr > 15 ? 5 : snr > 5 ? 4 : 3;
  return mode === 'CW' ? `${r}${s}9` : `${r}${s}`;
}
