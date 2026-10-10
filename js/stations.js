// Amateur stations: where they are, what they're called, and what they run. Stations
// cluster around real centres of amateur radio activity, with callsign prefixes that
// match the country (the ITU allocations) and Maidenhead locators. The calls are random,
// so any resemblance to a real licensee's call is a coincidence. DOM-free.

import { MASK } from './land.js';

// [country, lat, lon, weight, callsign patterns]. In a pattern, # is a digit, @ a letter,
// and anything else is literal.
const CENTRES = [
  ['USA', 42.4, -71.1, 4, ['K1@@', 'W1@@@', 'N1@@', 'AA1@@', 'KB1@@@']],
  ['USA', 40.7, -74.0, 5, ['K2@@', 'W2@@@', 'N2@@', 'KC2@@@', 'AB2@@']],
  ['USA', 39.9, -75.2, 3, ['K3@@', 'W3@@@', 'N3@@', 'KD3@@@']],
  ['USA', 33.7, -84.4, 5, ['K4@@', 'W4@@@', 'N4@@', 'KJ4@@@', 'AC4@@']],
  ['USA', 32.8, -96.8, 4, ['K5@@', 'W5@@@', 'N5@@', 'KF5@@@']],
  ['USA', 34.0, -118.2, 5, ['K6@@', 'W6@@@', 'N6@@', 'KI6@@@', 'AA6@@']],
  ['USA', 37.7, -122.4, 3, ['K6@@', 'W6@@@', 'N6@@']],
  ['USA', 47.6, -122.3, 3, ['K7@@', 'W7@@@', 'N7@@', 'KE7@@@']],
  ['USA', 33.4, -112.0, 2, ['K7@@', 'W7@@@', 'N7@@']],
  ['USA', 42.3, -83.0, 3, ['K8@@', 'W8@@@', 'N8@@', 'KD8@@@']],
  ['USA', 41.9, -87.6, 4, ['K9@@', 'W9@@@', 'N9@@', 'KC9@@@']],
  ['USA', 39.7, -105.0, 2, ['K0@@', 'W0@@@', 'N0@@', 'KD0@@@']],
  ['USA', 44.9, -93.3, 2, ['K0@@', 'W0@@@', 'N0@@']],
  ['Alaska', 61.2, -149.9, 0.6, ['KL7@@', 'AL7@@', 'NL7@@']],
  ['Hawaii', 21.3, -157.8, 0.7, ['KH6@@', 'AH6@@', 'NH6@@']],
  ['Canada', 43.7, -79.4, 3, ['VE3@@', 'VE3@@@', 'VA3@@@']],
  ['Canada', 45.5, -73.6, 1.5, ['VE2@@', 'VE2@@@', 'VA2@@@']],
  ['Canada', 49.3, -123.1, 1.5, ['VE7@@', 'VE7@@@', 'VA7@@@']],
  ['Canada', 51.0, -114.1, 1, ['VE6@@', 'VE6@@@']],
  ['Mexico', 19.4, -99.1, 1.2, ['XE1@@', 'XE1@@@']],
  ['Cuba', 23.1, -82.4, 0.5, ['CO2@@', 'CM2@@']],
  ['Puerto Rico', 18.4, -66.1, 0.6, ['KP4@@', 'NP4@@', 'WP4@@@']],
  ['Brazil', -23.5, -46.6, 2.5, ['PY2@@@', 'PU2@@@', 'PP2@@']],
  ['Brazil', -22.9, -43.2, 1.5, ['PY1@@@', 'PU1@@@']],
  ['Argentina', -34.6, -58.4, 1.8, ['LU#@@', 'LU#@@@', 'LW#@@@']],
  ['Chile', -33.4, -70.7, 0.8, ['CE3@@@', 'CA3@@@']],
  ['Peru', -12.0, -77.0, 0.5, ['OA4@@@']],
  ['Colombia', 4.6, -74.1, 0.6, ['HK3@@', 'HK3@@@']],
  ['Venezuela', 10.5, -66.9, 0.5, ['YV5@@@']],
  ['England', 51.5, -0.1, 4, ['G#@@@', 'M0@@@', 'M#@@@', '2E0@@@']],
  ['England', 53.5, -2.2, 2.5, ['G#@@@', 'M0@@@', 'M#@@@']],
  ['Scotland', 55.9, -3.2, 1, ['GM#@@@', 'MM0@@@']],
  ['Wales', 51.5, -3.2, 0.7, ['GW#@@@', 'MW0@@@']],
  ['Northern Ireland', 54.6, -5.9, 0.4, ['GI#@@@', 'MI0@@@']],
  ['Ireland', 53.3, -6.3, 0.8, ['EI#@@', 'EI#@@@']],
  ['Germany', 52.5, 13.4, 3, ['DL#@@@', 'DK#@@', 'DJ#@@', 'DF#@@', 'DO#@@@']],
  ['Germany', 48.1, 11.6, 3, ['DL#@@@', 'DK#@@', 'DG#@@@', 'DB#@@']],
  ['Germany', 50.9, 7.0, 3, ['DL#@@@', 'DK#@@', 'DJ#@@', 'DH#@@']],
  ['France', 48.9, 2.35, 2.5, ['F#@@@', 'F4@@@', 'F5@@@', 'F6@@@']],
  ['France', 45.8, 4.8, 1.5, ['F#@@@', 'F4@@@', 'F8@@@']],
  ['Spain', 40.4, -3.7, 2, ['EA4@@', 'EA4@@@', 'EB4@@@', 'EC4@@']],
  ['Spain', 41.4, 2.2, 1.5, ['EA3@@', 'EA3@@@', 'EB3@@@']],
  ['Canary Islands', 28.1, -15.4, 0.4, ['EA8@@', 'EA8@@@']],
  ['Portugal', 38.7, -9.1, 0.8, ['CT1@@@', 'CT2@@@', 'CS7@@@']],
  ['Italy', 41.9, 12.5, 2, ['I0@@@', 'IK0@@@', 'IZ0@@@']],
  ['Italy', 45.5, 9.2, 2, ['I2@@@', 'IK2@@@', 'IZ2@@@']],
  ['Netherlands', 52.4, 4.9, 1.8, ['PA#@@@', 'PD#@@@', 'PE#@@@']],
  ['Belgium', 50.85, 4.35, 1, ['ON#@@', 'ON#@@@', 'ON4@@@']],
  ['Switzerland', 47.4, 8.5, 0.9, ['HB9@@@', 'HB9@@']],
  ['Austria', 48.2, 16.4, 0.9, ['OE#@@@', 'OE#@@']],
  ['Poland', 52.2, 21.0, 1.5, ['SP#@@@', 'SQ#@@@', 'SO#@@']],
  ['Czechia', 50.1, 14.4, 1, ['OK#@@', 'OK#@@@', 'OL#@']],
  ['Hungary', 47.5, 19.0, 0.8, ['HA#@@', 'HA#@@@', 'HG#@@']],
  ['Sweden', 59.3, 18.1, 1, ['SM#@@@', 'SA#@@@', 'SM#@@']],
  ['Norway', 59.9, 10.75, 0.7, ['LA#@@', 'LA#@@@', 'LB#@@']],
  ['Finland', 60.2, 24.9, 0.8, ['OH#@@', 'OH#@@@', 'OG#@']],
  ['Denmark', 55.7, 12.6, 0.7, ['OZ#@@', 'OZ#@@@', 'OU#@']],
  ['Iceland', 64.1, -21.9, 0.2, ['TF#@@', 'TF#@@@']],
  ['European Russia', 55.75, 37.6, 2.5, ['UA3@@@', 'RA3@@', 'R3@@', 'RN3@@']],
  ['European Russia', 59.9, 30.3, 1.2, ['UA1@@@', 'RA1@@', 'R1@@']],
  ['Asiatic Russia', 55.0, 82.9, 1, ['UA9@@@', 'RA9@@', 'R9@@']],
  ['Asiatic Russia', 56.8, 60.6, 1, ['UA9@@@', 'RA9@@', 'RK9@@']],
  ['Asiatic Russia', 43.1, 131.9, 0.5, ['UA0@@@', 'RA0@@', 'R0@@']],
  ['Ukraine', 50.45, 30.5, 1.5, ['UR#@@@', 'UT#@@', 'US#@@@']],
  ['Lithuania', 54.7, 25.3, 0.5, ['LY#@@', 'LY#@@@']],
  ['Greece', 37.98, 23.7, 0.8, ['SV#@@@', 'SV#@@']],
  ['Turkey', 41.0, 29.0, 0.8, ['TA#@@', 'TA#@@@']],
  ['Romania', 44.4, 26.1, 0.8, ['YO#@@@', 'YO#@@']],
  ['Bulgaria', 42.7, 23.3, 0.6, ['LZ#@@', 'LZ#@@@']],
  ['Serbia', 44.8, 20.5, 0.5, ['YU#@@', 'YT#@@']],
  ['Croatia', 45.8, 16.0, 0.5, ['9A#@@', '9A#@@@']],
  ['Slovenia', 46.05, 14.5, 0.5, ['S5#@@', 'S5#@@@']],
  ['South Africa', -26.2, 28.0, 1, ['ZS6@@', 'ZS6@@@', 'ZR6@@']],
  ['South Africa', -33.9, 18.4, 0.7, ['ZS1@@', 'ZS1@@@']],
  ['Kenya', -1.3, 36.8, 0.3, ['5Z4@@']],
  ['Morocco', 33.6, -7.6, 0.4, ['CN8@@', 'CN8@@@']],
  ['Egypt', 30.0, 31.2, 0.3, ['SU1@@']],
  ['Nigeria', 6.5, 3.4, 0.3, ['5N7@@', '5N0@@@']],
  ['Israel', 32.1, 34.8, 0.6, ['4X#@@', '4Z#@@']],
  ['UAE', 25.2, 55.3, 0.4, ['A61@@', 'A65@@']],
  ['Saudi Arabia', 24.7, 46.7, 0.3, ['HZ1@@']],
  ['Kazakhstan', 43.2, 76.9, 0.5, ['UN7@@', 'UN#@@@']],
  ['India', 19.1, 72.9, 1, ['VU2@@@', 'VU3@@@']],
  ['India', 13.0, 77.6, 1, ['VU2@@@', 'VU3@@@']],
  ['India', 28.6, 77.2, 0.8, ['VU2@@@']],
  ['Sri Lanka', 6.9, 79.9, 0.2, ['4S7@@']],
  ['Pakistan', 24.9, 67.0, 0.3, ['AP2@@']],
  ['Japan', 35.7, 139.7, 5, ['JA1@@@', 'JH1@@@', 'JR1@@@', 'JE1@@@', '7K1@@@']],
  ['Japan', 34.7, 135.5, 3, ['JA3@@@', 'JH3@@@', 'JR3@@@', 'JF3@@@']],
  ['Japan', 43.06, 141.35, 1, ['JA8@@@', 'JH8@@@']],
  ['Japan', 33.6, 130.4, 1.2, ['JA6@@@', 'JH6@@@']],
  ['South Korea', 37.6, 127.0, 1.5, ['HL1@@@', 'DS1@@@', 'DS2@@@']],
  ['China', 39.9, 116.4, 1.5, ['BY1@@', 'BG1@@@', 'BD1@@']],
  ['China', 31.2, 121.5, 1.2, ['BH4@@@', 'BG4@@@', 'BA4@@']],
  ['China', 23.1, 113.3, 1, ['BG7@@@', 'BD7@@']],
  ['Taiwan', 25.0, 121.5, 0.8, ['BV2@@', 'BX2@@@', 'BM2@@@']],
  ['Hong Kong', 22.3, 114.2, 0.4, ['VR2@@']],
  ['Philippines', 14.6, 121.0, 0.8, ['DU1@@@', 'DV1@@@', '4F1@@@']],
  ['Thailand', 13.75, 100.5, 0.6, ['HS0@@@', 'E2#@@@']],
  ['Malaysia', 3.1, 101.7, 0.5, ['9M2@@@', '9W2@@@']],
  ['Singapore', 1.35, 103.8, 0.3, ['9V1@@']],
  ['Indonesia', -6.2, 106.8, 1.2, ['YB0@@@', 'YC0@@@', 'YD0@@@']],
  ['Australia', -33.9, 151.2, 1.8, ['VK2@@', 'VK2@@@']],
  ['Australia', -37.8, 145.0, 1.6, ['VK3@@', 'VK3@@@']],
  ['Australia', -27.5, 153.0, 1, ['VK4@@', 'VK4@@@']],
  ['Australia', -31.95, 115.9, 0.7, ['VK6@@', 'VK6@@@']],
  ['Australia', -34.9, 138.6, 0.6, ['VK5@@', 'VK5@@@']],
  ['New Zealand', -36.85, 174.8, 0.8, ['ZL1@@', 'ZL1@@@']],
  ['New Zealand', -41.3, 174.8, 0.5, ['ZL2@@', 'ZL2@@@']],
  ['New Zealand', -43.5, 172.6, 0.4, ['ZL3@@', 'ZL3@@@']],
  ['New Caledonia', -22.3, 166.5, 0.15, ['FK8@@']],
  ['Fiji', -18.1, 178.4, 0.15, ['3D2@@']],
];

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function makeCall(rng, pattern) {
  let out = '';
  for (const ch of pattern) {
    if (ch === '#') out += rng.int(0, 9);
    else if (ch === '@') out += LETTERS[rng.int(0, 25)];
    else out += ch;
  }
  return out;
}

