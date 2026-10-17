import * as THREE from 'three';
import { buildScene, onLoadProgress, pitCenter, storeCenter, seedSlot, storeSlot, BOARD_TOP, SEAT_Z } from './scene.js';
import { buildCharacter, styleKey } from './character.js';
import { newGame, play, legalMoves, chooseMove } from './ayo.js';
import { whoami, saveRun, leaderboard, signIn, onStartNg, cameAsGuest, FALLBACK_GUEST } from './startng.js';
import { unlock, sfx, toggleMute, isMuted } from './sound.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
// Animation speed: Normal, Fast, Very fast (chosen in the menu). ?fast forces the fastest, for tests.
const SPEEDS = [1, 2.2, 6];
let speedLevel = 0;
try { speedLevel = Math.min(2, Math.max(0, Number(localStorage.getItem('ayo-speed')) || 0)); } catch { /* storage blocked */ }
let SPEED = params.has('fast') ? 6 : SPEEDS[speedLevel];
const LEVELS = ['Easy', 'Normal', 'Hard'];

// ── Renderer and scene ──
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: params.has('cover') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
$('stage').append(renderer.domElement);

const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.05, 100);
onLoadProgress((f) => {
  $('loading-bar').style.width = `${Math.round(f * 100)}%`;
});
const { scene, seeds, hitTargets, glow } = await buildScene(renderer);
$('loading').hidden = true;

// ── People at the board ──
const ELDER_STYLE = {
  body: 'male', primaryColor: '#efe8d8', secondaryColor: '#2c3e6b', skinColor: '#5b3a26',
  hairColor: '#cfcac0', hair: 'bald', hat: 'none', accessory: 'glasses',
};
const baba = buildCharacter(ELDER_STYLE);
{
  // Baba's fila, tipped to one side
  const fila = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.215, 0.13, 24),
    new THREE.MeshStandardMaterial({ color: '#2c3e6b', roughness: 0.95 }),
  );
  fila.position.set(0.02, baba.headY + 0.2, -0.02);
  fila.rotation.z = -0.28;
  fila.castShadow = true;
  baba.body.add(fila);
}
baba.root.position.set(0, 0, -SEAT_Z);
scene.add(baba.root);

const playerNode = new THREE.Group();
playerNode.position.set(0, 0, SEAT_Z);
playerNode.rotation.y = Math.PI;
scene.add(playerNode);
let me = null;
let meKey = '';
const shadowAll = (o) => o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
shadowAll(baba.root);

// ── Who's playing (start.ng) ──
let identity = { user: null, guest: FALLBACK_GUEST, connected: false };
function styleOverride() {
  if (onStartNg || !params.get('style')) return null; // local testing only
  try { return JSON.parse(params.get('style')); } catch { return null; }
}
function applyIdentity(who) {
  identity = who;
  const look = who.user ?? who.guest;
  const style = styleOverride() ?? look.style;
  const key = styleKey(style);
  if (key !== meKey) {
    if (me) { playerNode.remove(me.root); me.dispose(); }
    me = buildCharacter(style);
    shadowAll(me.root);
    playerNode.add(me.root);
    meKey = key;
  }
  const face = $('card-face');
  if (look.face) {
    face.src = look.face;
    face.hidden = false;
    $('card-initial').hidden = true;
  } else {
    face.hidden = true;
    $('card-initial').hidden = false;
    $('card-initial').textContent = (look.name || 'G').trim().charAt(0).toUpperCase();
  }
  $('card-name').textContent = look.name || 'Guest';
  $('card-account').textContent = who.user ? `@${who.user.account}` : 'Playing as guest';
  $('card-signin').hidden = !!who.user;
  $('menu-signin-note').hidden = !!who.user || cameAsGuest;
  $('label-you').textContent = who.user ? look.name : 'You';
}
let refreshing = false;
async function refreshIdentity() {
  if (refreshing) return;
  refreshing = true;
  try { applyIdentity(await whoami()); } finally { refreshing = false; }
}
applyIdentity(identity);
refreshIdentity();
addEventListener('focus', refreshIdentity);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshIdentity(); });

const trySignIn = () => (onStartNg ? signIn() : say('Sign-in works on ayo.start.ng', 'you'));
$('card-signin').onclick = trySignIn;
$('menu-signin').onclick = trySignIn;
$('over-signin').onclick = trySignIn;

