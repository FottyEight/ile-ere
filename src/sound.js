// The joint's sound: recorded effects, ambience and music (assets/audio, see CREDITS.md), heard
// from where they happen, plus made-up "babble" voices that follow what people say.
// Browsers only allow audio after a click or key press, so call unlock() from one.
// Until the recordings have loaded (or if they fail), short synthesized stand-ins play.

const AUDIO = 'assets/audio/';
let ctx = null;
let master = null;
let muted = false;
const VOLUME = 1.6; // overall loudness (a limiter keeps bursts from clipping)
try { muted = localStorage.getItem('ayo-muted') === '1'; } catch { /* storage blocked */ }

// ── Loading ──
// The files are fetched in the background once the scene is up (preload), and decoded once
// there's an AudioContext (unlock). Music is only fetched when the radio is on.
let manifest = null;
const raw = new Map(); // file → Promise<ArrayBuffer>
const buffers = new Map(); // file → AudioBuffer
const decoding = new Map(); // file → Promise<AudioBuffer>
const fetchFile = (file) => {
  if (!raw.has(file)) raw.set(file, fetch(AUDIO + file).then((r) => { if (!r.ok) throw new Error(file); return r.arrayBuffer(); }));
  return raw.get(file);
};
const filesOf = (name) => [].concat(manifest?.files?.[name] ?? []);
const manifestReady = fetch(AUDIO + 'manifest.json').then((r) => r.json()).then((m) => { manifest = m; }).catch(() => {});
function decode(file) {
  if (!ctx) return null;
  if (!decoding.has(file)) {
    decoding.set(file, fetchFile(file)
      .then((ab) => ctx.decodeAudioData(ab.slice(0)))
      .then((b) => { buffers.set(file, b); return b; })
      .catch(() => null));
  }
  return decoding.get(file);
}
// everything but the music, quietly in the background
export async function preload() {
  await manifestReady;
  if (!manifest) return;
  for (const [name, f] of Object.entries(manifest.files)) {
    if (name === 'music') continue;
    for (const file of [].concat(f)) fetchFile(file).catch(() => {});
  }
}
async function decodeAll() {
  await manifestReady;
  if (!manifest) return;
  const all = [];
  for (const [name, f] of Object.entries(manifest.files)) {
    if (name !== 'music') for (const file of [].concat(f)) all.push(decode(file));
  }
  await Promise.all(all);
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
  master.gain.value = muted ? 0 : VOLUME;
  // a gentle limiter, so a burst of sounds together never clips
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -6;
  limit.ratio.value = 8;
  master.connect(limit).connect(ctx.destination);
  meter = ctx.createAnalyser();
  meter.fftSize = 2048;
  limit.connect(meter);
  decodeAll().then(() => { startAmbience(); });
  if (radioWanted) startRadio();
}

// ── Where you're listening from: the camera ──
const listenerAt = { x: 0, y: 1.4, z: 4 };
export function setListener(camera) {
  if (!ctx) return;
  const p = camera.position;
  listenerAt.x = p.x; listenerAt.y = p.y; listenerAt.z = p.z;
  const e = camera.matrixWorld.elements;
  const fx = -e[8], fy = -e[9], fz = -e[10]; // forward
  const ux = e[4], uy = e[5], uz = e[6]; // up
  const L = ctx.listener;
  if (L.positionX) {
    const t = ctx.currentTime;
    L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
    L.forwardX.setTargetAtTime(fx, t, 0.02); L.forwardY.setTargetAtTime(fy, t, 0.02); L.forwardZ.setTargetAtTime(fz, t, 0.02);
    L.upX.setTargetAtTime(ux, t, 0.02); L.upY.setTargetAtTime(uy, t, 0.02); L.upZ.setTargetAtTime(uz, t, 0.02);
  } else {
    L.setPosition(p.x, p.y, p.z);
    L.setOrientation(fx, fy, fz, ux, uy, uz);
  }
}
// a sound placed in the joint: louder close by, and from the side it's on
function placed(pos, { ref = 1.4, rolloff = 1.1 } = {}) {
  const pan = ctx.createPanner();
  pan.panningModel = 'equalpower';
  pan.distanceModel = 'inverse';
  pan.refDistance = ref;
  pan.rolloffFactor = rolloff;
  pan.maxDistance = 40;
  if (pan.positionX) { pan.positionX.value = pos.x; pan.positionY.value = pos.y ?? 1; pan.positionZ.value = pos.z; }
  else pan.setPosition(pos.x, pos.y ?? 1, pos.z);
  pan.connect(master);
  return pan;
}
const tooFar = (pos, d = 26) => pos && Math.hypot(pos.x - listenerAt.x, pos.z - listenerAt.z) > d;