// Maidenhead locator to six characters (field, square, subsquare).
export function locator(lat, lon) {
  const x = Math.min(359.9999, lon + 180);
  const y = Math.min(179.9999, lat + 90);
  const A = 'ABCDEFGHIJKLMNOPQR';
  const a = 'abcdefghijklmnopqrstuvwx';
  return A[Math.floor(x / 20)] + A[Math.floor(y / 10)] +
    Math.floor((x % 20) / 2) + Math.floor(y % 10) +
    a[Math.floor((x % 2) * 12)] + a[Math.floor((y % 1) * 24)];
}

const maskBits = typeof atob === 'function'
  ? Uint8Array.from(atob(MASK), (c) => c.charCodeAt(0))
  : Uint8Array.from(Buffer.from(MASK, 'base64'));

export function isLand(lat, lon) {
  const row = Math.max(0, Math.min(179, Math.floor(90 - lat)));
  const col = ((Math.floor(lon + 180) % 360) + 360) % 360;
  const i = row * 360 + col;
  return (maskBits[i >> 3] >> (i & 7)) & 1;
}

// A station's kit: power in watts and antenna gain in dBi. Beams only help the
// higher bands, so they're stored as a separate gain.
function kit(rng) {
  const power = rng.weighted([[5, 0.08], [10, 0.06], [50, 0.08], [100, 0.6], [400, 0.1], [1000, 0.08]]);
  const antenna = rng.weighted([
    [{ kind: 'vertical', low: 0, high: 0 }, 0.25],
    [{ kind: 'dipole', low: 2, high: 2 }, 0.35],
    [{ kind: 'end-fed wire', low: 1, high: 1.5 }, 0.2],
    [{ kind: 'Yagi', low: 2, high: 9 }, 0.15],
    [{ kind: 'stacked Yagis', low: 3, high: 13 }, 0.05],
  ]);
  return { power, antenna };
}