// ── Seeds on the board ──
let pitSeeds = [];
let storeSeeds = [[], []];
function setUpSeeds() {
  pitSeeds = Array.from({ length: 12 }, () => []);
  storeSeeds = [[], []];
  seeds.forEach((s, id) => {
    const pit = Math.floor(id / 4);
    pitSeeds[pit].push(s);
  });
  for (let i = 0; i < 12; i++) pitSeeds[i].forEach((s, n) => s.position.copy(seedSlot(i, n, s.userData.id)));
}

// Tweens are stepped by the render loop; each resolves when it finishes.
const tweens = [];
function fly(mesh, to, duration, arc = 0.06) {
  mesh.userData.flying = true;
  return new Promise((resolve) => {
    tweens.push({ mesh, from: mesh.position.clone(), to: to.clone(), t: 0, duration: duration / SPEED, arc, resolve });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms / SPEED));
function stepTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t = Math.min(1, tw.t + dt / tw.duration);
    const e = tw.t < 0.5 ? 2 * tw.t * tw.t : 1 - (-2 * tw.t + 2) ** 2 / 2;
    tw.mesh.position.lerpVectors(tw.from, tw.to, e);
    tw.mesh.position.y += Math.sin(Math.PI * tw.t) * tw.arc;
    if (tw.t >= 1) { tweens.splice(i, 1); tw.mesh.userData.flying = false; tw.resolve(); }
  }
}

// Seeds being carried sit in the sower's palm and follow the hand every frame.
const carry = { seeds: [], palm: null };
const palmPos = new THREE.Vector3();
const inHand = (n) => new THREE.Vector3(((n % 3) - 1) * 0.011, -0.012 - Math.floor(n / 3) * 0.008, (((n * 7) % 3) - 1) * 0.008);
function followHand(dt) {
  if (!carry.palm || carry.seeds.length === 0) return;
  carry.palm.getWorldPosition(palmPos);
  const k = 1 - Math.exp(-dt * 30);
  carry.seeds.forEach((s, n) => {
    if (!s.userData.flying) s.position.lerp(inHand(n).add(palmPos), k);
  });
}

// ── Game state ──
let game = newGame();
let mode = 'menu';
let busy = false;
let level = 1;
try { level = Math.min(2, Math.max(0, Number(localStorage.getItem('ayo-level') ?? 1))); } catch { /* storage blocked */ }
let streak = 0;
try { streak = Number(localStorage.getItem('ayo-streak')) || 0; } catch { /* storage blocked */ }
const pose = { me: { reach: 0, reachToX: 0, cheer: 0 }, baba: { reach: 0, reachToX: 0, cheer: 0 } };

function setMode(next) {
  mode = next;
  document.body.dataset.mode = next;
  $('menu').hidden = next !== 'menu';
  $('over').hidden = next !== 'over';
  $('hud').hidden = next === 'menu';
}

function renderLevels() {
  document.querySelectorAll('[data-level]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.level) === level)));
  $('streak-note').textContent = level === 0
    ? 'Easy games are for practice and don’t count on the leaderboard.'
    : streak > 0 ? `Your win streak: ${streak}. Keep it going!` : 'Wins on Normal and Hard build your win streak.';
}
document.querySelectorAll('[data-level]').forEach((b) => {
  b.onclick = () => {
    level = Number(b.dataset.level);
    try { localStorage.setItem('ayo-level', String(level)); } catch { /* storage blocked */ }
    renderLevels();
  };
});
renderLevels();

function renderSpeeds() {
  document.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speedLevel)));
}
document.querySelectorAll('[data-speed]').forEach((b) => {
  b.onclick = () => {
    speedLevel = Number(b.dataset.speed);
    SPEED = SPEEDS[speedLevel];
    try { localStorage.setItem('ayo-speed', String(speedLevel)); } catch { /* storage blocked */ }
    renderSpeeds();
  };
});
renderSpeeds();

function updateScores() {
  $('score-you').textContent = String(game.stores[0]);
  $('score-baba').textContent = String(game.stores[1]);
  $('level-badge').textContent = LEVELS[level];
}

function setTurnText(text) {
  $('turn').textContent = text;
}

// speech bubbles over a player's head
let bubbleTimer = 0;
function say(text, who = 'baba', ms = 2600) {
  const b = $('bubble');
  b.textContent = text;
  b.dataset.who = who;
  b.hidden = false;
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => { b.hidden = true; }, ms / Math.sqrt(SPEED));
}
const pickLine = (lines) => lines[Math.floor(Math.random() * lines.length)];

