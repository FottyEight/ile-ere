import * as THREE from 'three';
import { buildScene, pitCenter, storeCenter, seedSlot, storeSlot, BOARD_TOP, SEAT_Z } from './scene.js';
import { buildCharacter, styleKey } from './character.js';
import { newGame, play, legalMoves, chooseMove } from './ayo.js';
import { whoami, saveRun, leaderboard, signIn, onStartNg, cameAsGuest, FALLBACK_GUEST } from './startng.js';
import { unlock, sfx, toggleMute, isMuted } from './sound.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const SPEED = params.has('fast') ? 6 : 1; // ?fast speeds animations up for testing
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
    if (tw.t >= 1) { tweens.splice(i, 1); tw.resolve(); }
  }
}

// ── Game state ──
let game = newGame();
let mode = 'menu';
let busy = false;
let level = 1;
try { level = Math.min(2, Math.max(0, Number(localStorage.getItem('ayo-level') ?? 1))); } catch { /* storage blocked */ }
let streak = 0;
try { streak = Number(localStorage.getItem('ayo-streak')) || 0; } catch { /* storage blocked */ }
const pose = { me: { reach: 0, reachX: 0, cheer: 0 }, baba: { reach: 0, reachX: 0, cheer: 0 } };

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
function say(text, who = 'baba') {
  const b = $('bubble');
  b.textContent = text;
  b.dataset.who = who;
  b.hidden = false;
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => { b.hidden = true; }, 2600);
}
const pickLine = (lines) => lines[Math.floor(Math.random() * lines.length)];

function startGame() {
  unlock();
  game = newGame(0);
  setUpSeeds();
  yaw = VIEW.yaw;
  pitch = VIEW.pitch;
  dist = VIEW.dist;
  setMode('playing');
  updateScores();
  busy = false;
  nextTurn();
  say(pickLine(['Sit down, let’s play!', 'Your turn first, omo mi.', 'Show me what you have.']));
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
  } else {
    setTurnText('Baba is thinking…');
    $('hint').hidden = true;
    babaTurn();
  }
}

async function babaTurn() {
  busy = true;
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
  glow.visible = false;
  $('hint').hidden = true;
  await animateMove(pit);
  busy = false;
  nextTurn();
}

async function animateMove(pit) {
  const mover = game.turn;
  const who = mover === 0 ? pose.me : pose.baba;
  const result = play(game, pit);
  const reachTo = (i) => {
    const x = pitCenter(i).x / 0.25;
    who.reachX = mover === 0 ? x : -x; // Baba faces the other way
  };
  who.reach = 1;
  reachTo(pit);
  setTurnText(mover === 0 ? 'You sow…' : 'Baba sows…');

  // pick up every seed in the pit
  const hand = pitSeeds[pit].splice(0);
  const lift = pitCenter(pit).clone();
  lift.y = BOARD_TOP + 0.05;
  sfx.pickup();
  await Promise.all(hand.map((s, n) => fly(s, lift.clone().add(new THREE.Vector3((n % 3 - 1) * 0.009, Math.floor(n / 3) * 0.01, ((n * 7) % 3 - 1) * 0.009)), 0.22, 0.02)));

  // sow one seed per pit
  for (let k = 0; k < result.path.length; k++) {
    const target = result.path[k];
    const seed = hand.shift();
    reachTo(target);
    pitSeeds[target].push(seed);
    const n = pitSeeds[target].length - 1;
    fly(seed, seedSlot(target, n, seed.userData.id), 0.24, 0.035).then(() => { sfx.clack(); refreshCount(target); });
    // the rest of the hand follows along above the board
    const hover = pitCenter(target).clone();
    hover.y = BOARD_TOP + 0.05;
    hand.forEach((s, m) => fly(s, hover.clone().add(new THREE.Vector3((m % 3 - 1) * 0.009, Math.floor(m / 3) * 0.01, 0)), 0.2, 0.005));
    await wait(170);
  }
  await wait(280);
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
function refreshCount(i) {
  counts[i].textContent = String(pitSeeds[i].length);
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
renderer.domElement.addEventListener('pointerup', (e) => {
  if (drag && drag.id === e.pointerId && drag.moved <= 6) {
    const pit = pitAt(e.clientX, e.clientY);
    if (canPlay(pit)) playerMove(pit);
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
  if (me) me.animate(dt, { ...pose.me, time });
  baba.animate(dt, { ...pose.baba, time: time + 1.3 });

  if (hovered >= 0 && canPlay(hovered)) {
    const c = pitCenter(hovered);
    glow.position.set(c.x, BOARD_TOP + 0.004, c.z);
    glow.material.opacity = 0.65 + Math.sin(time * 6) * 0.25;
    glow.visible = true;
  } else {
    glow.visible = false;
  }
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
  pose.me.reachX = 0.3;
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
    screenOf: (i) => {
      const v = pitCenter(i).project(camera);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
    },
  };
}
