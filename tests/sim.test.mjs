import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, step, clock } from '../js/sim.js';
import { locator, isLand, makeStations } from '../js/stations.js';
import { createRng } from '../js/rng.js';

test('a seed replays the same run', () => {
  const a = createWorld(11);
  const b = createWorld(11);
  for (let i = 0; i < 300; i++) {
    step(a);
    step(b);
  }
  assert.equal(a.totals.qsos, b.totals.qsos);
  assert.deepEqual(a.qsos.map((q) => q.a.call + q.b.call), b.qsos.map((q) => q.a.call + q.b.call));
});

test('stations are on land with unique calls and valid locators', () => {
  const stations = makeStations(createRng(3), 200);
  assert.equal(new Set(stations.map((s) => s.call)).size, 200);
  for (const s of stations) {
    assert.match(s.call, /^[A-Z0-9]{1,3}[0-9][A-Z]{1,4}$/);
    assert.match(s.grid, /^[A-R]{2}[0-9]{2}[a-x]{2}$/);
  }
  assert.ok(stations.filter((s) => isLand(s.lat, s.lon)).length > 190);
});

test('Maidenhead locators', () => {
  assert.equal(locator(51.5, -0.12).slice(0, 4), 'IO91');
  assert.equal(locator(40.7, -74).slice(0, 4), 'FN30');
  assert.equal(locator(-33.9, 151.2).slice(0, 4), 'QF56');
});

test('the land mask knows land from sea', () => {
  assert.equal(isLand(48.9, 2.35), 1); // Paris
  assert.equal(isLand(-25, 135), 1); // Australia
  assert.equal(isLand(30, -40), 0); // mid-Atlantic
  assert.equal(isLand(0, -150), 0); // Pacific
});

test('a day on the air makes plenty of contacts on several bands', () => {
  const w = createWorld(5);
  for (let i = 0; i < 1440; i++) step(w);
  assert.ok(w.totals.qsos > 400, `${w.totals.qsos} contacts`);
  assert.ok(new Set(w.qsos.map((q) => q.band)).size >= 4);
  for (const q of w.qsos) assert.ok(q.D > 0 && q.a !== q.b);
});

test('the clock formats UTC and the date', () => {
  assert.deepEqual(clock(0), { hhmm: '00:00', date: '1 Jan' });
  assert.deepEqual(clock(31 * 1440 + 75), { hhmm: '01:15', date: '1 Feb' });
  assert.equal(clock(364 * 1440).date, '31 Dec');
});
