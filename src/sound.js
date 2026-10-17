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
}

// a bird calls now and then
function birds() {
  if (!ctx) return;
  setTimeout(() => {
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
