// Procedural sound with Web Audio (no files, works offline): band noise that swells and
// fades like a receiver tuned between stations, and now and then a CW exchange from one
// of the contacts on the map, keyed in Morse at a comfortable speed.

const PREF_KEY = 'skywave.sound';

export const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '/': '-..-.', '?': '..--..',
};

function loadPref() {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

function savePref(on) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch { /* storage unavailable; preference just won't persist */ }
}

export class SoundEngine {
  constructor() {
    this.enabled = loadPref();
    this.paused = false;
    this.ctx = null;
    this.busyUntil = 0;
  }

  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state !== 'running' && !this.paused) this.ctx.resume();
  }

  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(comp);

    // Band noise: looped white noise through a receiver-ish passband, with slow QSB.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    this.noise = ctx.createGain();
    this.noise.gain.value = 0.012;
    src.connect(hp).connect(lp).connect(this.noise).connect(this.master);
    src.start();
    const qsb = ctx.createOscillator();
    const depth = ctx.createGain();
    qsb.frequency.value = 0.09;
    depth.gain.value = 0.005;
    qsb.connect(depth).connect(this.noise.gain);
    qsb.start();
  }

  setEnabled(on) {
    this.enabled = on;
    savePref(on);
    if (on) this.unlock();
    else this.ctx?.suspend();
  }

  setPaused(p) {
    this.paused = p;
    if (!this.ctx) return;
    if (p || !this.enabled) this.ctx.suspend();
    else this.ctx.resume();
  }

  ready() {
    return this.enabled && !this.paused && this.ctx && this.ctx.state === 'running';
  }

  // Key a short exchange ("CALL1 DE CALL2 5NN") for a CW contact, if nothing's playing.
  cw(text, { wpm = 24, pitch = 650, strength = 0.5 } = {}) {
    if (!this.ready()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now < this.busyUntil) return;
    const dit = 1.2 / wpm;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = pitch;
    g.gain.value = 0;
    o.connect(g).connect(this.master);
    const peak = 0.02 + 0.05 * strength;
    let t = now + 0.05;
    for (const word of text.toUpperCase().split(' ')) {
      for (const ch of word) {
        const code = MORSE[ch];
        if (!code) continue;
        for (const sym of code) {
          const on = sym === '.' ? dit : dit * 3;
          // 5 ms ramps so the keying doesn't click.
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(peak, t + 0.005);
          g.gain.setValueAtTime(peak, t + on - 0.005);
          g.gain.linearRampToValueAtTime(0, t + on);
          t += on + dit;
        }
        t += dit * 2;
      }
      t += dit * 4;
    }
    o.start(now);
    o.stop(t + 0.05);
    this.busyUntil = t + 1.5;
  }
}