// ── First-game lesson: Baba talks you through your first moves and first capture ──
let taught = false;
try { taught = localStorage.getItem('ayo-taught') === '1'; } catch { /* storage blocked */ }
const lesson = { active: false, turns: 0, saidNoCapture: false, pit: -1 };
function startLesson() {
  Object.assign(lesson, { active: true, turns: 0, saidNoCapture: false, pit: -1 });
  $('skip-lesson').hidden = false;
}
function endLesson(line) {
  lesson.active = false;
  lesson.pit = -1;
  taught = true;
  try { localStorage.setItem('ayo-taught', '1'); } catch { /* storage blocked */ }
  $('skip-lesson').hidden = true;
  if (line) say(line, 'baba', 5000);
}
function lessonTurn(moves) {
  lesson.turns++;
  lesson.pit = -1;
  if (lesson.turns === 1) {
    say('First time at Ayo? I’ll show you. The near row of six pits is yours.', 'baba', 4500);
    setTimeout(() => {
      if (lesson.active && lesson.turns === 1 && game.turn === 0) {
        say('Pick any pit with seeds. They go round to the right, one in each pit.', 'baba', 6000);
      }
    }, 4600 / Math.sqrt(SPEED));
    return;
  }
  if (lesson.turns > 14) return endLesson('You have the idea now. Let’s play properly!');
  const capture = moves.find((m) => play(game, m).captures.length > 0);
  if (capture !== undefined) {
    lesson.pit = capture;
    say('See the pit that’s glowing? Its last seed makes 2 or 3 in my row, so you capture them. Try it!', 'baba', 7000);
  } else if (!lesson.saidNoCapture) {
    lesson.saidNoCapture = true;
    say('No captures this time. Watch my row: a pit with 1 or 2 seeds is a chance for you.', 'baba', 5500);
  }
}
$('skip-lesson').onclick = () => endLesson('Alright, you know the game. Let’s play!');
$('replay-lesson').onclick = () => {
  taught = false;
  try { localStorage.removeItem('ayo-taught'); } catch { /* storage blocked */ }
  $('replay-lesson').textContent = 'The lesson will play in your next game';
};

function startGame() {
  unlock();
  game = newGame(0);
  setUpSeeds();
  yaw = VIEW.yaw;
  pitch = VIEW.pitch;
  dist = VIEW.dist;
  selected = -1;
  setMode('playing');
  updateScores();
  busy = false;
  if (!taught) startLesson();
  else say(pickLine(['Sit down, let’s play!', 'Your turn first, omo mi.', 'Show me what you have.']));
  nextTurn();
}

function nextTurn() {
  updateScores();
  if (game.over) return endGame();
  if (game.turn === 0) {
    const moves = legalMoves(game);
    const mustFeed = game.pits.slice(6).every((n) => n === 0);
    setTurnText(mustFeed ? 'Baba’s row is empty: give him seeds' : 'Your turn: pick one of your pits');
    $('hint').hidden = false;
    if (moves.length === 0) return endGame();
    if (lesson.active) lessonTurn(moves);
  } else {
    setTurnText('Baba is thinking…');
    $('hint').hidden = true;
    babaTurn();
  }
}

async function babaTurn() {
  busy = true;
  if (lesson.active && lesson.turns === 1) say('Good! Now it’s my turn. Watch where my seeds go.', 'baba', 3500);
  const t0 = performance.now();
  const move = chooseMove(game, level);
  const think = Math.max(0, (700 + Math.random() * 700) / SPEED - (performance.now() - t0));
  await new Promise((r) => setTimeout(r, think));
  await animateMove(move);
  busy = false;
  nextTurn();
}

async function playerMove(pit) {
  if (mode !== 'playing' || busy || game.turn !== 0 || !legalMoves(game).includes(pit)) return;
  busy = true;
  selected = -1;
  glow.visible = false;
  $('hint').hidden = true;
  await animateMove(pit);
  busy = false;
  nextTurn();
}