// ── Playing a recording ──
// play('card_slap', { pos, volume, rate }) picks one of the takes (never the same one twice
// in a row) and varies it a little. Returns false if it isn't loaded yet.
const lastTake = new Map();
export function play(name, { pos = null, volume = 1, rate = 1, vary = 0.05, offset = 0, duration, ref } = {}) {
  if (!ctx || muted || tooFar(pos)) return false;
  const files = filesOf(name);
  if (!files.length) return false;
  let k = Math.floor(Math.random() * files.length);
  if (files.length > 1 && k === lastTake.get(name)) k = (k + 1) % files.length;
  lastTake.set(name, k);
  const buf = buffers.get(files[k]);
  if (!buf) { decode(files[k]); return false; }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * vary);
  const g = ctx.createGain();
  g.gain.value = volume * (1 + (Math.random() * 2 - 1) * vary * 1.5);
  src.connect(g).connect(pos ? placed(pos, { ref }) : master);
  const t = ctx.currentTime;
  if (duration) {
    g.gain.setValueAtTime(g.gain.value, t + duration - 0.06);
    g.gain.linearRampToValueAtTime(0, t + duration);
    src.start(t, offset, duration);
  } else {
    src.start(t, offset);
  }
  return true;
}

// ── Ambience: a recorded loop for the time of day, crossfading when it changes ──
let ambience = 'day';
let ambNow = null; // { src, gain }
let hum = null;
const GENERATOR = { x: 13.6, y: 0.6, z: 10.0 }; // somebody's generator over the back wall
export function setAmbience(kind) {
  ambience = kind;
  if (ctx) startAmbience();
}
function loop(file, out, volume) {
  const buf = buffers.get(file);
  if (!buf) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(gain).connect(out);
  src.start(ctx.currentTime, Math.random() * buf.duration);
  gain.gain.setTargetAtTime(volume, ctx.currentTime, 1.2);
  return { src, gain, file };
}
function fadeOut(node) {
  if (!node) return;
  node.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
  node.src.stop(ctx.currentTime + 4);
}
function startAmbience() {
  const file = filesOf(`amb_${ambience}`)[0];
  if (file && ambNow?.file !== file) {
    const next = loop(file, master, 0.6);
    if (next) { fadeOut(ambNow); ambNow = next; }
  }
  // Lagos after dark: NEPA has taken light, and the generators come on
  const wantHum = ambience !== 'day';
  if (wantHum && !hum) {
    const f = filesOf('generator_hum')[0];
    if (f && buffers.get(f)) hum = loop(f, placed(GENERATOR, { ref: 2.5, rolloff: 0.9 }), 0.5);
  } else if (!wantHum && hum) {
    fadeOut(hum);
    hum = null;
  }
}

// ── The radio: real highlife through a small speaker, by the wall ──
let radioWanted = true;
let radioOn = false;
let radioPos = { x: -2.75, y: 0.6, z: -1.55 };
let radioOut = null; // the radio's volume (ducks while people talk)
let radioSrc = null;
let song = Math.floor(Math.random() * 2);
export function setRadioPosition(p) { radioPos = { x: p.x, y: p.y ?? 0.6, z: p.z }; }
function radioChain() {
  // a cheap speaker: no deep bass, no sparkle, a touch of grit
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 220;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4800;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 1.6); }
  shaper.curve = curve;
  radioOut = ctx.createGain();
  radioOut.gain.value = 0.55;
  hp.connect(lp).connect(shaper).connect(radioOut).connect(placed(radioPos, { ref: 2.2, rolloff: 0.8 }));
  return hp;
}
let radioIn = null;
async function playSong() {
  if (!radioOn) return;
  const files = filesOf('music');
  if (!files.length) return;
  const file = files[song % files.length];
  song++;
  const buf = await decode(file);
  if (!radioOn || !buf) return;
  // fetch the next song while this one plays
  fetchFile(files[song % files.length]).catch(() => {});
  radioSrc = ctx.createBufferSource();
  radioSrc.buffer = buf;
  radioSrc.connect(radioIn);
  radioSrc.onended = () => { if (radioOn && radioSrc?.buffer === buf) setTimeout(playSong, 1500); };
  radioSrc.start();
}
async function startRadio() {
  if (!ctx || radioOn) return;
  radioOn = true;
  if (!radioIn) radioIn = radioChain();
  radioOut.gain.setTargetAtTime(0.55, ctx.currentTime, 0.1);
  await manifestReady;
  play('radio_static', { pos: radioPos, volume: 0.35, duration: 0.5 });
  playSong();
}
function stopRadio() {
  if (!radioOn) return;
  radioOn = false;
  play('radio_static', { pos: radioPos, volume: 0.3, duration: 0.25 });
  radioOut.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  const src = radioSrc;
  radioSrc = null;
  try { src?.stop(ctx.currentTime + 0.3); } catch { /* not started yet */ }
}
export function toggleRadio() {
  radioWanted = !radioWanted;
  if (radioWanted) startRadio(); else stopRadio();
  return radioWanted;
}
export const radioPlaying = () => radioWanted;
// the radio dips while someone talks, then comes back up
function duck(seconds) {
  if (!radioOut || !radioOn) return;
  const t = ctx.currentTime;
  radioOut.gain.cancelScheduledValues(t);
  radioOut.gain.setTargetAtTime(0.22, t, 0.08);
  radioOut.gain.setTargetAtTime(0.55, t + seconds, 0.5);
}

