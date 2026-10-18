// The house's sound: recorded effects, ambience and music (assets/audio, see CREDITS.md), heard
// from where they happen, and people saying their lines out loud.
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

// ── Voices: people say their lines out loud ──
// A line is played from a real recording if one has been added (see below); otherwise the
// device's own speech voice reads it, with a Nigerian English voice where the device has one
// (Edge on Windows has "Abeo" and "Ezinne"; Android often has one too). Each person has their
// own voice, pitch and pace, and sounds quieter the further away they are.
const PEOPLE = {
  baba: { female: false, pitch: 0.78, rate: 0.86 },
  Tunde: { female: false, pitch: 1.0, rate: 1.05 },
  'Iya Bisi': { female: true, pitch: 1.0, rate: 1.0 },
  'Mama Ngozi': { female: true, pitch: 0.88, rate: 0.92 },
  'Uncle Femi': { female: false, pitch: 0.86, rate: 0.95 },
  Kemi: { female: true, pitch: 1.55, rate: 1.1 },
  Tobi: { female: false, pitch: 1.65, rate: 1.12 },
  Emeka: { female: false, pitch: 0.95, rate: 1.0 },
  Chidi: { female: false, pitch: 1.1, rate: 1.1 },
  you: { female: false, pitch: 1.0, rate: 1.0 },
};
export function setVoice(who, v) { PEOPLE[who] = { ...PEOPLE[who], ...v }; }

const tts = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
const FEMALE = /female|woman|ezinne|zira|hazel|susan|libby|sonia|aria|jenny|samantha|karen|moira|tessa|fiona|victoria|serena|kate|leah|natasha|neerja|heera|clara|emma|ava|michelle|ada|aisha/i;
const MALE = /\bmale\b|\bman\b|abeo|david|mark|george|ryan|guy|daniel|alex|fred|thomas|oliver|william|james|brian|liam|prabhat|ravi|rishi|arthur|eric/i;
let voiceFor = { female: null, male: null };
function chooseVoices() {
  const all = (tts?.getVoices() ?? []).filter((v) => /^en[-_]/i.test(v.lang));
  if (!all.length) return;
  // Nigerian English first, then other African and British English, then any English
  const rank = (v) => {
    const l = v.lang.toLowerCase().replace('_', '-');
    return l === 'en-ng' ? 0 : ['en-za', 'en-ke', 'en-gh', 'en-tz'].includes(l) ? 1 : l === 'en-gb' ? 2 : 3;
  };
  const pick = (female) => {
    const fits = (v) => (female ? FEMALE.test(v.name) && !/\bmale\b/i.test(v.name.replace(/female/i, '')) : MALE.test(v.name) && !FEMALE.test(v.name));
    // (natural-sounding online voices beat the old built-in ones)
    const natural = (v) => (/natural|online|google|neural|premium|enhanced/i.test(v.name) ? 0 : 1);
    const sorted = all.slice().sort((a, b) => rank(a) - rank(b) || natural(a) - natural(b));
    return sorted.find(fits) ?? sorted.find((v) => !(female ? MALE : FEMALE).test(v.name)) ?? sorted[0];
  };
  voiceFor = { female: pick(true), male: pick(false) };
}
if (tts) {
  chooseVoices();
  tts.addEventListener?.('voiceschanged', chooseVoices);
}
// what to read: no emoji, and "Haha" said like a laugh
const forSpeech = (text) => text.replace(/[\u{1F000}-\u{1FFFF}☀-➿]/gu, '').replace(/\bo\b(?=[.!?]?$)/i, 'oh').trim();

let speaking = null; // { priority, until }
function sayAloud(who, text, pos, priority) {
  if (!tts || !voiceFor.male) return;
  const now = performance.now();
  // a lesson being read isn't cut off by a quick shout
  if (speaking && now < speaking.until && speaking.priority > priority) return;
  const p = PEOPLE[who] ?? { female: false, pitch: 1, rate: 1 };
  const u = new SpeechSynthesisUtterance(forSpeech(text));
  u.voice = p.female ? voiceFor.female : voiceFor.male;
  u.lang = u.voice?.lang ?? 'en-GB';
  u.pitch = p.pitch;
  u.rate = p.rate;
  // nearer is louder (speech voices can't be placed left or right, only made quieter)
  const d = pos ? Math.hypot(pos.x - listenerAt.x, (pos.y ?? 1) - listenerAt.y, pos.z - listenerAt.z) : 1;
  u.volume = Math.max(0.2, Math.min(1, 2.2 / (d + 0.8)));
  const est = 600 + text.length * 70 / p.rate;
  speaking = { priority, until: now + est };
  u.onend = () => { if (speaking?.until === now + est) speaking = null; unduck(); };
  tts.cancel();
  tts.speak(u);
  duck(est / 1000);
}
export function silence() { tts?.cancel(); speaking = null; }

// Real recorded lines, if any have been added: assets/audio/voice/<who>__<line>.mp3, listed in
// voice/voices.json (node tools/voices.mjs writes it). "any__pick-two.mp3" fits anybody.
export const lineKey = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const whoKey = (who) => lineKey(who === 'baba' ? 'baba' : who);
let recorded = new Set();
fetch(AUDIO + 'voice/voices.json').then((r) => (r.ok ? r.json() : [])).then((list) => { recorded = new Set(list); }).catch(() => {});
function recordedLine(who, text) {
  const line = lineKey(text);
  for (const f of [`${whoKey(who)}__${line}.mp3`, `any__${line}.mp3`]) if (recorded.has(f)) return `voice/${f}`;
  return null;
}

// priority: 2 for a lesson, 1 for everything else
export function speak(who, text, pos, seconds, priority = 1) {
  if (!ctx || muted || !text || tooFar(pos, 16)) return;
  const real = recordedLine(who, text);
  const buf = real && buffers.get(real);
  if (buf) {
    duck(buf.duration + 0.3);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(pos ? placed(pos, { ref: 1.4, rolloff: 1.1 }) : master);
    src.start();
    return;
  }
  if (real) decode(real); // ready next time
  sayAloud(who, text, pos, priority);
}
function unduck() {
  if (!radioOut || !radioOn) return;
  radioOut.gain.cancelScheduledValues(ctx.currentTime);
  radioOut.gain.setTargetAtTime(0.55, ctx.currentTime + 0.3, 0.5);
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
  if (muted) silence();
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
export const audioStats = () => ({ level: level(), voices: [voiceFor.male?.name, voiceFor.female?.name], speaking: !!tts?.speaking,  state: ctx?.state ?? 'none', decoded: buffers.size, radio: radioOn, song: radioSrc?.buffer?.duration ?? 0, ambience: ambNow?.file ?? null, hum: !!hum });