async function animateMove(pit) {
  const mover = game.turn;
  const who = mover === 0 ? pose.me : pose.baba;
  const person = mover === 0 ? me : baba;
  const result = play(game, pit);
  // put the hand over pit i (you sit turned round, so your sideways axis is flipped)
  const reachTo = (i) => { who.reachToX = mover === 0 ? -pitCenter(i).x : pitCenter(i).x; };
  who.reach = 1;
  reachTo(pit);
  setTurnText(mover === 0 ? 'You sow…' : 'Baba sows…');
  await wait(260); // the hand travels to the pit

  // scoop every seed in the pit into the hand
  const hand = pitSeeds[pit].splice(0);
  person.palm.getWorldPosition(palmPos);
  sfx.pickup();
  await Promise.all(hand.map((s, n) => fly(s, inHand(n).add(palmPos), 0.2, 0.03)));
  carry.palm = person.palm;
  carry.seeds = hand;

  // the hand moves along the pits, dropping one seed into each
  for (const target of result.path) {
    reachTo(target);
    await wait(150);
    const seed = carry.seeds.shift();
    pitSeeds[target].push(seed);
    const n = pitSeeds[target].length - 1;
    fly(seed, seedSlot(target, n, seed.userData.id), 0.2, 0.015).then(() => sfx.clack());
  }
  await wait(280);
  carry.palm = null;
  who.reach = 0;

  // captures fly into the mover's store
  if (result.captures.length) {
    const total = result.captures.reduce((n, c) => n + c.count, 0);
    for (const c of result.captures) {
      $(`count-${c.pit}`).classList.add('captured');
      const taken = pitSeeds[c.pit].splice(0);
      sfx.capture();
      await Promise.all(taken.map((s, m) => {
        storeSeeds[mover].push(s);
        const slot = storeSlot(mover, storeSeeds[mover].length - 1, s.userData.id);
        return wait(m * 60).then(() => fly(s, slot, 0.45, 0.07));
      }));
      $(`count-${c.pit}`).classList.remove('captured');
    }
    if (mover === 1) say(pickLine([`Ehen! ${total} for Baba.`, 'You see am?', 'Na so we dey do am!', 'Thank you o!']));
    else if (lesson.active) endLesson(`Ehen! Those ${total} seeds are yours now. First to 25 seeds wins. Go on, try to beat me!`);
    else say(pickLine([`Ah! You took ${total}.`, 'Omo mi, you sabi!', 'Hmm, not bad at all.', 'I see you o!']));
  } else if (result.grandSlam) {
    say(mover === 0 ? 'You can’t take all my seeds at once!' : 'Too greedy, I’ll leave them.');
  }

  game = result.state;
  // at game end, seeds left on the board go to whoever's side they're on
  if (game.over && game.endReason !== 'majority' && game.endReason !== 'draw') {
    for (let i = 0; i < 12; i++) {
      const owner = i < 6 ? 0 : 1;
      for (const s of pitSeeds[i].splice(0)) {
        storeSeeds[owner].push(s);
        fly(s, storeSlot(owner, storeSeeds[owner].length - 1, s.userData.id), 0.5, 0.06);
      }
    }
    await wait(550);
  }
  checkSync();
  updateScores();
}

// The 3D seeds must always match the rules engine.
function checkSync() {
  for (let i = 0; i < 12; i++) {
    if (pitSeeds[i].length !== game.pits[i]) console.error(`pit ${i}: ${pitSeeds[i].length} seeds shown, ${game.pits[i]} in game`);
  }
}

async function endGame() {
  setMode('over');
  setTurnText('');
  $('hint').hidden = true;
  updateScores();
  if (lesson.active) endLesson();
  const [mine, his] = game.stores;
  const won = game.winner === 0;
  const lost = game.winner === 1;
  pose.me.cheer = won ? 1 : 0;
  pose.baba.cheer = lost ? 1 : 0;
  if (won) sfx.win(); else sfx.lose();
  $('over-title').textContent = won ? 'You beat Baba!' : lost ? 'Baba wins this one' : 'It’s a draw';
  $('over-you').textContent = String(mine);
  $('over-baba').textContent = String(his);
  say(won ? pickLine(['Ah, you sabi this game!', 'Well played, omo mi!']) : lost ? pickLine(['Baba never old!', 'Come back tomorrow, I’ll still be here.']) : 'We are equal today.');

  if (level > 0) streak = won ? streak + 1 : 0;
  try { localStorage.setItem('ayo-streak', String(streak)); } catch { /* storage blocked */ }
  $('over-streak').textContent = level === 0 ? 'Practice game (Easy)' : `Win streak: ${streak}`;

  const status = $('over-status');
  $('over-signin').hidden = true;
  if (identity.user) {
    if (level === 0) {
      status.textContent = 'Easy games don’t go on the leaderboard.';
    } else {
      status.textContent = 'Saving your game to start.ng…';
      const saved = await saveRun({ streak, seeds: mine });
      status.textContent = saved.ok
        ? (saved.result.improved ? `New best! You're #${saved.result.rank}.` : `You're #${saved.result.rank} on the leaderboard.`)
        : saved.error || 'Could not save your game.';
    }
  } else {
    status.textContent = 'Sign in with start.ng to put your streak on the leaderboard.';
    $('over-signin').hidden = false;
  }
  renderBoard();
}