// ── Voices: a made-up babble that follows the words ──
// Each syllable is a buzz shaped by the vowel it comes from in the text, at the speaker's own
// pitch and pace (a low, slow Baba; quick, high kids). It plays from where they sit.
const VOICES = {
  baba: { pitch: 96, pace: 0.82 },
  Tunde: { pitch: 124, pace: 1.08 },
  'Iya Bisi': { pitch: 205, pace: 1.0 },
  'Mama Ngozi': { pitch: 188, pace: 0.9 },
  'Uncle Femi': { pitch: 116, pace: 0.95 },
  Kemi: { pitch: 300, pace: 1.22 },
  Tobi: { pitch: 272, pace: 1.3 },
  Emeka: { pitch: 132, pace: 1.0 },
  Chidi: { pitch: 148, pace: 1.15 },
  you: { pitch: 150, pace: 1.0 },
};
export function setVoice(who, v) { VOICES[who] = { ...VOICES[who], ...v }; }
// first two formants of each vowel (Hz)
const FORMANTS = { a: [780, 1250], e: [480, 1900], i: [320, 2300], o: [520, 920], u: [360, 800] };
const SOFT = new Set(['s', 'f', 'h', 'c', 'x', 'z']);
const HARD = new Set(['t', 'k', 'p', 'b', 'd', 'g', 'j', 'q']);
export function speak(who, text, pos, seconds) {
  if (!ctx || muted || !text || tooFar(pos, 18)) return;
  duck(seconds + 0.3);
  const v = VOICES[who] ?? { pitch: 150, pace: 1 };
  const out = ctx.createGain();
  out.gain.value = 0.8;
  out.connect(pos ? placed(pos, { ref: 1.2, rolloff: 1.2 }) : master);
  // the syllables: each run of vowels, with the consonant before it
  const words = text.toLowerCase().normalize('NFD').replace(/[^a-z\s?!.,]/g, '').split(/\s+/);
  const syl = [];
  for (const w of words) {
    const parts = w.match(/[^aeiou]*[aeiou]+/g) ?? (w.replace(/[^a-z]/g, '') ? [w] : []);
    parts.forEach((p, i) => syl.push({ onset: p[0], vowel: (p.match(/[aeiou]/) ?? ['a'])[0], wordEnd: i === parts.length - 1, punct: /[.,!?]/.test(w) && i === parts.length - 1 }));
  }
  const asks = text.trim().endsWith('?');
  const excited = text.includes('!');
  let t = ctx.currentTime + 0.05;
  const end = t + seconds;
  syl.forEach((s, n) => {
    if (t > end - 0.08) return;
    const len = (0.075 + Math.random() * 0.05) / v.pace;
    const last = n === syl.length - 1 || t + len * 2 > end;
    // pitch: wanders a little, falls at the end of a statement, rises for a question
    let f = v.pitch * (excited ? 1.12 : 1) * (1 + Math.sin(n * 1.7) * 0.06 + (Math.random() - 0.5) * 0.1);
    if (last) f *= asks ? 1.25 : 0.82;
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f, t);
    src.frequency.linearRampToValueAtTime(f * (last && asks ? 1.15 : 0.94), t + len);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.015);
    env.gain.setValueAtTime(1, t + len * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const [f1, f2] = FORMANTS[s.vowel];
    for (const [fq, q, g] of [[f1, 7, 1], [f2, 9, 0.6]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fq * (v.pitch > 220 ? 1.15 : 1);
      bp.Q.value = q;
      const bg = ctx.createGain();
      bg.gain.value = g * 3;
      src.connect(bp).connect(bg).connect(env);
    }
    env.connect(out);
    src.start(t);
    src.stop(t + len + 0.02);
    // a hiss or a tap for consonants like s, f, t, k
    if (SOFT.has(s.onset) || HARD.has(s.onset)) {
      const nz = ctx.createBufferSource();
      nz.buffer = noiseBuffer();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = SOFT.has(s.onset) ? 4200 : 2000;
      const ng = ctx.createGain();
      const d = SOFT.has(s.onset) ? 0.05 : 0.015;
      ng.gain.setValueAtTime(0.25, t - d * 0.5);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + d * 0.5);
      nz.connect(hp).connect(ng).connect(out);
      nz.start(Math.max(ctx.currentTime, t - d * 0.5));
      nz.stop(t + d);
    }
    t += len + (s.punct ? 0.18 : s.wordEnd ? 0.05 : 0.012) / v.pace;
  });
}
let noiseBuf = null;
function noiseBuffer() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