const MODE_MIX = [['FT8', 0.55], ['CW', 0.22], ['SSB', 0.23]];

export function makeStations(rng, n) {
  const stations = [];
  const used = new Set();
  const centres = CENTRES.map((c) => [c, c[3]]);
  while (stations.length < n) {
    const [country, clat, clon, , patterns] = rng.weighted(centres);
    let lat;
    let lon;
    let tries = 0;
    do {
      lat = clat + rng.gauss() * 3;
      lon = clon + rng.gauss() * 4;
      tries++;
    } while (!isLand(lat, lon) && tries < 20);
    if (!isLand(lat, lon)) {
      lat = clat;
      lon = clon;
    }
    const call = makeCall(rng, rng.pick(patterns));
    if (used.has(call)) continue;
    used.add(call);
    const { power, antenna } = kit(rng);
    stations.push({
      id: stations.length, call, country, lat, lon, grid: locator(lat, lon), power, antenna,
      mode: rng.weighted(MODE_MIX),
      // Local hours they like to be on the air (an evening person or a morning one).
      habit: rng.chance(0.65) ? 19 + rng.range(-2, 3) : 7 + rng.range(-1, 3),
      keenness: rng.range(0.3, 1), // how often they're on the air at all
      dxer: rng.chance(0.3), // prefers distance over a quick contact
      qsos: 0,
    });
  }
  return stations;
}

export const COUNTRIES = [...new Set(CENTRES.map((c) => c[0]))];
export { CENTRES };