async function renderBoard() {
  const list = $('board');
  list.replaceChildren();
  $('board-note').textContent = 'Loading leaderboard…';
  const entries = await leaderboard(10);
  if (!entries) {
    $('board-note').textContent = onStartNg ? 'Could not load the leaderboard.' : 'The leaderboard shows up when you play on ayo.start.ng.';
    return;
  }
  $('board-note').textContent = entries.length ? '' : 'No games yet. Be the first!';
  for (const e of entries) {
    const li = document.createElement('li');
    if (identity.user && e.player_id === identity.user.id) li.classList.add('me');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = e.color || '#888';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${e.rank}. ${e.name}`;
    const score = document.createElement('span');
    score.className = 'score';
    const wins = e.stats?.streak ?? e.score;
    score.textContent = `${wins} ${wins === 1 ? 'win' : 'wins'} · ${e.stats?.seeds ?? 0} seeds`;
    li.append(dot, name, score);
    list.append(li);
  }
}

$('play').onclick = startGame;
$('again').onclick = () => { pose.me.cheer = pose.baba.cheer = 0; setMode('menu'); renderLevels(); };
$('rules-open').onclick = () => { $('rules').hidden = false; };
$('rules-close').onclick = () => { $('rules').hidden = true; };
$('mute').textContent = isMuted() ? '\u{1F507}' : '\u{1F50A}';
$('mute').onclick = () => { unlock(); $('mute').textContent = toggleMute() ? '\u{1F507}' : '\u{1F50A}'; };
setUpSeeds();
setMode('menu');
updateScores();

// ── Seed counts over each pit ──
const counts = [];
for (let i = 0; i < 14; i++) {
  const el = document.createElement('div');
  el.className = i < 12 ? `count ${i < 6 ? 'mine' : 'his'}` : 'count store';
  el.id = i < 12 ? `count-${i}` : `count-store-${i - 12}`;
  $('counts').append(el);
  counts.push(el);
}
const tmp = new THREE.Vector3();
function placeCounts() {
  for (let i = 0; i < 14; i++) {
    const c = i < 12 ? pitCenter(i) : storeCenter(i - 12);
    tmp.copy(c);
    if (i < 12) tmp.z += i < 6 ? 0.068 : -0.068; // just outside the pit, toward its owner
    else tmp.z += 0.1;
    tmp.y = BOARD_TOP + 0.01;
    tmp.project(camera);
    const el = counts[i];
    el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * innerWidth}px, ${(-tmp.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -50%)`;
    el.hidden = tmp.z > 1 || mode === 'menu';
    if (i < 12) el.textContent = String(pitSeeds[i].length);
    else el.textContent = String(storeSeeds[i - 12].length);
  }
  // speech bubble over the speaker
  const b = $('bubble');
  if (!b.hidden) {
    const head = b.dataset.who === 'you' ? new THREE.Vector3(0, 1.42, SEAT_Z) : new THREE.Vector3(0, 1.55, -SEAT_Z);
    head.project(camera);
    // keep the bubble on screen, below the scoreboard
    const bx = THREE.MathUtils.clamp((head.x * 0.5 + 0.5) * innerWidth, 140, innerWidth - 140);
    const by = Math.max(150, (-head.y * 0.5 + 0.5) * innerHeight);
    b.style.transform = `translate(${bx}px, ${by}px) translate(-50%, -100%)`;
  }
}

// ── Picking pits ──
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = -1;
function pitAt(x, y) {
  pointer.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(hitTargets)[0];
  return hit ? hit.object.userData.pit : -1;
}
function canPlay(pit) {
  return mode === 'playing' && !busy && game.turn === 0 && legalMoves(game).includes(pit);
}

