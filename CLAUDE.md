# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Skywave: a seeded simulation of HF radio propagation and amateur radio contacts on a world map, shipped as an offline PWA. It's a sibling of `../Affinity` and `../Ecosystem` (and so of `../RSB`/`../RMB`) and shares their HUD, controls, panels, seed links, idle fade, service worker and version bump. There is no build step and there are no dependencies; plain ES modules load straight from `index.html`. `README.md` explains what's on screen and the model.

(The parent `../CLAUDE.md` describes the shoryuken.me workspace and its shared-origin rules; the one above that, `~/Workspace/CLAUDE.md`, is an unrelated Rust/Fallout project. Ignore that one here.)

## Commands

```bash
npm test                            # node --test tests/*.test.mjs
node --test tests/iono.test.mjs     # single file
npm run serve                       # python3 -m http.server 8080
npm run bump                        # bump js/version.js + package.json (-- minor|major)
npm run icons                       # regenerate icons/ (Pillow)
python3 scripts/make_map.py land-110m.json   # regenerate js/land.js (see the script for the download)
```

## Architecture

- `js/iono.js` (no DOM): the physics. `subsolar`, `cosZenith`, great-circle `distance`/`along`, `hopGeometry` (secant of incidence), `foF2`, `path(a, b, band, ctx)` (returns null if the band can't carry the path, else hops, reflection points, MUFs and SNR), `noiseFloor`, `report`. `BANDS` and `MODES` (SNR thresholds) live here.
- `js/stations.js` (no DOM): `CENTRES` (country, lat/lon, weight, callsign patterns), `makeStations`, `makeCall`, `locator` (Maidenhead), `isLand` (reads the 1° mask in `land.js`).
- `js/land.js`: generated; coastline rings and the land mask. Don't edit by hand. Rings that cross the date line are unwrapped past ±180°, and the renderer draws those twice.
- `js/sim.js` (no DOM): `createWorld(seed)`, `step(world)` advances one minute. Space weather (SFI drift, storms → Kp, flares → `world.flare`, sporadic-E clouds), band grading every 15 minutes against fixed probe paths (`world.bands[].level`, with hysteresis), and CQs: a caller picks an open band from a pool of possible answerers, weighted by popularity, and logs the QSO. Narration goes to `world.events`; contacts to `world.qsos` (the last 240).
- `js/render.js`: canvas. Equirectangular map, land as a cached `Path2D`, and a 120×60 overlay (night, grey line, MUF colours) recomputed every 4 simulated minutes. Also aurora, Es clouds, stations, arcs (which grow in, then fade over 9 real seconds) and the band strip. On tall screens it adds a "latest contacts" list.
- `js/app.js`: the loop runs whole minutes from `realDt × speed × 2`, narrates events, keys a CW contact in Morse now and then, and handles the HUD, panels, controls, install, wake lock and SW registration.
- `js/audio.js`: band noise with QSB, and `cw(text)` keyed with ramped envelopes. Pref in `skywave.sound`.

### Randomness and tuning

`world.rng` (seeded) drives stations, weather and contacts, so `#seed=` replays a run exactly; never use `Math.random` in `sim.js`, `iono.js` or `stations.js`. When changing the model, sanity-check familiar paths (London–New York, London–Sydney, short skip) across the day at SFI 75 and 180. Expected: 160m and 80m mostly after dark, 40m–20m the workhorses, 15m–10m by day only near solar maximum, and 6m only via sporadic-E. That's about 850 contacts per simulated day.

## Conventions and gotchas

- **Adding or renaming a file:** add it to `ASSETS` in `sw.js` (`tests/assets.test.mjs` fails otherwise), then `npm run bump`.
- **Callsigns are random:** don't put real people's calls in `CENTRES`.
- **Layout:** the feed has a fixed CSS height, and `placePanels()` reserves the band above the feed and controls.
- **Icons:** use the inline SVG sprite in `index.html`, not emoji.
- **Visual checks:** Playwright from `../JJUCompanion/node_modules` against `npm run serve`, at 1440×900 and 390×844.

## Shared origin

To be served at `/skywave/` (not deployed yet). The manifest `id` is `/skywave/` (never change it once released). localStorage keys use the `skywave.` prefix. `sw.js` uses cache prefix `skywave-`, handles only requests inside its scope, reads only its own cache (never `caches.match()`), precaches with `cache: 'reload'` and fetches with `cache: 'no-cache'`. See `../CLAUDE.md`.

## Deployment

Not deployed yet. To ship, follow "Adding a new app" in `../CLAUDE.md`, then after `npm test` and `npm run bump` copy only the served files:

```bash
rsync -a --delete --chmod=D755,F644 index.html manifest.webmanifest sw.js css js icons root@185.163.204.17:/var/www/shoryuken.me/skywave/
```
