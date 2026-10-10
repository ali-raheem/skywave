// Canvas renderer: an equirectangular world map with the night side, the grey line,
// an optional MUF map, aurora and sporadic-E clouds, the stations, and each contact as
// a great-circle arc with its reflection points. Below the map, a strip of band
// conditions. It reads the world; it never changes it.

import { LAND } from './land.js';
import { BANDS, cosZenith, foF2, along, magLat } from './iono.js';
import { LEVELS } from './sim.js';

const GRID_W = 120; // overlay resolution (3° cells)
const GRID_H = 60;
const ARC_POINTS = 64;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

// MUF(3000) colour: which band a 3000 km hop could reach from here.
function mufColor(muf) {
  let band = null;
  for (const b of BANDS) if (b.f <= muf) band = b;
  return band ? band.color : '#3a2a6a';
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.top = 120;
    this.bottom = 70;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.showMuf = true;
    this.showCalls = true;
    this.time = 0;
    this.arcs = new Map(); // qso id → { born (real s), path segments }
    this.overlay = document.createElement('canvas');
    this.overlay.width = GRID_W;
    this.overlay.height = GRID_H;
    this.overlayCtx = this.overlay.getContext('2d');
    this.overlayImage = this.overlayCtx.createImageData(GRID_W, GRID_H);
    this.overlayAt = -Infinity;
    this.flash = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
    this.landPath = null;
  }

  setInsets(top, bottom) {
    this.top = top;
    this.bottom = bottom;
    this.layout();
    this.landPath = null;
  }

  // The map (2:1) on top, the band strip under it. On a narrow screen the strip wraps to
  // two rows.
  // On a tall screen the map sits at the top and a list of recent contacts fills the
  // space under the strip.
  layout() {
    const pad = Math.max(10, Math.min(24, this.w * 0.02));
    const narrow = this.w < 640;
    const stripH = narrow ? 92 : 50;
    const availW = this.w - 2 * pad;
    const availH = Math.max(60, this.h - this.top - this.bottom - stripH - 10);
    const mw = Math.min(availW, availH * 2);
    const mh = mw / 2;
    const spare = availH - mh;
    const list = spare > 120;
    const y = this.top + (list ? 0 : Math.max(0, spare / 2));
    this.map = { x: (this.w - mw) / 2, y, w: mw, h: mh };
    this.strip = { x: (this.w - mw) / 2, y: y + mh + 10, w: mw, h: stripH, rows: narrow ? 2 : 1 };
    const listY = this.strip.y + stripH + 12;
    this.list = list ? { x: this.strip.x, y: listY, w: mw, h: this.h - this.bottom - listY } : null;
  }

  reset(world) {
    this.world = world;
    this.arcs.clear();
    this.overlayAt = -Infinity;
  }

  project(lat, lon) {
    const m = this.map;
    return [m.x + ((lon + 180) / 360) * m.w, m.y + ((90 - lat) / 180) * m.h];
  }

  update(realDt, world, speed) {
    this.time += realDt;
    this.speed = speed;
    this.flash = Math.max(0, this.flash - realDt * 0.6);
    // Forget arcs that have faded.
    const ids = new Set(world.qsos.map((q) => q.id));
    for (const id of this.arcs.keys()) if (!ids.has(id)) this.arcs.delete(id);
  }

  flare() {
    if (!this.reducedMotion) this.flash = 1;
  }

  draw() {
    const { ctx, w, h, world } = this;
    ctx.fillStyle = '#03060b';
    ctx.fillRect(0, 0, w, h);
    if (!world) return;
    const m = this.map;
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, m.x, m.y, m.w, m.h, 6);
    ctx.clip();
    ctx.fillStyle = '#071423';
    ctx.fillRect(m.x, m.y, m.w, m.h);
    this.drawGraticule();
    this.drawLand();
    this.drawOverlay();
    this.drawAurora();
    this.drawEs();
    this.drawSun();
    this.drawStations();
    this.drawArcs();
    ctx.restore();
    ctx.strokeStyle = 'rgba(120, 180, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundRect(ctx, m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1, 6);
    ctx.stroke();
    this.drawStrip();
    if (this.list) this.drawList();
  }

  // The latest contacts, newest first, as a log.
  drawList() {
    const { ctx, world } = this;
    const l = this.list;
    const lineH = 20;
    const rows = Math.floor((l.h - 22) / lineH);
    if (rows < 2) return;
    ctx.save();
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(132, 150, 173, 0.9)';
    ctx.textAlign = 'left';
    ctx.fillText('LATEST CONTACTS', l.x + 2, l.y + 6);
    const recent = world.qsos.slice(-rows).reverse();
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
    recent.forEach((q, i) => {
      const y = l.y + 24 + i * lineH;
      ctx.globalAlpha = 1 - (i / rows) * 0.6;
      ctx.textAlign = 'left';
      ctx.fillStyle = q.color;
      ctx.fillText(q.band.padEnd(4), l.x + 2, y);
      ctx.fillStyle = 'rgba(218, 228, 240, 0.95)';
      ctx.fillText(`${q.a.call} ↔ ${q.b.call}`, l.x + 46, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(132, 150, 173, 0.95)';
      ctx.fillText(`${q.rst.padStart(3)}  ${Math.round(q.D).toLocaleString('en-GB').padStart(6)} km`, l.x + l.w - 2, y);
    });
    ctx.restore();
  }

  drawGraticule() {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(120, 170, 230, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lon = -150; lon <= 150; lon += 30) {
      const [x, y0] = this.project(90, lon);
      const [, y1] = this.project(-90, lon);
      ctx.moveTo(Math.round(x) + 0.5, y0);
      ctx.lineTo(Math.round(x) + 0.5, y1);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const [x0, y] = this.project(lat, -180);
      const [x1] = this.project(lat, 180);
      ctx.moveTo(x0, Math.round(y) + 0.5);
      ctx.lineTo(x1, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }

  drawLand() {
    const { ctx } = this;
    if (!this.landPath) {
      const p = new Path2D();
      const add = (ring, shift) => {
        for (let i = 0; i < ring.length; i += 2) {
          const [x, y] = this.project(ring[i + 1] / 10, ring[i] / 10 + shift);
          if (i === 0) p.moveTo(x, y);
          else p.lineTo(x, y);
        }
        p.closePath();
      };
      for (const ring of LAND) {
        add(ring, 0);
        // Rings across the date line run past ±180°; draw them again a turn away.
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < ring.length; i += 2) {
          min = Math.min(min, ring[i]);
          max = Math.max(max, ring[i]);
        }
        if (max > 1800) add(ring, -360);
        if (min < -1800) add(ring, 360);
      }
      this.landPath = p;
    }
    ctx.fillStyle = '#1a2a33';
    ctx.fill(this.landPath, 'evenodd');
    ctx.strokeStyle = 'rgba(140, 190, 220, 0.35)';
    ctx.lineWidth = 0.7;
    ctx.stroke(this.landPath);
  }

  // Night shading, the grey line and the MUF map, from one coarse grid recomputed every
  // few simulated minutes and drawn smoothly scaled up.
  drawOverlay() {
    const { world, ctx } = this;
    if (world.minute - this.overlayAt >= 4 || world.minute < this.overlayAt) {
      this.overlayAt = world.minute;
      const d = this.overlayImage.data;
      const muf = this.showMuf;
      for (let gy = 0; gy < GRID_H; gy++) {
        const lat = 90 - ((gy + 0.5) / GRID_H) * 180;
        for (let gx = 0; gx < GRID_W; gx++) {
          const lon = -180 + ((gx + 0.5) / GRID_W) * 360;
          const c = cosZenith(lat, lon, world.sun);
          const night = clamp01((0.05 - c) / 0.2);
          const twilight = Math.exp(-((c / 0.045) ** 2));
          let r = 2;
          let g = 6;
          let b = 22;
          let a = night * 0.62;
          if (muf) {
            const [mr, mg, mb] = hexRgb(mufColor(foF2(lat, lon, world.sun, world.sfi, world.kp) * 3));
            const k = 0.24;
            r = r * (1 - k) + mr * k;
            g = g * (1 - k) + mg * k;
            b = b * (1 - k) + mb * k;
            a = Math.max(a, 0.2);
          }
          // The grey line glows amber.
          r = r + (255 - r) * twilight * 0.5;
          g = g + (180 - g) * twilight * 0.5;
          b = b + (90 - b) * twilight * 0.5;
          a = Math.max(a, twilight * 0.32);
          const o = (gy * GRID_W + gx) * 4;
          d[o] = r;
          d[o + 1] = g;
          d[o + 2] = b;
          d[o + 3] = a * 255;
        }
      }
      this.overlayCtx.putImageData(this.overlayImage, 0, 0);
    }
    const m = this.map;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.overlay, m.x, m.y, m.w, m.h);
    if (this.flash > 0) {
      // A flare: the sunlit side flashes.
      const [sx, sy] = this.project(world.sun.lat, world.sun.lon);
      const r = m.w * 0.3;
      for (const dx of [-m.w, 0, m.w]) {
        const g = ctx.createRadialGradient(sx + dx, sy, 0, sx + dx, sy, r);
        g.addColorStop(0, `rgba(255, 245, 200, ${0.35 * this.flash})`);
        g.addColorStop(1, 'rgba(255, 245, 200, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx + dx - r, sy - r, r * 2, r * 2);
      }
    }
  }

  drawSun() {
    const { ctx, world } = this;
    const [x, y] = this.project(world.sun.lat, world.sun.lon);
    const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
    g.addColorStop(0, 'rgba(255, 230, 140, 0.9)');
    g.addColorStop(0.3, 'rgba(255, 200, 90, 0.35)');
    g.addColorStop(1, 'rgba(255, 200, 90, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 16, y - 16, 32, 32);
  }

  // Auroral ovals when the field is disturbed: a band of glow around each magnetic pole.
  drawAurora() {
    const { ctx, world } = this;
    if (world.kp < 4) return;
    const edge = 67 - 2.5 * (world.kp - 4);
    const strength = clamp01((world.kp - 3.5) / 4);
    const flicker = this.reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(this.time * 2.3);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const step = 4;
    for (let lat = -88; lat <= 88; lat += step) {
      for (let lon = -180; lon < 180; lon += step) {
        const ml = Math.abs(magLat(lat, lon));
        const k = Math.exp(-(((ml - edge - 3) / 3.5) ** 2));
        if (k < 0.08) continue;
        const [x, y] = this.project(lat + step / 2, lon + step / 2);
        const r = (this.map.w / 360) * step * 1.4;
        ctx.fillStyle = `rgba(80, 255, 150, ${0.16 * k * strength * flicker})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawEs() {
    const { ctx, world } = this;
    for (const c of world.es) {
      const [x, y] = this.project(c.lat, c.lon);
      const r = (c.radius / 111) * (this.map.w / 360);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = clamp01(c.life / 30) * clamp01((c.foEs - 5) / 8);
      g.addColorStop(0, `rgba(255, 90, 160, ${0.4 * a})`);
      g.addColorStop(1, 'rgba(255, 90, 160, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawStations() {
    const { ctx, world } = this;
    const lit = new Map();
    for (const q of world.qsos.slice(-40)) {
      lit.set(q.a.id, q.color);
      lit.set(q.b.id, q.color);
    }
    const r = Math.max(1, this.map.w / 900);
    for (const s of world.stations) {
      const [x, y] = this.project(s.lat, s.lon);
      const c = lit.get(s.id);
      ctx.fillStyle = c ?? 'rgba(210, 225, 240, 0.4)';
      ctx.beginPath();
      ctx.arc(x, y, c ? r * 1.7 : r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Great-circle points from a to b, split where the path crosses the date line.
  arcPath(q) {
    const segs = [];
    let seg = [];
    let prev = null;
    for (let i = 0; i <= ARC_POINTS; i++) {
      const p = along(q.a, q.b, i / ARC_POINTS);
      const xy = this.project(p.lat, p.lon);
      if (prev && Math.abs(p.lon - prev.lon) > 180) {
        segs.push(seg);
        seg = [];
      }
      seg.push(xy);
      prev = p;
    }
    segs.push(seg);
    return segs;
  }

  drawArcs() {
    const { ctx, world } = this;
    const now = this.time;
    const life = 9; // seconds an arc stays on screen
    const grow = this.reducedMotion ? 0 : 0.9;
    const recent = world.qsos.slice(-60);
    ctx.lineCap = 'round';
    for (const q of recent) {
      let arc = this.arcs.get(q.id);
      if (!arc) {
        arc = { born: now, segs: this.arcPath(q), w: this.map.w };
        this.arcs.set(q.id, arc);
      }
      if (arc.w !== this.map.w) {
        arc.segs = this.arcPath(q);
        arc.w = this.map.w;
      }
      const age = now - arc.born;
      if (age > life) continue;
      const shown = grow ? clamp01(age / grow) : 1;
      const fade = 1 - clamp01((age - life * 0.55) / (life * 0.45));
      const total = arc.segs.reduce((n, s) => n + s.length, 0);
      let budget = Math.ceil(total * shown);
      ctx.strokeStyle = q.color;
      ctx.globalAlpha = 0.85 * fade;
      ctx.lineWidth = 1.4;
      if (!this.reducedMotion && age < 2) {
        ctx.shadowColor = q.color;
        ctx.shadowBlur = 8;
      }
      for (const seg of arc.segs) {
        if (budget <= 0) break;
        ctx.beginPath();
        const n = Math.min(seg.length, budget);
        for (let i = 0; i < n; i++) {
          if (i === 0) ctx.moveTo(seg[i][0], seg[i][1]);
          else ctx.lineTo(seg[i][0], seg[i][1]);
        }
        ctx.stroke();
        budget -= n;
      }
      ctx.shadowBlur = 0;
      // Reflection points: where the signal turned in the ionosphere.
      if (shown >= 1) {
        ctx.fillStyle = q.prop === 'Es' ? '#ff6ab0' : '#ffffff';
        for (const p of q.points) {
          const [x, y] = this.project(p.lat, p.lon);
          ctx.globalAlpha = 0.8 * fade;
          ctx.beginPath();
          ctx.arc(x, y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    // Callsigns on the newest few contacts.
    if (this.showCalls) {
      ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
      ctx.textBaseline = 'middle';
      const newest = recent.slice(-3);
      for (const q of newest) {
        const arc = this.arcs.get(q.id);
        if (!arc) continue;
        const age = now - arc.born;
        const fade = 1 - clamp01((age - 3) / 2);
        if (fade <= 0) continue;
        ctx.globalAlpha = fade;
        for (const s of [q.a, q.b]) {
          const [x, y] = this.project(s.lat, s.lon);
          const right = x < this.map.x + this.map.w - 60;
          ctx.textAlign = right ? 'left' : 'right';
          ctx.fillStyle = 'rgba(3, 6, 11, 0.7)';
          const tw = ctx.measureText(s.call).width;
          ctx.fillRect(right ? x + 4 : x - 6 - tw, y - 7, tw + 4, 14);
          ctx.fillStyle = q.color;
          ctx.fillText(s.call, right ? x + 6 : x - 4, y);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // Band conditions: one cell per band, coloured by how many paths it carries, with the
  // band's contacts in the last hour.
  drawStrip() {
    const { ctx, world } = this;
    const s = this.strip;
    const per = Math.ceil(world.bands.length / s.rows);
    const gap = 4;
    const cw = (s.w - gap * (per - 1)) / per;
    const ch = (s.h - gap * (s.rows - 1)) / s.rows;
    const hourAgo = world.minute - 60;
    const counts = new Map();
    for (const q of world.qsos) if (q.minute > hourAgo) counts.set(q.band, (counts.get(q.band) ?? 0) + 1);
    ctx.font = `${ch > 40 ? 12 : 11}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'middle';
    world.bands.forEach((b, i) => {
      const row = Math.floor(i / per);
      const col = i % per;
      const x = s.x + col * (cw + gap);
      const y = s.y + row * (ch + gap);
      const level = b.level;
      ctx.fillStyle = 'rgba(8, 16, 28, 0.85)';
      ctx.beginPath();
      roundRect(ctx, x, y, cw, ch, 5);
      ctx.fill();
      // Fill bar: share of probe paths open.
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, x, y, cw, ch, 5);
      ctx.clip();
      ctx.fillStyle = b.color;
      ctx.globalAlpha = level ? 0.18 + 0.12 * level : 0.05;
      ctx.fillRect(x, y, cw * Math.max(0.04, Math.min(1, b.open / 0.6)), ch);
      ctx.restore();
      ctx.strokeStyle = level ? b.color : 'rgba(120, 150, 190, 0.2)';
      ctx.globalAlpha = level ? 0.7 : 1;
      ctx.lineWidth = 1;
      ctx.beginPath();
      roundRect(ctx, x + 0.5, y + 0.5, cw - 1, ch - 1, 5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      ctx.fillStyle = level ? b.color : 'rgba(150, 165, 185, 0.6)';
      ctx.font = `700 ${ch > 40 ? 13 : 12}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillText(b.name, x + 7, y + ch * 0.36);
      ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(200, 215, 235, 0.7)';
      const n = counts.get(b.name) ?? 0;
      ctx.fillText(`${LEVELS[level]}${cw > 70 && n ? ` · ${n}/h` : ''}`, x + 7, y + ch * 0.72);
    });
  }
}