// ── Move preview (Easy and Normal, and during the lesson) ──
// Shows where the last seed will land, and what it would capture.
const previewOn = () => level < 2 || lesson.active;
const landRing = glow.clone();
landRing.material = glow.material.clone();
scene.add(landRing);
let previewKey = null;
function showPreview(pit) {
  const key = pit < 0 ? '' : `${pit}:${game.pits.join(',')}`;
  if (key === previewKey) return;
  previewKey = key;
  for (const el of counts) {
    el.classList.remove('path', 'land', 'gain');
    delete el.dataset.gain;
  }
  landRing.visible = false;
  const hint = $('hint');
  if (pit < 0) {
    hint.textContent = previewOn() ? (matchMedia('(pointer: coarse)').matches ? 'Tap a pit to see where it goes, tap again to play' : 'Point at a pit to see where it goes, click to play') : 'Tap a glowing number, or press 1–6';
    return;
  }
  const r = play(game, pit);
  const last = r.path[r.path.length - 1];
  for (const i of r.path) counts[i].classList.add('path');
  counts[last].classList.add('land');
  const taken = r.captures.reduce((n, c) => n + c.count, 0);
  for (const c of r.captures) {
    counts[c.pit].classList.add('gain');
    counts[c.pit].dataset.gain = `+${c.count}`;
  }
  const c = pitCenter(last);
  landRing.position.set(c.x, BOARD_TOP + 0.004, c.z);
  landRing.material.color.set(taken ? '#ff7a59' : '#7fc8ff');
  landRing.visible = true;
  const tap = selected === pit ? ' Tap again to play.' : '';
  const seeds = r.path.length === 1 ? '1 seed' : `${r.path.length} seeds`;
  hint.textContent = taken
    ? `${seeds}: captures ${taken}!${tap}`
    : r.grandSlam
      ? `That would take all of Baba’s seeds, so it captures nothing.${tap}`
      : `${seeds}: the last lands in ${last < 6 ? 'your' : 'Baba’s'} row.${tap}`;
}

// Drag to look around; a click without much movement picks a pit.
const VIEW = { yaw: 0.76, pitch: 0.95, dist: 1.8 }; // up and to your right, looking past your shoulder
let yaw = VIEW.yaw;
let pitch = VIEW.pitch;
let dist = VIEW.dist;
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  unlock();
  drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (drag && drag.id === e.pointerId) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > 6) {
      yaw = THREE.MathUtils.clamp(yaw - dx * 0.005, -1.3, 1.5);
      pitch = THREE.MathUtils.clamp(pitch + dy * 0.004, 0.25, 1.25);
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
  }
  const pit = e.pointerType === 'mouse' ? pitAt(e.clientX, e.clientY) : -1;
  hovered = canPlay(pit) ? pit : -1;
  renderer.domElement.style.cursor = hovered >= 0 ? 'pointer' : drag && drag.moved > 6 ? 'grabbing' : 'grab';
});
// Mouse: hover shows the preview and a click plays. Touch: the first tap on a pit shows its
// preview, a second tap on the same pit plays it.
let selected = -1;
renderer.domElement.addEventListener('pointerup', (e) => {
  if (drag && drag.id === e.pointerId && drag.moved <= 6) {
    const pit = pitAt(e.clientX, e.clientY);
    if (canPlay(pit)) {
      if (e.pointerType === 'mouse' || pit === selected || !previewOn()) playerMove(pit);
      else selected = pit;
    } else {
      selected = -1;
    }
  }
  drag = null;
});
renderer.domElement.addEventListener('wheel', (e) => {
  dist = THREE.MathUtils.clamp(dist + e.deltaY * 0.001, 0.9, 2.6);
}, { passive: true });
addEventListener('keydown', (e) => {
  unlock();
  if (e.key >= '1' && e.key <= '6') playerMove(Number(e.key) - 1);
  else if (e.key === 'm' || e.key === 'M') $('mute').click();
  else if (e.key === 'Enter' && mode === 'menu') startGame();
});

