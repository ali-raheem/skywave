import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, path, subsolar, cosZenith, distance, along, hopGeometry, foF2, report } from '../js/iono.js';

const st = (lat, lon) => ({ lat, lon, power: 100, gain: 2 });
const band = (name) => BANDS.find((b) => b.name === name);
const ctxAt = (doy, utcHour, sfi = 150) => ({ sun: subsolar(doy * 1440 + utcHour * 60), sfi, kp: 2, flare: 0, es: [] });

test('the sun is overhead at noon on the meridian, and in the right hemisphere', () => {
  const june = subsolar(172 * 1440 + 12 * 60);
  assert.ok(Math.abs(june.lon) < 1);
  assert.ok(june.lat > 23 && june.lat < 23.5);
  assert.ok(subsolar(355 * 1440 + 12 * 60).lat < -23);
  assert.ok(cosZenith(51.5, 0, june) > 0.8);
  assert.ok(cosZenith(51.5, 180, june) < 0);
});

test('great-circle helpers', () => {
  const london = st(51.5, -0.1);
  const ny = st(40.7, -74);
  assert.ok(Math.abs(distance(london, ny) - 5570) < 30);
  const mid = along(london, ny, 0.5);
  assert.ok(Math.abs(distance(london, mid) - distance(mid, ny)) < 1);
  assert.ok(hopGeometry(3000, 300).sec > 2.5 && hopGeometry(3000, 300).sec < 3.6);
  assert.ok(hopGeometry(500, 300).sec < 1.4);
});

test('the F2 layer is denser by day and at high solar flux', () => {
  const sun = subsolar(172 * 1440 + 12 * 60);
  assert.ok(foF2(45, 0, sun, 150) > foF2(45, 180, sun, 150));
  assert.ok(foF2(45, 0, sun, 220) > foF2(45, 0, sun, 80));
});

test('high bands work transatlantic by day, low bands by night', () => {
  const london = st(51.5, -0.1);
  const ny = st(40.7, -74);
  assert.ok(path(london, ny, band('15m'), ctxAt(172, 15, 180)));
  assert.equal(path(london, ny, band('15m'), ctxAt(172, 3, 180)), null);
  const night = path(london, ny, band('80m'), ctxAt(355, 3));
  const day = path(london, ny, band('80m'), ctxAt(172, 13));
  assert.ok(night.snr > (day?.snr ?? -Infinity) + 10);
});

test('a skip zone: 20m skips over a nearby station that 40m reaches', () => {
  const london = st(51.5, -0.1);
  const paris = st(48.9, 2.35);
  const ctx = ctxAt(172, 12, 120);
  assert.equal(path(london, paris, band('20m'), ctx), null);
  assert.ok(path(london, paris, band('80m'), ctx));
});

test('sporadic-E opens 6m for a single hop under a cloud', () => {
  const london = st(51.5, -0.1);
  const rome = st(41.9, 12.5);
  const ctx = ctxAt(172, 12, 90);
  assert.equal(path(london, rome, band('6m'), ctx), null);
  const mid = along(london, rome, 0.5);
  const es = [{ ...mid, radius: 400, foEs: 12, life: 60 }];
  const p = path(london, rome, band('6m'), { ...ctx, es });
  assert.equal(p.mode, 'Es');
});

test('reports read like a log', () => {
  assert.equal(report('FT8', -12.4), '-12');
  assert.equal(report('FT8', 3), '+03');
  assert.match(report('CW', 20), /^5\d9$/);
  assert.match(report('SSB', 0), /^3\d$/);
});