// ── Life around the joint ──
export function okada() {
  if (!play('okada_pass', { pos: { x: 5.3 + (Math.random() - 0.5) * 8, y: 0.8, z: 12.5 }, volume: 0.8, ref: 3 })) synthOkada();
}
export function cluck(pos) {
  play('chicken', { pos, volume: 0.6, vary: 0.08 });
}
export function rooster() {
  play('rooster', { pos: { x: -6, y: 2, z: 12 }, volume: 0.5, ref: 4 });
}

export function isMuted() {
  return muted;
}
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('ayo-muted', muted ? '1' : '0'); } catch { /* storage blocked */ }
  if (master) master.gain.setTargetAtTime(muted ? 0 : VOLUME, ctx.currentTime, 0.05);
  return muted;
}

// ── Synthesized stand-ins, for the moment before the recordings load ──
function clack(volume = 0.35) {
  if (!ctx) return;
  const t = ctx.currentTime;
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
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(volume, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + length);
}
function synthOkada() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(70, t);
  o.frequency.linearRampToValueAtTime(110, t + 1.6);
  o.frequency.linearRampToValueAtTime(62, t + 3.4);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.06, t + 1.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  o.connect(lp).connect(g).connect(master);
  o.start(t);
  o.stop(t + 3.6);
}

// The Ayo table's sounds (and the shared ones), by what happens. `pos` is optional.
export const sfx = {
  clack: (pos) => play('seed_drop', { pos, volume: 0.8 }) || clack(),
  pickup: (pos) => play('seed_scoop', { pos, volume: 0.7 }) || clack(0.2),
  capture: (pos) => play('seeds_capture', { pos, volume: 0.9 }) || (bell(660, 0, 0.14, 0.35), bell(990, 0.08, 0.12, 0.45)),
  win: () => play('win', { volume: 0.7, vary: 0 }) || [523, 659, 784, 1046].forEach((f, i) => bell(f, i * 0.13, 0.15, 0.7)),
  lose: () => play('lose', { volume: 0.7, vary: 0 }) || [440, 392, 330].forEach((f, i) => bell(f, i * 0.18, 0.12, 0.6)),
  click: () => play('ui_click', { volume: 0.5 }),
  pop: () => play('ui_pop', { volume: 0.5 }),
  sit: (pos) => play('stool_sit', { pos, volume: 0.6 }),
  cloth: (pos) => play('cloth', { pos, volume: 0.5 }),
  // a named recording: sfx.play('card_slap', { pos }) (falls back to a click)
  play: (name, opts = {}) => play(name, opts) || (opts.fallback !== false && clack(0.25)),
};

// for tests (?debug): what's loaded and playing
let meter = null;
const meterBuf = new Float32Array(2048);
function level() {
  if (!meter) return -99;
  meter.getFloatTimeDomainData(meterBuf);
  let sum = 0;
  for (const v of meterBuf) sum += v * v;
  return Math.round(10 * Math.log10(sum / meterBuf.length + 1e-12));
}
export const audioStats = () => ({ level: level(),  state: ctx?.state ?? 'none', decoded: buffers.size, radio: radioOn, song: radioSrc?.buffer?.duration ?? 0, ambience: ambNow?.file ?? null, hum: !!hum });