// ── Loop ──
// On your turn the camera looks at the board; on Baba's turn it eases up to show him too.
const boardTarget = new THREE.Vector3(0, BOARD_TOP + 0.02, -0.04);
const babaTarget = new THREE.Vector3(0, 0.7, -0.3);
const target = new THREE.Vector3().copy(boardTarget);
const menuTarget = new THREE.Vector3(0, 0.75, 0);
let babaFocus = 0;
const clock = new THREE.Clock();
let time = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  stepTweens(dt);
  followHand(dt);
  // the menu slowly circles from your back to your face, framing both players
  const menu = mode === 'menu' && !cover;
  const tall = Math.max(0, 1 / camera.aspect - 1);
  // on tall screens the camera stands further back, so keep its orbit clear of the house walls
  if (menu) yaw = tall > 0 ? 1.0 + Math.sin(time * 0.15) * 0.75 : 1.25 + Math.sin(time * 0.15) * 1.05;
  const wantFocus = mode === 'over' || (mode === 'playing' && game.turn === 1) ? 1 : 0;
  babaFocus += (wantFocus - babaFocus) * Math.min(1, dt * 2.2);
  target.lerpVectors(boardTarget, babaTarget, babaFocus);
  const look = menu ? menuTarget : target;
  // tall phone screens see less from side to side, so step back
  const d = (menu ? 3.1 * (1 + tall * 0.33) : (dist + 0.25 * babaFocus) * (1 + tall * 0.16));
  const p = menu ? 0.3 : pitch - 0.32 * babaFocus;
  camera.position.set(
    look.x + Math.sin(yaw) * Math.cos(p) * d,
    look.y + Math.sin(p) * d,
    look.z + Math.cos(yaw) * Math.cos(p) * d,
  );
  camera.lookAt(look);
  if (me) me.animate(dt, { ...pose.me, time, leanIn: mode === 'cover' ? 1 : 0.35 });
  baba.animate(dt, { ...pose.baba, time: time + 1.3 });

  // the pit being considered: hovered (mouse), tapped once (touch), or the one Baba points to
  const focusPit = [hovered, selected, lesson.pit].find((p) => p >= 0 && canPlay(p)) ?? -1;
  if (focusPit >= 0) {
    const c = pitCenter(focusPit);
    glow.position.set(c.x, BOARD_TOP + 0.004, c.z);
    glow.material.opacity = 0.65 + Math.sin(time * 6) * 0.25;
    glow.visible = true;
  } else {
    glow.visible = false;
  }
  showPreview(previewOn() ? focusPit : -1);
  document.querySelectorAll('.count.mine').forEach((el, i) => el.classList.toggle('playable', mode === 'playing' && game.turn === 0 && !busy && legalMoves(game).includes(i)));
  placeCounts();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Cover-picture mode (?cover): a close look at the board mid-game.
const cover = params.has('cover');
if (cover) {
  document.body.classList.add('cover');
  const t = document.createElement('div');
  t.className = 'cover-title';
  t.innerHTML = '<h1>Ayo <span>Olopon</span></h1><p>Sit down with Baba. Play Ayo.</p>';
  document.body.append(t);
  // play a few opening moves so the board looks lived-in
  game = newGame();
  setUpSeeds();
  for (const m of [2, 8, 4, 10]) {
    const r = play(game, m);
    const mover = game.turn;
    const hand = pitSeeds[m].splice(0);
    r.path.forEach((p) => { pitSeeds[p].push(hand.shift()); });
    r.captures.forEach((c) => storeSeeds[mover].push(...pitSeeds[c.pit].splice(0)));
    game = r.state;
  }
  for (let i = 0; i < 12; i++) pitSeeds[i].forEach((s, n) => s.position.copy(seedSlot(i, n, s.userData.id)));
  // side view: you reaching in on the left, Baba watching on the right
  boardTarget.set(0, 0.78, 0);
  yaw = 1.5;
  pitch = 0.26;
  dist = 2.75;
  pose.me.reach = 1;
  pose.me.reachToX = 0.05;
  camera.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.12, 0, innerWidth, innerHeight);
  mode = 'cover';
}

requestAnimationFrame(frame);

if (params.has('debug')) {
  window.__ayo = {
    get game() { return game; },
    get mode() { return mode; },
    get busy() { return busy; },
    start: startGame,
    move: playerMove,
    setLevel: (l) => { level = l; },
    finish: (mine, his) => {
      game = { ...game, stores: [mine, his], over: true, winner: mine === his ? null : mine > his ? 0 : 1, endReason: 'majority' };
      endGame();
    },
    pitSeeds: () => pitSeeds.map((p) => p.length),
    lessonPit: () => lesson.pit,
    screenOf: (i) => {
      const v = pitCenter(i).project(camera);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
    },
  };
}
