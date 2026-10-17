// Synthesized sounds (no audio files): seeds on wood, captures, the afternoon outside.
// Browsers only allow audio after a click or key press, so call unlock() from one.

let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('ayo-muted') === '1'; } catch { /* storage blocked */ }

function noise(seconds) {
  const buf = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function unlock() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;
  master.connect(ctx.destination);

  // distant street hum
  const src = ctx.createBufferSource();
  src.buffer = noise(3);
  src.loop = true;
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 380;
  const g = ctx.createGain();
  g.gain.value = 0.05;
  src.connect(low).connect(g).connect(master);
  src.start();
  birds();
  crickets();
  if (radioWanted) startRadio();
}

// ── The radio: a little highlife loop, played through a small-speaker filter ──
// C – F – G – C, one bar each at 112 bpm: guitar arpeggios, bass, bell and shaker.
let radioWanted = true;
let radioOn = false;
let radioTimer = 0;
let radioOut = null;
let nextNote = 0;
let step = 0;
const CHORDS = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]];
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

function pluck(freq, at, length, volume, type = 'triangle') {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(volume, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  o.connect(g).connect(radioOut);
  o.start(at);
  o.stop(at + length + 0.02);
}
function shaker(at, volume) {
  const src = ctx.createBufferSource();
  src.buffer = noise(0.04);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(volume, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
  src.connect(hp).connect(g).connect(radioOut);
  src.start(at);
}
function scheduleRadio() {
  const sixteenth = 60 / 112 / 4;
  while (nextNote < ctx.currentTime + 0.2) {
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    const chord = CHORDS[bar];
    // guitar: rolling eighth-note arpeggio, an octave up
    if (s % 2 === 0) {
      const pattern = [0, 1, 2, 1, 2, 0, 1, 2];
      pluck(midi(chord[pattern[s / 2]] + 12), nextNote, 0.35, 0.09);
    }
    // a second guitar answering on the off-beats
    if (s % 4 === 3) pluck(midi(chord[2] + 7), nextNote, 0.2, 0.05, 'sawtooth');
    // bass on 1, the "and" of 2, and 3
    if (s === 0 || s === 6 || s === 8) pluck(midi(chord[0] - 24), nextNote, 0.4, 0.22, 'sine');
    // bell (agogo) and shaker
    if ([0, 3, 6, 10, 12].includes(s)) pluck(s === 6 ? 1180 : 1560, nextNote, 0.08, 0.035, 'square');
    shaker(nextNote, s % 4 === 2 ? 0.05 : 0.025);
    nextNote += sixteenth;
    step++;
  }
}
function startRadio() {
  if (!ctx || radioOn) return;
  radioOn = true;
  // a cheap speaker: band-limited with a touch of grit
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1400;
  band.Q.value = 0.5;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2); }
  shaper.curve = curve;
  radioOut = ctx.createGain();
  radioOut.gain.value = 0.5;
  radioOut.connect(band).connect(shaper).connect(master);
  nextNote = ctx.currentTime + 0.1;
  radioTimer = setInterval(scheduleRadio, 60);
}
function stopRadio() {
  if (!radioOn) return;
  radioOn = false;
  clearInterval(radioTimer);
  radioOut.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
}
export function toggleRadio() {
  radioWanted = !radioWanted;
  if (radioWanted) startRadio(); else stopRadio();
  return radioWanted;
}
export const radioPlaying = () => radioWanted;

// an okada going past on the road: a putting engine that rises and falls as it passes
export function okada() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(70, t);
  o.frequency.linearRampToValueAtTime(110, t + 1.6);
  o.frequency.linearRampToValueAtTime(62, t + 3.4);
  const putt = ctx.createOscillator();
  putt.frequency.value = 18;
  const puttGain = ctx.createGain();
  puttGain.gain.value = 0.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 1.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  putt.connect(puttGain).connect(g.gain);
  o.connect(lp).connect(g).connect(master);
  o.start(t);
  putt.start(t);
  o.stop(t + 3.6);
  putt.stop(t + 3.6);
}

// a chicken's cluck
export function cluck() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
    const s = t + i * 0.11;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(520 + Math.random() * 80, s);
    o.frequency.exponentialRampToValueAtTime(330, s + 0.06);
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.03, s + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.08);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    o.connect(bp).connect(g).connect(master);
    o.start(s);
    o.stop(s + 0.09);
  }
}

// Outside sounds depend on the time of day: birds by day, crickets at night.
let ambience = 'day';
export function setAmbience(kind) {
  ambience = kind;
}

function crickets() {
  if (!ctx) return;
  setTimeout(() => {
    if (ambience === 'night') {
      const t = ctx.currentTime;
      const freq = 4200 + Math.random() * 600;
      for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const s = t + i * 0.09;
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.012, s + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.05);
        o.connect(g).connect(master);
        o.start(s);
        o.stop(s + 0.06);
      }
    }
    crickets();
  }, 600 + Math.random() * 1400);
}

// a bird calls now and then (daytime only)
function birds() {
  if (!ctx) return;
  setTimeout(() => {
    if (ambience === 'night') { birds(); return; }
    const t = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 3);
    const base = 2600 + Math.random() * 1400;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const gn = ctx.createGain();
      const s = t + i * 0.13;
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.3), s + 0.06);
      gn.gain.setValueAtTime(0.0001, s);
      gn.gain.exponentialRampToValueAtTime(0.025, s + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, s + 0.09);
      o.connect(gn).connect(master);
      o.start(s);
      o.stop(s + 0.1);
    }
    birds();
  }, 5000 + Math.random() * 9000);
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('ayo-muted', muted ? '1' : '0'); } catch { /* storage blocked */ }
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
  return muted;
}

// a hard seed landing in a wooden bowl: a short click with a hollow body
function clack(volume = 0.35) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise(0.03);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2200 + Math.random() * 900;
  band.Q.value = 4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(volume, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  src.connect(band).connect(g).connect(master);
  src.start(t);
  const o = ctx.createOscillator();
  const og = ctx.createGain();
  o.frequency.value = 420 + Math.random() * 120;
  og.gain.setValueAtTime(volume * 0.4, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  o.connect(og).connect(master);
  o.start(t);
  o.stop(t + 0.08);
}

function bell(freq, at = 0, volume = 0.18, length = 0.5) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  for (const [mult, v] of [[1, 1], [2.01, 0.35], [3.02, 0.15]]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq * mult;
    g.gain.setValueAtTime(volume * v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + length);
  }
}

export const sfx = {
  clack: () => clack(),
  pickup: () => { clack(0.2); setTimeout(() => clack(0.15), 40); setTimeout(() => clack(0.12), 75); },
  capture: () => { bell(660, 0, 0.16, 0.35); bell(990, 0.08, 0.14, 0.45); },
  win: () => [523, 659, 784, 1046].forEach((f, i) => bell(f, i * 0.13, 0.17, 0.7)),
  lose: () => [440, 392, 330].forEach((f, i) => bell(f, i * 0.18, 0.14, 0.6)),
};
