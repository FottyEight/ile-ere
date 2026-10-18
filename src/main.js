import * as THREE from 'three';
import { buildScene, onLoadProgress, pitCenter, storeCenter, seedSlot, storeSlot, BOARD_TOP, SEAT_Z } from './scene.js';
import { buildCharacter, styleKey } from './character.js';
import { SPAWN, VERANDAH, YARD } from './house.js';
import { createFoosballTable } from './foosballTable.js';
import { createWhotTable } from './whotTable.js';
import { createSnookerTable } from './snookerTable.js';
import { createDraughtsTable } from './draughtsTable.js';
import { createLudoTable } from './ludoTable.js';
import { newGame, play, legalMoves, chooseMove } from './ayo.js';
import { whoami, saveRun, leaderboard, signIn, onStartNg, cameAsGuest, FALLBACK_GUEST } from './startng.js';
import { unlock, sfx, play as playSound, setInGame, toggleMute, isMuted, setAmbience, toggleRadio, radioPlaying, okada, cluck, rooster, preload, setListener, setRadioPosition, speak, setVoice, audioStats } from './sound.js';
import { makeGrid, findPath, createPathLine, makeSign, createMinimap } from './nav.js';
import { GUIDES, CONTROLS, LESSONS } from './guides.js';

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
const { scene, seeds, hitTargets, glow, followSun, setTimeOfDay, chickens, radio, setRadioLight, house } = await buildScene(renderer);
$('loading-text').textContent = 'Lighting the lanterns…';

// The time of day follows the player's clock (?time=day|evening|night to try one).
const hour = new Date().getHours();
const timeOfDay = ['day', 'evening', 'night'].includes(params.get('time'))
  ? params.get('time')
  : hour >= 6 && hour < 16 ? 'day' : hour >= 16 && hour < 19 ? 'evening' : 'night';
setTimeOfDay(timeOfDay);
setAmbience(timeOfDay);
$('lead-time').textContent = {
  day: 'It’s a quiet afternoon on the verandah.',
  evening: 'The sun is going down over the courtyard.',
  night: 'NEPA has taken light, so the lanterns are lit.',
}[timeOfDay];
if (timeOfDay === 'night') chickens.forEach((c) => { c.visible = false; }); // gone to roost
setRadioLight(radioPlaying());
setRadioPosition(radio.getWorldPosition(new THREE.Vector3()));

// ── People at the board ──
const ELDER_STYLE = {
  body: 'male', primaryColor: '#efe8d8', secondaryColor: '#2c3e6b', skinColor: '#5b3a26',
  hairColor: '#cfcac0', hair: 'bald', hat: 'none', accessory: 'glasses',
};
const baba = buildCharacter(ELDER_STYLE, { outfit: 'plain', energy: 0.55 }); // calm and slow
{
  // Baba's fila: a soft cloth cap, its top folded over to one side
  const R = baba.headR;
  const cloth = new THREE.MeshPhysicalMaterial({ color: '#2c3e6b', roughness: 0.9, sheen: 0.6, sheenColor: '#5b74b5' });
  const fila = new THREE.Group();
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.98, R * 1.02, R * 0.75, 32), cloth);
  const fold = new THREE.Mesh(new THREE.SphereGeometry(R * 1.0, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), cloth);
  fold.position.set(R * 0.25, R * 0.3, 0);
  fold.scale.set(1.15, 0.55, 1.0);
  fold.rotation.z = -0.35;
  fila.add(band, fold);
  fila.position.set(0, R * 0.78, -R * 0.05);
  fila.rotation.z = -0.12;
  fila.traverse((o) => { o.castShadow = true; });
  baba.head.add(fila);
}
baba.root.position.set(0, 0, -SEAT_Z);
scene.add(baba.root);

const playerNode = new THREE.Group();
playerNode.position.copy(SPAWN);
playerNode.rotation.y = Math.PI; // facing into the house
scene.add(playerNode);
let me = null;
let meKey = '';
const shadowAll = (o) => o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
shadowAll(baba.root);

// ── The regulars at the other tables ──
const regulars = house.regulars.map((r) => {
  const c = buildCharacter(r.style, r.look);
  shadowAll(c.root);
  c.root.position.copy(r.pos);
  c.root.rotation.y = r.face;
  if (r.child) {
    // children: smaller, and raised so they still sit on the stool
    c.root.scale.setScalar(0.78);
    if (!r.standing) c.root.position.y = 0.46 * (1 - 0.78);
  }
  scene.add(c.root);
  return { ...r, c, gestureIn: 4 + Math.random() * 8 };
});

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
// (the character is only swapped once the scene is ready: rebuilding it while the shaders are
// still compiling breaks the compile)
let markReady;
const sceneReady = new Promise((r) => { markReady = r; });
async function refreshIdentity() {
  if (refreshing) return;
  refreshing = true;
  try {
    const who = await whoami();
    await sceneReady;
    applyIdentity(who);
  } finally {
    refreshing = false;
  }
}
applyIdentity(identity);
refreshIdentity();
addEventListener('focus', refreshIdentity);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshIdentity(); });

const trySignIn = () => (onStartNg ? signIn() : toast('Sign-in works when the game is played on start.ng', 2600));
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
let mode = 'walk';
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
  $('hud').hidden = !['playing', 'over'].includes(next);
  $('walk-hud').hidden = next !== 'walk';
  $('table-menu').hidden = next !== 'tmenu';
  $('table-over').hidden = next !== 'tover';
  $('table-hud').hidden = next !== 'tplay' && next !== 'tover';
  setInGame(next === 'playing' || next === 'tplay' || next === 'over' || next === 'tover');
  if (next !== 'tplay') $('table-actions').replaceChildren();
}
const atTable = () => mode === 'tmenu' || mode === 'tplay' || mode === 'tover';

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

// a soft chime when it becomes your turn (at any table)
let wasMyTurn = false;
function chimeIfMine(text) {
  const mine = /^Your (turn|move|shot)/.test(text);
  if (mine && !wasMyTurn) sfx.yourTurn();
  wasMyTurn = mine;
}
function setTurnText(text) {
  chimeIfMine(text);
  $('turn').textContent = text;
}

// speech bubbles over a player's head
let bubbleTimer = 0;
function say(text, who = 'baba', ms = 2600) {
  const b = $('bubble');
  b.textContent = text;
  b.dataset.who = who;
  b.hidden = false;
  talkUntil = performance.now() + Math.min(ms, 400 + text.length * 55); // roughly the time to say it
  voice(who, text, Math.min(ms, 400 + text.length * 55) / 1000);
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => { b.hidden = true; }, ms / Math.sqrt(SPEED));
}
const pickLine = (lines) => lines[Math.floor(Math.random() * lines.length)];
// whoever is talking, heard from where their head is
function speakerHead(who) {
  if (who === 'baba') return baba.head.getWorldPosition(new THREE.Vector3());
  if (who === 'you') return me ? me.head.getWorldPosition(new THREE.Vector3()) : walker.pos.clone().setY(1.5);
  return regulars.find((r) => r.name === who)?.c.head.getWorldPosition(new THREE.Vector3()) ?? null;
}
function voice(who, text, seconds, priority = 1) {
  if (who === 'you' && me) setVoice('you', { female: me.style?.body === 'female' });
  speak(who, text, speakerHead(who), seconds, priority);
}
// whose speech bubble is showing, so their mouth moves (for about as long as it takes to say it)
let talkUntil = 0;
const talkingNow = (who) => (!$('bubble').hidden && $('bubble').dataset.who === who && performance.now() < talkUntil)
  || (teaching.who === who && performance.now() < teaching.talkUntil);

// ── Lessons at the other tables: the first time you play, the host explains as things happen ──
// Lines come from LESSONS (guides.js). They show in a tip under the scoreboard, one after
// another, so the players' shouts in speech bubbles don't cut them off.
const LESSON_SPEAKER = { draughts: 'Tunde', whot: 'Iya Bisi', ludo: 'Kemi', snooker: 'Emeka', foosball: 'Chidi' };
const teaching = { id: null, who: null, said: new Set(), queue: [], timer: 0, talkUntil: 0 };
const isTaught = (id) => { try { return localStorage.getItem(`joint-taught-${id}`) === '1'; } catch { return false; } };
function markTaught(id, yes = true) {
  try { if (yes) localStorage.setItem(`joint-taught-${id}`, '1'); else localStorage.removeItem(`joint-taught-${id}`); } catch { /* storage blocked */ }
}
function beginTeaching(id) {
  stopTeaching();
  if (!LESSONS[id] || isTaught(id)) return;
  Object.assign(teaching, { id, who: LESSON_SPEAKER[id], said: new Set() });
  teach('intro', 1400); // after the host's opening line
}
function teach(key, delay = 0) {
  const lines = teaching.id && LESSONS[teaching.id]?.[key];
  if (!lines || teaching.said.has(key)) return;
  teaching.said.add(key);
  teaching.queue.push(...[].concat(lines));
  if (!teaching.timer) teaching.timer = setTimeout(nextTip, delay);
}
function nextTip() {
  const line = teaching.queue.shift();
  if (!line) {
    teaching.timer = setTimeout(() => { teaching.timer = 0; $('tip').hidden = true; }, 2500);
    return;
  }
  $('tip-who').textContent = `${teaching.who}:`;
  $('tip-text').textContent = line;
  $('tip').hidden = false;
  regulars.find((r) => r.name === teaching.who)?.c.gesture('nod', 0.8);
  // long enough to read, then the next line (the last one lingers a little)
  const ms = THREE.MathUtils.clamp(line.length * 60, 3200, 9000);
  teaching.talkUntil = performance.now() + Math.min(ms, 400 + line.length * 55);
  voice(teaching.who, line, Math.min(ms, 400 + line.length * 55) / 1000, 2);
  teaching.timer = setTimeout(nextTip, ms);
}
function stopTeaching() {
  clearTimeout(teaching.timer);
  Object.assign(teaching, { id: null, who: null, queue: [], timer: 0, talkUntil: 0 });
  $('tip').hidden = true;
}
// a finished first game ends the lesson at that table
function endTeaching(id) {
  if (teaching.id !== id) return;
  markTaught(id);
  const done = LESSONS[id]?.done;
  const who = teaching.who;
  stopTeaching();
  if (done) setTimeout(() => say(done, who, 4200), 1600);
}
$('tip-skip').onclick = () => {
  if (!teaching.id) return;
  markTaught(teaching.id);
  const who = teaching.who;
  stopTeaching();
  say('Okay, you know am already. No wahala!', who, 2400);
};

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
  // now and then Baba strokes his chin and takes his time over a move
  const ponder = level > 0 && Math.random() < 0.35;
  const thinkMs = (ponder ? 1900 + Math.random() * 900 : 700 + Math.random() * 700) / SPEED;
  if (ponder) baba.gesture('chin', thinkMs / 1000 + 0.2);
  await new Promise((r) => setTimeout(r, Math.max(0, thinkMs - (performance.now() - t0))));
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
  const reachTo = (i) => {
    who.reachToX = mover === 0 ? -pitCenter(i).x : pitCenter(i).x;
    sowing.mover = mover;
    sowing.pit = i; // both players watch the pit being sown
  };
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
  who.grip = 0.8; // cup the hand around the seeds

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
  sowing.pit = -1;
  who.grip = 0;
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
    // reactions: Baba laughs at a big haul and is taken aback when you make one
    if (mover === 1) {
      baba.gesture(total >= 4 ? 'laugh' : 'nod', total >= 4 ? 1.8 : 1.1);
      me?.gesture(total >= 4 ? 'shake' : 'nod', 1.2);
      say(pickLine(total >= 4 ? [`Ehen! ${total} for Baba!`, 'Haha! You no see am coming?', 'Baba never old o!'] : [`Ehen! ${total} for Baba.`, 'You see am?', 'Na so we dey do am!', 'Thank you o!']));
    } else {
      baba.gesture(total >= 4 ? 'surprise' : 'nod', total >= 4 ? 1.7 : 1.1);
      me?.gesture('nod', 1);
      if (lesson.active) endLesson(`Ehen! Those ${total} seeds are yours now. First to 25 seeds wins. Go on, try to beat me!`);
      else say(pickLine(total >= 4 ? [`Ah! ${total}? Omo mi!`, 'Who taught you this one?', 'Ehn! You don wake up today!'] : [`Ah! You took ${total}.`, 'Omo mi, you sabi!', 'Hmm, not bad at all.', 'I see you o!']));
    }
  } else if (result.grandSlam) {
    (mover === 0 ? baba : me)?.gesture('shake', 1.3);
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

// ── Baba's proverbs, one after each game ──
const PROVERBS = [
  ['Bí ọmọdé bá mọ ọwọ́ wẹ̀, á bá àgbà jẹun.', 'If a child learns to wash their hands, they eat with the elders.'],
  ['Ìgbà kan ń lọ, ìgbà kan ń bọ̀.', 'One season goes, another comes.'],
  ['Sùúrù ni baba ìwà.', 'Patience is the father of good character.'],
  ['Ọ̀rọ̀ púpọ̀ kò kún agbọ̀n.', 'Many words do not fill a basket.'],
  ['Díẹ̀díẹ̀ ni imú elédè ń wọ ọgbà.', 'Little by little, the pig’s snout gets into the garden.'],
  ['Ìkòkò tí yóò jẹ ata, ìdí rẹ̀ á gbóná.', 'The pot that will cook pepper soup must bear the fire.'],
  ['Ọwọ́ ọmọdé kò tó pẹpẹ, tàgbàlagbà kò wọ akèrègbè.', 'A child’s hand can’t reach the high shelf; an elder’s hand can’t fit in the gourd.'],
  ['Ẹni tí yóò jẹ oyin inú àpáta kì í wo ẹnu àáké.', 'Whoever wants honey from the rock does not fear the axe’s edge.'],
];
let proverbIndex = Math.floor(Math.random() * PROVERBS.length);
function showProverb() {
  const [yo, en] = PROVERBS[proverbIndex++ % PROVERBS.length];
  $('proverb-yo').textContent = `“${yo}”`;
  $('proverb-en').textContent = en;
}

// ── Your record against Baba, kept in this browser ──
let record = { levels: [{ w: 0, l: 0, d: 0 }, { w: 0, l: 0, d: 0 }, { w: 0, l: 0, d: 0 }], bestStreak: 0, mostSeeds: 0 };
try {
  const saved = JSON.parse(localStorage.getItem('ayo-record'));
  if (saved?.levels?.length === 3) record = saved;
} catch { /* storage blocked or empty */ }
function recordGame(won, lost, seeds) {
  const r = record.levels[level];
  if (won) r.w++; else if (lost) r.l++; else r.d++;
  record.bestStreak = Math.max(record.bestStreak, streak);
  if (won) record.mostSeeds = Math.max(record.mostSeeds, seeds);
  try { localStorage.setItem('ayo-record', JSON.stringify(record)); } catch { /* storage blocked */ }
  renderRecord();
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function recordLine(l) {
  const r = record.levels[l];
  return `Against ${LEVELS[l]} Baba: ${plural(r.w, 'win')}, ${r.l} ${r.l === 1 ? 'loss' : 'losses'}${r.d ? `, ${plural(r.d, 'draw')}` : ''}`;
}
function renderRecord() {
  const played = record.levels.some((r) => r.w + r.l + r.d > 0);
  $('record').hidden = !played;
  if (!played) return;
  $('record-rows').replaceChildren(...record.levels.map((r, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${LEVELS[i]}</span><b>${r.w}–${r.l}${r.d ? `–${r.d}` : ''}</b>`;
    return li;
  }));
  $('record-best').textContent = `Best streak: ${record.bestStreak}${record.mostSeeds ? ` · Most seeds in a win: ${record.mostSeeds}` : ''}`;
}
renderRecord();

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
  // Baba claps for you when you win, and has a good laugh when he does
  if (won) baba.gesture('clap', 3.2);
  else if (lost) baba.gesture('laugh', 2.6);
  else baba.gesture('nod', 1.4);
  if (lost) me?.gesture('shake', 1.4);
  if (won) sfx.win(); else sfx.lose();
  $('over-title').textContent = won ? 'You beat Baba!' : lost ? 'Baba wins this one' : 'It’s a draw';
  $('over-you').textContent = String(mine);
  $('over-baba').textContent = String(his);
  say(won ? pickLine(['Ah, you sabi this game!', 'Well played, omo mi!']) : lost ? pickLine(['Baba never old!', 'Come back tomorrow, I’ll still be here.']) : 'We are equal today.');
  showProverb();

  if (level > 0) streak = won ? streak + 1 : 0;
  try { localStorage.setItem('ayo-streak', String(streak)); } catch { /* storage blocked */ }
  $('over-streak').textContent = level === 0 ? 'Practice game (Easy)' : `Win streak: ${streak}`;
  recordGame(won, lost, mine);
  $('over-record').textContent = recordLine(level);

  const status = $('over-status');
  $('over-signin').hidden = true;
  if (won && level > 0) countWin('ayo');
  if (identity.user) {
    if (level === 0) status.textContent = 'Easy games don’t go on the leaderboard.';
    else await saveWins(status);
  } else {
    status.textContent = 'Sign in with start.ng to put your wins on the leaderboard.';
    $('over-signin').hidden = false;
  }
  renderBoard();
}

// The joint's leaderboard: total wins, then wins per kind of game.
async function renderBoard(list = $('board'), note = $('board-note')) {
  list.replaceChildren();
  note.textContent = 'Loading leaderboard…';
  const entries = await leaderboard(10);
  if (!entries) {
    note.textContent = onStartNg ? 'Could not load the leaderboard.' : 'The leaderboard shows up when you play on start.ng.';
    return;
  }
  note.textContent = entries.length ? '' : 'No wins yet. Be the first!';
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
    const wins = e.stats?.wins ?? e.score;
    score.textContent = `${wins} ${wins === 1 ? 'win' : 'wins'}`;
    score.title = e.stats ? `Ayo ${e.stats.ayo ?? 0} · Whot ${e.stats.whot ?? 0} · Draughts & Ludo ${e.stats.boards ?? 0} · Snooker & Football ${e.stats.cue ?? 0}` : '';
    li.append(dot, name, score);
    list.append(li);
  }
}

$('play').onclick = startGame;
$('again').onclick = () => { pose.me.cheer = pose.baba.cheer = 0; setMode('menu'); renderLevels(); renderRecord(); };
document.addEventListener('click', (e) => { if (e.target.closest?.('button')) { unlock(); sfx.click(); } });
$('mute').textContent = isMuted() ? '\u{1F507}' : '\u{1F50A}';
$('mute').onclick = () => { unlock(); $('mute').textContent = toggleMute() ? '\u{1F507}' : '\u{1F50A}'; };
setUpSeeds();
setMode('walk');
updateScores();
setTimeout(() => toast('Welcome to Ilé Eré, the House of Play! Walk up to a table to play, or tap ☰ for the tables and a tour.', 6000), 600);

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
    el.hidden = tmp.z > 1 || mode === 'menu' || mode === 'walk';
    if (i < 12) el.textContent = String(pitSeeds[i].length);
    else el.textContent = String(storeSeeds[i - 12].length);
  }
  // speech bubble over the speaker
  const b = $('bubble');
  if (!b.hidden) {
    const who = b.dataset.who;
    const speaker = who === 'you' ? me : who === 'baba' ? baba : regulars.find((r) => r.name === who)?.c ?? baba;
    const head = speaker.head.getWorldPosition(new THREE.Vector3());
    head.y += 0.22;
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
// at a table, its game gets first go at the pointer (aiming a cue, sliding rods, picking cards)
const aimRay = (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster;
};
const tableWants = () => mode === 'tplay' && activeTable;
renderer.domElement.addEventListener('pointerdown', (e) => {
  unlock();
  const owned = tableWants() && activeTable.pointerDown?.(e, aimRay(e));
  drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId, owned: !!owned };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (tableWants() && activeTable.pointerMove?.(e, aimRay(e), drag?.owned)) {
    if (drag) { drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY; }
    return;
  }
  if (drag && drag.id === e.pointerId) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > 6) {
      if (mode === 'walk') {
        walkCam.yaw -= dx * 0.006;
        walkCam.pitch = THREE.MathUtils.clamp(walkCam.pitch + dy * 0.004, 0.05, 0.9);
        walkCam.dragged = 2.5; // stop the camera swinging back behind you for a moment
      } else if (atTable() && activeTable) {
        const v = activeTable.view;
        yaw = THREE.MathUtils.clamp(yaw - dx * 0.005, v.yaw - 1.4, v.yaw + 1.4);
        pitch = THREE.MathUtils.clamp(pitch + dy * 0.004, 0.2, v.maxPitch ?? 1.35);
      } else {
        yaw = THREE.MathUtils.clamp(yaw - dx * 0.005, -1.3, 1.5);
        pitch = THREE.MathUtils.clamp(pitch + dy * 0.004, 0.25, 1.25);
      }
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
  if (tableWants()) {
    activeTable.pointerUp?.(e, aimRay(e), { tap: !!drag && drag.moved <= 6, owned: !!drag?.owned });
    drag = null;
    return;
  }
  if (drag && drag.id === e.pointerId && drag.moved <= 6 && mode === 'walk') {
    // tap or click to walk there; on a table, walk up to it
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.intersectObject(radio).length) {
      const on = toggleRadio();
      setRadioLight(on);
      toast(on ? 'Baba’s radio is on 🎶' : 'Radio off', 1600);
    } else {
      const hit = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
      if (hit) { if (tour.active) endTour(); walkTo(hit); }
    }
    drag = null;
    return;
  }
  if (drag && drag.id === e.pointerId && drag.moved <= 6) {
    const pit = pitAt(e.clientX, e.clientY);
    if (pit < 0 && raycaster.intersectObject(radio).length) {
      // clicking the radio switches the music on or off
      const on = toggleRadio();
      setRadioLight(on);
      toast(on ? 'Baba’s radio is on 🎶' : 'Radio off', 1600);
    } else if (canPlay(pit)) {
      if (e.pointerType === 'mouse' || pit === selected || !previewOn()) playerMove(pit);
      else selected = pit;
    } else {
      selected = -1;
    }
  }
  drag = null;
});
renderer.domElement.addEventListener('wheel', (e) => {
  if (mode === 'walk') walkCam.dist = THREE.MathUtils.clamp(walkCam.dist + e.deltaY * 0.002, 1.6, 5);
  else if (atTable() && activeTable) dist = THREE.MathUtils.clamp(dist + e.deltaY * 0.0015, activeTable.view.dist * 0.5, activeTable.view.dist * (activeTable.view.maxPitch ? 1.15 : 1.8));
  else dist = THREE.MathUtils.clamp(dist + e.deltaY * 0.001, 0.9, 2.6);
}, { passive: true });
const held = new Set();
addEventListener('keydown', (e) => {
  unlock();
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mode === 'walk') {
    if (['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift'].includes(k)) {
      held.add(k);
      walker.target = null;
      if (k.startsWith('Arrow')) e.preventDefault();
    } else if ((k === 'e' || k === 'Enter' || k === ' ') && nearStation) {
      e.preventDefault();
      useStation(nearStation);
    } else if (k === 'm') $('mute').click();
    return;
  }
  if (atTable()) {
    if (k === 'm') $('mute').click();
    else if (mode === 'tplay') activeTable?.keyDown?.(e, k);
    else if (k === 'Enter') startTable();
    else if (k === 'Escape') standUp();
    return;
  }
  if (e.key >= '1' && e.key <= '6') playerMove(Number(e.key) - 1);
  else if (k === 'm') $('mute').click();
  else if (e.key === 'Enter' && mode === 'menu') startGame();
  else if (e.key === 'Escape' && (mode === 'menu' || mode === 'over')) standUp();
});
addEventListener('keyup', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  held.delete(k);
  if (mode === 'tplay') activeTable?.keyUp?.(e, k);
});
addEventListener('blur', () => held.clear());

// ── Walking around the joint ──
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const WALK_SPEED = 1.5;
const RUN_SPEED = 3.0;
const BODY_R = 0.27;
const walker = {
  pos: SPAWN.clone(),
  heading: Math.PI, // facing into the house (-z)
  speed: 0,
  target: null, // a point to walk to (from a tap or click)
  goingTo: null, // a table to use on arrival
  seat: null, // { from, to, t, face, onDone } while sitting down
  path: [], // the corners still to come on the way to `target`
  onArrive: null, // called when you get there (true) or get stuck (false)
};
const walkCam = { yaw: 0, pitch: 0.32, dist: 3.2, dragged: 0 };
walkCam.yaw = walker.heading + Math.PI;
for (const s of house.stations) {
  // the middle of each table, for spotting clicks on it
  s.centre = s.seat.clone().add(s.seat.clone().sub(s.approach).setLength(0.75));
}
const stationById = (id) => house.stations.find((s) => s.id === id);
let nearStation = null;

// the floor you can walk on, as a grid, for finding a way round tables and walls
const WALK_AREA = { minX: VERANDAH.minX, maxX: VERANDAH.maxX, minZ: VERANDAH.back, maxZ: YARD.front, verandahFront: VERANDAH.front };
const walkGrid = makeGrid(house.colliders, WALK_AREA, 0.2, BODY_R + 0.04);
const pathLine = createPathLine(scene);

function walkTo(point, { sit = true, onArrive = null } = {}) {
  // clicking on or near a table walks you up to it and sits you down
  const table = sit ? house.stations.find((s) => Math.hypot(point.x - s.centre.x, point.z - s.centre.z) < 1.0) : null;
  const dest = table ? table.approach.clone() : new THREE.Vector3(point.x, 0, point.z);
  walker.goingTo = table ?? null;
  walker.onArrive = onArrive;
  walker.stuck = 0;
  // the way there, round anything in between (straight there if no way is found)
  const path = findPath(walkGrid, walker.pos, dest) ?? [{ x: dest.x, z: dest.z }];
  walker.path = path.map((p) => new THREE.Vector3(p.x, 0, p.z));
  walker.target = walker.path.shift();
  pathLine.show();
  tapMark(dest);
}
function stopWalking() {
  walker.target = null;
  walker.path = [];
  walker.goingTo = null;
  walker.onArrive = null;
}
// a little ring where you tapped
const tapRing = new THREE.Mesh(
  new THREE.RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0, depthWrite: false }),
);
scene.add(tapRing);
function tapMark(p) {
  tapRing.position.set(p.x, 0.01, p.z);
  tapRing.material.opacity = 0.9;
}

// pushes a circle at (x, z) out of every collider; returns the corrected point
function collide(p) {
  for (const b of house.colliders) {
    const cx = THREE.MathUtils.clamp(p.x, b.minX, b.maxX);
    const cz = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= BODY_R * BODY_R) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      p.x = cx + (dx / d) * BODY_R;
      p.z = cz + (dz / d) * BODY_R;
    } else {
      // centre inside the box: leave by the nearest side
      const out = [[p.x - b.minX, -1, 0], [b.maxX - p.x, 1, 0], [p.z - b.minZ, 0, -1], [b.maxZ - p.z, 0, 1]].sort((a, c) => a[0] - c[0])[0];
      p.x += out[1] * (out[0] + BODY_R);
      p.z += out[2] * (out[0] + BODY_R);
    }
  }
  return p;
}

function stepWalker(dt) {
  // keyboard movement, relative to the camera
  let ix = 0;
  let iz = 0;
  if (held.has('w') || held.has('ArrowUp')) iz += 1;
  if (held.has('s') || held.has('ArrowDown')) iz -= 1;
  if (held.has('d') || held.has('ArrowRight')) ix += 1;
  if (held.has('a') || held.has('ArrowLeft')) ix -= 1;
  let dir = null;
  if (ix || iz) {
    const fwd = new THREE.Vector2(-Math.sin(walkCam.yaw), -Math.cos(walkCam.yaw));
    const right = new THREE.Vector2(-fwd.y, fwd.x);
    dir = fwd.multiplyScalar(iz).add(right.multiplyScalar(ix)).normalize();
    if (walker.target) { stopWalking(); pathLine.hide(); }
    if (tour.active) endTour();
  } else if (walker.target) {
    const to = new THREE.Vector2(walker.target.x - walker.pos.x, walker.target.z - walker.pos.z);
    const d = to.length();
    const last = !walker.path?.length;
    if (!last && d < 0.3) {
      walker.target = walker.path.shift(); // a corner on the way: carry straight on to the next point
      dir = to.normalize();
    } else if (d < 0.08) {
      const s = walker.goingTo;
      const done = walker.onArrive;
      stopWalking();
      if (s) useStation(s);
      done?.(true);
    } else {
      dir = to.normalize();
      if (last && d < 0.4) dir.multiplyScalar(Math.max(0.35, d / 0.4)); // slow down on arrival
    }
  }
  const wantSpeed = dir ? (held.has('Shift') ? RUN_SPEED : WALK_SPEED) * Math.min(1, dir.length()) : 0;
  walker.speed += (wantSpeed - walker.speed) * Math.min(1, dt * 8);
  if (dir && dir.lengthSq() > 1e-6) {
    const want = Math.atan2(dir.x, dir.y);
    let turn = want - walker.heading;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    walker.heading += turn * Math.min(1, dt * 10);
    const before = walker.pos.clone();
    const n = dir.clone().normalize();
    walker.pos.x += n.x * walker.speed * dt;
    walker.pos.z += n.y * walker.speed * dt;
    collide(walker.pos);
    walker.stride = (walker.stride ?? 0) + walker.pos.distanceTo(before);
    if (walker.stride > (walker.speed > 2 ? 0.8 : 0.62)) {
      walker.stride = 0;
      const tiles = walker.pos.z < VERANDAH.front;
      playSound(tiles ? 'step_tile' : 'step_concrete', { pos: { x: walker.pos.x, y: 0.05, z: walker.pos.z }, volume: tiles ? 0.5 : 0.65, vary: 0.08 });
    }
    // stuck against something on the way to a tapped point: give up
    if (walker.target && walker.pos.distanceTo(before) < walker.speed * dt * 0.2) {
      walker.stuck = (walker.stuck ?? 0) + dt;
      if (walker.stuck > 0.6) {
        const done = walker.onArrive;
        stopWalking();
        walker.stuck = 0;
        pathLine.hide();
        done?.(false);
      }
    } else {
      walker.stuck = 0;
    }
  }
  tapRing.material.opacity = Math.max(0, tapRing.material.opacity - dt * (walker.target ? 0.4 : 3));

  // the camera swings round behind you as you walk, unless you've just turned it yourself
  walkCam.dragged -= dt;
  if (walkCam.wantYaw !== undefined) {
    let d = walkCam.wantYaw - walkCam.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    walkCam.yaw += d * Math.min(1, dt * 3);
    if (Math.abs(d) < 0.01 || walker.target) walkCam.wantYaw = undefined;
  }
  if (walker.speed > 0.3 && walkCam.dragged <= 0) {
    let d = walker.heading + Math.PI - walkCam.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    walkCam.yaw += d * Math.min(1, dt * 1.6);
  }

  // near a table? offer to sit down
  let near = null;
  for (const s of house.stations) {
    if (Math.hypot(walker.pos.x - s.approach.x, walker.pos.z - s.approach.z) < 0.9) near = s;
  }
  if (near !== nearStation) {
    nearStation = near;
    showPrompt(tour.active ? null : near);
  }
}

function showPrompt(s) {
  const p = $('sit-prompt');
  if (!s) { p.hidden = true; return; }
  p.hidden = false;
  p.disabled = !s.ready;
  p.textContent = `${s.standing ? 'Play' : 'Sit down'}: ${s.name} with ${s.host} (E)`;
}
$('sit-prompt').onclick = () => { if (nearStation) useStation(nearStation); };

function useStation(s) {
  if (!s.ready) {
    showPrompt(s);
    return;
  }
  sitAt(s);
}

// walk the last steps to the table, turn to face it and sit (or just stand, for snooker and
// table football); then the table's menu opens
let atStation = null; // the table you're at, once seated
function sitAt(s) {
  held.clear();
  walker.target = null;
  nearStation = null;
  $('sit-prompt').hidden = true;
  $('walk-hud').hidden = true;
  walker.seat = { from: walker.pos.clone(), fromHeading: walker.heading, to: s.seat.clone(), face: s.face, t: 0, station: s };
}
function stepSitting(dt) {
  const st = walker.seat;
  st.t = Math.min(1, st.t + dt / 0.9);
  const e = st.t * st.t * (3 - 2 * st.t);
  walker.pos.lerpVectors(st.from, st.to, Math.min(1, e * 1.4));
  let turn = st.face - st.fromHeading;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  walker.heading = st.fromHeading + turn * e;
  walker.speed = st.t < 0.5 ? 0.6 : 0;
  if (st.t >= 1) {
    walker.seat = null;
    walker.seated = true;
    atStation = st.station;
    if (!atStation.standing) sfx.sit(atStation.seat);
    pose.me.cheer = 0;
    if (atStation.id === 'ayo') {
      setMode('menu');
      renderLevels();
      renderRecord();
      say(pickLine(['Ah, you’ve come! Sit down, let’s play.', 'Welcome, omo mi. Ayo?', 'You’re back! Ready to lose? Haha!']), 'baba', 3200);
    } else {
      openTable(atStation);
    }
  }
}
function standUp() {
  if (busy) return;
  const s = atStation ?? stationById('ayo');
  if (activeTable) { activeTable.stop(); activeTable = null; }
  stopTeaching();
  if (walker.seated && !s.standing) sfx.cloth(s.seat);
  walker.seated = false;
  atStation = null;
  walker.pos.copy(s.approach);
  walker.heading = s.face + Math.PI; // turn away from the table
  walkCam.yaw = s.face;
  walkCam.dragged = 1;
  pose.me.cheer = 0;
  pose.baba.cheer = 0;
  setMode('walk');
  if (s.id === 'ayo') say(pickLine(['Come back anytime!', 'Ó dàbọ̀! Don’t go far.', 'Go well, omo mi.']), 'baba', 2400);
  else {
    const host = regulars.find((r) => r.station === s.id);
    if (host) say(pickLine(['Come back again o!', 'Next time, I go show you.', 'Safe! See you.']), host.name, 2400);
  }
}
$('stand-up').onclick = standUp;
$('over-leave').onclick = standUp;

// ── The other tables ──
// Each game (Draughts, Whot, Ludo, Snooker, Table football) lives in its own module and
// plugs in here through `tableContext`. They share the table menu, HUD and end screen.
const tableGames = {};
let activeTable = null;
const TABLE_LEVELS = ['Easy', 'Normal', 'Hard'];
let tableLevel = 1;

// a table's sounds play from the table: sfx.play('card_slap'), or sfx.play('ball_hit', { pos })
function tableSfx(id) {
  const t = house.tables[id];
  const at = { x: t.center.x, y: (t.top ?? 0.8) + 0.05, z: t.center.z };
  return { ...sfx, play: (name, opts = {}) => sfx.play(name, { pos: at, ...opts }) };
}
function tableContext(id) {
  return {
    THREE, scene, camera, raycaster, pointer,
    info: house.tables[id],
    station: stationById(id),
    regular: (name) => regulars.find((r) => r.name === name),
    me: () => me,
    pose, // pose.me: your reach and grip
    get speed() { return SPEED; },
    get time() { return time; },
    sfx: tableSfx(id), say, toast, wait, fly, pickLine,
    // the host explains this, if it's your first game here (keys from LESSONS in guides.js)
    teach: (key) => { if (teaching.id === id) teach(key); },
    turn: (text) => { chimeIfMine(text); $('table-turn').textContent = text; },
    hint: (text) => { $('table-hint').textContent = text; },
    // seats: [{ name, value, active }]
    score: (seats) => {
      $('table-score').replaceChildren(...seats.map((s) => {
        const d = document.createElement('div');
        d.className = `seat${s.active ? ' active' : ''}`;
        d.innerHTML = `<small></small><b></b>`;
        d.querySelector('small').textContent = s.name;
        d.querySelector('b').textContent = String(s.value);
        return d;
      }));
    },
    // buttons over the table: [{ label, onClick, alt, disabled }]
    actions: (list) => {
      $('table-actions').replaceChildren(...list.map((a) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = a.label;
        if (a.alt) b.className = 'alt';
        b.disabled = !!a.disabled;
        if (a.onClick) b.onclick = () => { unlock(); a.onClick(); };
        // press-and-hold buttons (like charging a snooker shot)
        if (a.onDown) {
          b.addEventListener('pointerdown', (e) => { e.preventDefault(); unlock(); b.setPointerCapture(e.pointerId); a.onDown(); });
          b.addEventListener('pointerup', () => a.onUp?.());
          b.addEventListener('pointercancel', () => a.onUp?.());
        }
        return b;
      }));
    },
    // move the table camera (it eases there); omitted values stay as they are
    setView: ({ yaw: y, pitch: p, dist: d } = {}) => {
      if (y !== undefined) yaw = y;
      if (p !== undefined) pitch = p;
      if (d !== undefined) dist = d;
    },
    // the game is over: { outcome: 'win'|'loss'|'draw', title, detail }
    finish: (result) => finishTable(id, result),
  };
}

function openTable(s) {
  activeTable = tableGames[s.id];
  const t = activeTable;
  try { tableLevel = Math.min(2, Math.max(0, Number(localStorage.getItem(`joint-level-${s.id}`) ?? 1))); } catch { tableLevel = 1; }
  $('table-kicker').textContent = `${s.name} with ${s.host}`;
  $('table-title').textContent = t.title;
  $('table-lead').textContent = t.lead;
  $('table-level-label').textContent = t.levelLabel ?? 'How strong are they?';
  $('table-rules').replaceChildren(...t.rules.map((r) => {
    const li = document.createElement('li');
    li.innerHTML = r;
    return li;
  }));
  $('table-controls').textContent = (CONTROLS[s.id] ?? []).join(' · ');
  $('table-play').textContent = `Play ${t.title}`;
  renderTableLevels();
  renderTableRecord(s.id);
  const v = t.view;
  yaw = v.yaw;
  pitch = v.pitch;
  dist = v.dist;
  t.idle?.();
  setMode('tmenu');
  const host = regulars.find((r) => r.station === s.id);
  if (host) {
    host.c.gesture('nod', 1.2);
    say(pickLine(t.greetings), host.name, 3200);
  }
}
function renderTableLevels() {
  document.querySelectorAll('[data-tlevel]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.tlevel) === tableLevel)));
}
document.querySelectorAll('[data-tlevel]').forEach((b) => {
  b.onclick = () => {
    tableLevel = Number(b.dataset.tlevel);
    try { localStorage.setItem(`joint-level-${atStation?.id}`, String(tableLevel)); } catch { /* storage blocked */ }
    renderTableLevels();
  };
});
function startTable() {
  if (!activeTable) return;
  unlock();
  $('table-turn').textContent = '';
  $('table-hint').textContent = '';
  $('table-actions').replaceChildren();
  setMode('tplay');
  const v = activeTable.view;
  yaw = v.yaw;
  pitch = v.pitch;
  dist = v.dist;
  // first time here? the host talks you through it
  beginTeaching(activeTable.id);
  activeTable.start(tableLevel);
}
$('table-play').onclick = startTable;
$('table-again').onclick = startTable;
$('table-leave').onclick = standUp;
$('table-over-leave').onclick = standUp;
$('table-over-signin').onclick = () => trySignIn();

// ── Records and the shared leaderboard ──
// Each table keeps its own win/loss record per level. The start.ng leaderboard ranks players
// by their total wins at the joint (Normal and Hard only), with a column per kind of game.
function tableRecord(id) {
  try {
    const r = JSON.parse(localStorage.getItem(`joint-record-${id}`));
    if (r?.length === 3) return r;
  } catch { /* storage blocked */ }
  return [{ w: 0, l: 0, d: 0 }, { w: 0, l: 0, d: 0 }, { w: 0, l: 0, d: 0 }];
}
function renderTableRecord(id) {
  const rec = tableRecord(id);
  const played = rec.some((r) => r.w + r.l + r.d > 0);
  $('table-record').hidden = !played;
  $('table-record-rows').replaceChildren(...rec.map((r, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${TABLE_LEVELS[i]}</span><b>${r.w}–${r.l}${r.d ? `–${r.d}` : ''}</b>`;
    return li;
  }));
}
function countWin(id) {
  // wins on Normal and Hard, per game, for the leaderboard
  let wins = {};
  try { wins = JSON.parse(localStorage.getItem('joint-wins')) ?? {}; } catch { /* storage blocked */ }
  wins[id] = (wins[id] ?? 0) + 1;
  try { localStorage.setItem('joint-wins', JSON.stringify(wins)); } catch { /* storage blocked */ }
  return wins;
}
function leaderboardStats() {
  let w = {};
  try { w = JSON.parse(localStorage.getItem('joint-wins')) ?? {}; } catch { /* storage blocked */ }
  const n = (k) => w[k] ?? 0;
  return {
    wins: n('ayo') + n('draughts') + n('whot') + n('ludo') + n('snooker') + n('foosball'),
    ayo: n('ayo'),
    whot: n('whot'),
    boards: n('draughts') + n('ludo'),
    cue: n('snooker') + n('foosball'),
  };
}
async function saveWins(statusEl) {
  if (!identity.user) return;
  statusEl.textContent = 'Saving to start.ng…';
  const saved = await saveRun(leaderboardStats());
  statusEl.textContent = saved.ok
    ? (saved.result.improved ? `New best! You're #${saved.result.rank} at Ilé Eré.` : `You're #${saved.result.rank} on the leaderboard.`)
    : saved.error || 'Could not save to start.ng.';
}
async function finishTable(id, result) {
  setMode('tover');
  endTeaching(id);
  const rec = tableRecord(id);
  const r = rec[tableLevel];
  if (result.outcome === 'win') r.w++;
  else if (result.outcome === 'loss') r.l++;
  else r.d++;
  try { localStorage.setItem(`joint-record-${id}`, JSON.stringify(rec)); } catch { /* storage blocked */ }
  pose.me.cheer = result.outcome === 'win' ? 1 : 0;
  if (result.outcome === 'win') sfx.win(); else sfx.lose();
  $('table-over-title').textContent = result.title;
  $('table-over-detail').textContent = result.detail ?? '';
  $('table-over-record').textContent = `Your record against ${TABLE_LEVELS[tableLevel]}: ${r.w}–${r.l}${r.d ? `–${r.d}` : ''}`;
  const status = $('table-over-status');
  $('table-over-signin').hidden = true;
  if (result.outcome === 'win' && tableLevel > 0) countWin(id);
  if (!identity.user) {
    status.textContent = 'Sign in with start.ng to put your wins on the leaderboard.';
    $('table-over-signin').hidden = false;
  } else if (tableLevel === 0) {
    status.textContent = 'Easy games don’t count on the leaderboard.';
  } else {
    await saveWins(status);
  }
  renderBoard($('table-board'), $('table-board-note'));
}

// the tables whose games are built
tableGames.foosball = createFoosballTable(tableContext('foosball'));
tableGames.whot = createWhotTable(tableContext('whot'));
tableGames.snooker = createSnookerTable(tableContext('snooker'));
tableGames.draughts = createDraughtsTable(tableContext('draughts'));
tableGames.ludo = createLudoTable(tableContext('ludo'));
for (const s of house.stations) s.ready = s.id === 'ayo' || !!tableGames[s.id];

// ── Getting around: signs over the tables, the table picker, the mini-map and Baba's tour ──
const TABLE_ICON = { ayo: '🌰', draughts: '♟️', whot: '🃏', ludo: '🎲', snooker: '🎱', foosball: '⚽' };
const SIGN_SUB = { ayo: 'with Baba', draughts: 'with Tunde', whot: 'with Iya Bisi & co', ludo: 'with Kemi & Tobi', snooker: 'with Emeka', foosball: 'with Chidi' };
const signs = new THREE.Group();
for (const s of house.stations) {
  const sign = makeSign(s.name, SIGN_SUB[s.id] ?? '');
  sign.position.set(s.centre.x, 1.95, s.centre.z);
  // under the snooker canopy the bulb hangs in the middle, so that sign hangs at the edge you come from
  if (s.id === 'snooker') sign.position.add(s.approach.clone().sub(s.centre).setY(0).setLength(1.45)).setY(1.95);
  signs.add(sign);
}
scene.add(signs);

// your record at a table, for the picker: "3–1" (wins–losses), or nothing if you haven't played
function recordSummary(id) {
  const rows = id === 'ayo' ? record.levels : tableRecord(id);
  const w = rows.reduce((n, r) => n + r.w, 0);
  const l = rows.reduce((n, r) => n + r.l, 0);
  const d = rows.reduce((n, r) => n + r.d, 0);
  return w + l + d ? `${w}–${l}${d ? `–${d}` : ''}` : '';
}
const seatedAtAyo = () => ['menu', 'playing', 'over'].includes(mode);
function renderTablePicker() {
  const inGame = mode === 'playing' || mode === 'tplay';
  $('table-list').replaceChildren(...house.stations.map((s) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const here = atStation === s || (s.id === 'ayo' && seatedAtAyo());
    const rec = recordSummary(s.id);
    b.innerHTML = '<span class="icon"></span><span class="what"><b></b><small></small></span><span class="rec"></span>';
    b.querySelector('.icon').textContent = TABLE_ICON[s.id] ?? '•';
    b.querySelector('b').textContent = s.name;
    b.querySelector('small').textContent = here ? `You’re here · ${s.host}` : inGame ? `Leaves this game · ${s.host}` : s.host;
    b.querySelector('.rec').textContent = rec;
    b.querySelector('.rec').title = rec ? 'Your wins–losses here' : '';
    b.onclick = () => { $('tables-sheet').hidden = true; travelTo(s); };
    li.append(b);
    return li;
  }));
  $('tour-start').hidden = mode === 'playing' || mode === 'tplay';
}
function openTablePicker() { renderTablePicker(); $('tables-sheet').hidden = false; }
$('tables-open').onclick = openTablePicker;
$('tables-close').onclick = () => { $('tables-sheet').hidden = true; };
document.querySelectorAll('[data-another]').forEach((b) => { b.onclick = openTablePicker; });

// walk to a table and sit down; from another table you stand up first
function travelTo(s) {
  if (tour.active) endTour();
  if (atStation === s || (s.id === 'ayo' && seatedAtAyo())) return;
  if (seatedAtAyo() || atTable()) {
    if (busy) { toast('Wait for the seeds to land first.', 1800); return; }
    standUp();
  }
  if (walker.seat) return;
  walkTo(s.centre);
}

// the mini-map in the corner: tap a table to go there, or a spot to walk to it
const minimap = createMinimap($('minimap-canvas'), { colliders: house.colliders, stations: house.stations, bounds: WALK_AREA, icons: TABLE_ICON });
let mapFolded = innerWidth < 640;
try { const f = localStorage.getItem('joint-map-folded'); if (f !== null) mapFolded = f === '1'; } catch { /* storage blocked */ }
function foldMap(yes) {
  mapFolded = yes;
  $('minimap').classList.toggle('folded', yes);
  $('minimap-toggle').textContent = yes ? 'Map' : 'Hide map';
}
foldMap(mapFolded);
$('minimap-toggle').onclick = () => {
  foldMap(!mapFolded);
  try { localStorage.setItem('joint-map-folded', mapFolded ? '1' : '0'); } catch { /* storage blocked */ }
};
$('minimap-canvas').addEventListener('click', (e) => {
  unlock();
  if (mode !== 'walk' || walker.seat) return;
  if (tour.active) endTour();
  const hit = minimap.pick(e.clientX, e.clientY);
  if (hit.station) walkTo(hit.station.centre);
  else walkTo(new THREE.Vector3(hit.point.x, 0, hit.point.z), { sit: false });
});
let mapIn = 0;
function stepMinimap(dt) {
  mapIn -= dt;
  if (mapFolded || mapIn > 0) return;
  mapIn = 0.1;
  minimap.draw(walker.pos, walker.heading, walker.goingTo);
}

// ── How to play: a page about the joint and one per game ──
const GUIDE_TABS = [['joint', 'The house'], ['ayo', 'Ayo'], ['draughts', 'Draughts'], ['whot', 'Whot'], ['ludo', 'Ludo'], ['snooker', 'Snooker'], ['foosball', 'Table football']];
let guideTab = 'joint';
function showGuide(key) {
  guideTab = key;
  $('guide-tabs').replaceChildren(...GUIDE_TABS.map(([k, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.textContent = label;
    b.setAttribute('aria-selected', String(k === key));
    b.onclick = () => showGuide(k);
    return b;
  }));
  const g = GUIDES[key];
  const body = $('guide-body');
  // (all of this text is our own, from guides.js)
  body.innerHTML = `<h2>${g.title}</h2><p>${g.intro}</p>`;
  const controls = CONTROLS[key === 'joint' ? 'walk' : key];
  if (controls) body.insertAdjacentHTML('beforeend', `<h3>Controls</h3><ul>${controls.map((c) => `<li>${c}</li>`).join('')}</ul>`);
  for (const sec of g.sections) body.insertAdjacentHTML('beforeend', `<h3>${sec.heading}</h3>${sec.html}${sec.diagram ?? ''}`);
  body.scrollTop = 0;
  // bring the chosen tab into view (on a phone the row scrolls sideways)
  const tabs = $('guide-tabs');
  const on = tabs.querySelector('[aria-selected="true"]');
  requestAnimationFrame(() => { tabs.scrollLeft = on.offsetLeft - tabs.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2; });
  // the lesson button: Baba's Ayo lesson, or the host's at another table
  const rl = $('replay-lesson');
  rl.hidden = key === 'joint';
  const pending = key === 'ayo' ? !taught : !isTaught(key);
  rl.textContent = pending ? 'The lesson will play in your next game here' : 'Show me the lesson again next game';
  rl.disabled = pending;
}
// opens on whatever you're doing: the table you're at, the one you're near, or the joint
function guideContext() {
  if (atTable() && activeTable) return activeTable.id;
  if (seatedAtAyo()) return 'ayo';
  return nearStation?.id ?? 'joint';
}
$('rules-open').onclick = () => { showGuide(guideContext()); $('rules').hidden = false; };
$('rules-close').onclick = () => { $('rules').hidden = true; };
$('replay-lesson').onclick = () => {
  if (guideTab === 'ayo') {
    taught = false;
    try { localStorage.removeItem('ayo-taught'); } catch { /* storage blocked */ }
  } else {
    markTaught(guideTab, false);
  }
  showGuide(guideTab);
};
$('walk-hint').textContent = CONTROLS.walk.slice(0, 2).join(' · ');

// ── "Show me around": Baba sends you round every table (only when you ask) ──
const TOUR = [
  { id: 'foosball', who: 'Chidi', line: 'Table football! First to five goals. No spinning the rods o!' },
  { id: 'snooker', who: 'Emeka', line: 'Snooker under the canopy. Bring a steady hand and small patience.' },
  { id: 'ludo', who: 'Kemi', line: 'Ludo with me and Tobi! You’ll be red. Come and play, please!' },
  { id: 'whot', who: 'Iya Bisi', line: 'This is the Whot table. Four of us, plenty talk. Pick two dey wait you!' },
  { id: 'draughts', who: 'Tunde', line: 'I’m Tunde the barber. I cut hair, and I cut pieces. Draughts, ten by ten.' },
  { id: 'ayo', who: 'baba', line: 'And this is my table. Ayo, the game of our fathers. Nobody beats Baba easily!' },
];
const tour = { active: false, stop: 0, timer: 0 };
function startTour() {
  $('tables-sheet').hidden = true;
  if (mode === 'playing' || mode === 'tplay' || busy) { toast('Finish or leave this game first.', 2000); return; }
  if (seatedAtAyo() || atTable()) standUp();
  if (walker.seat) return;
  Object.assign(tour, { active: true, stop: 0 });
  $('tour-end').hidden = false;
  showPrompt(null);
  say('Welcome to Ilé Eré! Let me show you round. Just follow the line.', 'baba', 3600);
  tour.timer = setTimeout(tourNext, 2600);
}
function tourNext() {
  if (!tour.active) return;
  const step = TOUR[tour.stop];
  if (!step) {
    endTour();
    say('That’s everybody! Tap ☰ for the tables any time, or just walk up and sit. Enjoy yourself!', 'baba', 5200);
    return;
  }
  const s = stationById(step.id);
  walkTo(s.approach, { sit: false, onArrive: () => {
    if (!tour.active) return;
    // face the table and let its host say hello
    walkCam.wantYaw = s.face + Math.PI;
    walkCam.dragged = 2.5;
    if (step.who !== 'baba') regulars.find((r) => r.name === step.who)?.c.gesture('nod', 1.2);
    say(step.line, step.who, 3800);
    tour.stop++;
    tour.timer = setTimeout(tourNext, 3600);
  } });
}
function endTour() {
  tour.active = false;
  clearTimeout(tour.timer);
  $('tour-end').hidden = true;
  if (walker.onArrive) stopWalking();
  showPrompt(nearStation);
}
$('tour-start').onclick = startTour;
$('tour-end').onclick = () => { endTour(); pathLine.hide(); };

// ── Life on the verandah ──
// Where people look: the pit being sown, the pit you're considering, each other when talking,
// and now and then Baba glances up at you while you think.
const tmpV = new THREE.Vector3();
// (rotY is how far the person is turned; the direction is worked out in their own frame)
function lookToward(person, rotY, target) {
  const h = person.head.getWorldPosition(new THREE.Vector3());
  const wx = target.x - h.x;
  const dy = target.y - h.y;
  const wz = target.z - h.z;
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const dx = wx * c - wz * s;
  const dz = wx * s + wz * c;
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(-dy, Math.hypot(dx, dz)) - person.body.rotation.x };
}
const sowing = { mover: -1, pit: -1 };
let glanceIn = 3;
let glanceFor = 0;
let babaLooksAway = null; // { target, until }
const boardCentre = new THREE.Vector3(0, BOARD_TOP, 0);
const headOf = (person) => person.head.getWorldPosition(new THREE.Vector3());
function looks(dt) {
  const babaTalking = !$('bubble').hidden && $('bubble').dataset.who === 'baba';
  const pitPoint = (i) => pitCenter(i);
  // Baba
  let bt = boardCentre;
  const youClose = mode === 'walk' && Math.hypot(walker.pos.x, walker.pos.z) < 4;
  if (babaLooksAway && time < babaLooksAway.until) bt = babaLooksAway.target;
  else if (youClose && me) bt = headOf(me); // Baba watches you come over
  else if (sowing.pit >= 0) bt = pitPoint(sowing.pit);
  else if (mode === 'over' || mode === 'menu' || babaTalking) bt = me ? headOf(me) : boardCentre;
  else if (mode === 'playing' && game.turn === 0) {
    glanceIn -= dt;
    if (glanceIn <= 0) { glanceFor = 1.2; glanceIn = 3 + Math.random() * 5; }
    glanceFor -= dt;
    const considering = [hovered, selected].find((p) => p >= 0);
    bt = glanceFor > 0 && me ? headOf(me) : considering !== undefined ? pitPoint(considering) : boardCentre;
  }
  // you
  let mt = boardCentre;
  if (sowing.pit >= 0) mt = pitPoint(sowing.pit);
  else if (babaTalking || mode === 'over') mt = headOf(baba);
  else {
    const considering = [hovered, selected, lesson.pit].find((p) => p >= 0);
    if (considering !== undefined) mt = pitPoint(considering);
  }
  // walking about you look ahead, or at whoever is talking to you
  let meLook = null;
  if (me && mode === 'walk' && !$('bubble').hidden) {
    const who = $('bubble').dataset.who;
    const speaker = who === 'baba' ? baba : regulars.find((r) => r.name === who)?.c;
    if (speaker) {
      const l = lookToward(me, playerNode.rotation.y, headOf(speaker));
      if (Math.abs(l.yaw) < 1.4) meLook = l;
    }
  } else if (me && atTable() && activeTable) {
    const speaker = !$('bubble').hidden && regulars.find((r) => r.name === $('bubble').dataset.who)?.c;
    meLook = lookToward(me, playerNode.rotation.y, speaker && mode !== 'tplay' ? headOf(speaker) : activeTable.focus?.() ?? activeTable.view.target);
  } else if (me && mode !== 'walk') {
    meLook = lookToward(me, playerNode.rotation.y, mt);
  }
  return { baba: lookToward(baba, 0, bt), me: meLook };
}

// Chickens potter about the open end of the verandah, stopping to peck.
const coop = { minX: -3.1, maxX: 1.8, minZ: 3.2, maxZ: 9.8 }; // the courtyard's quiet corner
function newSpot(c) {
  c.userData.target.set(
    THREE.MathUtils.randFloat(coop.minX, coop.maxX), 0,
    THREE.MathUtils.randFloat(coop.minZ, coop.maxZ),
  );
}
chickens.forEach(newSpot);
function stepChickens(dt) {
  for (const c of chickens) {
    if (!c.visible) continue;
    const u = c.userData;
    if (u.wait > 0) {
      u.wait -= dt;
      u.peck += dt;
      u.head.rotation.x = Math.max(0, Math.sin(u.peck * 9)) * 0.9; // peck, peck
      if (u.wait <= 0) newSpot(c);
      continue;
    }
    const to = tmpV.subVectors(u.target, c.position);
    const d = to.length();
    if (d < 0.05) {
      u.wait = 1 + Math.random() * 3;
      u.peck = 0;
      if (Math.random() < 0.3) cluck(c.position);
      continue;
    }
    const heading = Math.atan2(to.x, to.z);
    let turn = heading - c.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    c.rotation.y += turn * Math.min(1, dt * 6);
    const speed = 0.32;
    c.position.addScaledVector(to.normalize(), Math.min(d, speed * dt));
    u.head.rotation.x = Math.sin(time * 14) * 0.15; // head bobs as it walks
    u.legs[0].rotation.x = Math.sin(time * 14) * 0.5;
    u.legs[1].rotation.x = -Math.sin(time * 14) * 0.5;
  }
}

// A neighbour greets Baba from the road now and then; okadas go past.
function toast(text, ms = 3500) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}
const GREETING = {
  day: ['A neighbour passing by: “Baba, ẹ kú ọ̀sán o!” (good afternoon)', 'Ẹ kú ọ̀sán o! Ẹ ṣé.'],
  evening: ['A neighbour passing by: “Baba, ẹ kú ìrọ̀lẹ́ o!” (good evening)', 'Ẹ kú ìrọ̀lẹ́ o! Ẹ ṣé.'],
  night: ['A neighbour passing by: “Baba, ẹ kú alẹ́ o!” (good night)', 'Ẹ kú alẹ́ o! Ó dàárọ̀.'],
};
let okadaIn = 18 + Math.random() * 20;
let roosterIn = 30 + Math.random() * 60;
// The regulars play on among themselves: their sounds come from their tables,
// so the joint sounds busy and the nearer tables are louder.
const TABLE_LIFE = {
  draughts: [['piece_place', 0.8], ['piece_place', 0.8], ['piece_slide', 0.7]],
  whot: [['card_slap', 0.9], ['card_slap', 0.9], ['card_draw', 0.7], ['card_shuffle', 0.6]],
  ludo: [['dice_roll', 0.8], ['token_move', 0.8]],
  snooker: [['cue_strike', 0.7], ['ball_hit', 0.8], ['ball_pocket', 0.6]],
  foosball: [['foos_kick', 0.8], ['foos_rattle', 0.6]],
};
let lifeIn = 3;
function tableLife(dt) {
  lifeIn -= dt;
  if (lifeIn > 0) return;
  lifeIn = 1.5 + Math.random() * 3.5;
  const ids = Object.keys(TABLE_LIFE).filter((id) => id !== atStation?.id);
  const id = ids[Math.floor(Math.random() * ids.length)];
  const t = house.tables[id];
  const at = { x: t.center.x, y: (t.top ?? 0.8) + 0.05, z: t.center.z };
  const [name, volume] = TABLE_LIFE[id][Math.floor(Math.random() * TABLE_LIFE[id].length)];
  playSound(name, { pos: at, volume: volume * 0.8 });
}
let neighbourIn = 45 + Math.random() * 45;
function stepStreet(dt) {
  if (mode === 'cover') return;
  okadaIn -= dt;
  if (okadaIn <= 0) { okada(); okadaIn = 25 + Math.random() * 35; }
  roosterIn -= dt;
  if (roosterIn <= 0) { if (timeOfDay === 'day') rooster(); roosterIn = 80 + Math.random() * 120; }
  tableLife(dt);
  neighbourIn -= dt;
  if (neighbourIn <= 0 && !busy && $('bubble').hidden && !lesson.active) {
    neighbourIn = 60 + Math.random() * 60;
    const [line, reply] = GREETING[timeOfDay];
    toast(line);
    babaLooksAway = { target: new THREE.Vector3(5.3, 1.5, 10.5), until: time + 2.2 }; // towards the gate
    setTimeout(() => { baba.gesture('nod', 1.2); say(reply, 'baba', 2400); }, 1100);
  }
}

// ── Loop ──
// On your turn the camera looks at the board; on Baba's turn it eases up to show him too.
const boardTarget = new THREE.Vector3(0, BOARD_TOP + 0.02, -0.04);
const babaTarget = new THREE.Vector3(0, 0.7, -0.3);
const target = new THREE.Vector3().copy(boardTarget);
const menuTarget = new THREE.Vector3(0, 0.75, 0);
let babaFocus = 0;
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const wantPos = new THREE.Vector3();
const wantLook = new THREE.Vector3();
const tmpCam = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
let camReady = false;
let camEase = 0;
let lastCamGroup = 'walk';

// The regulars look at you when you come near, otherwise at their game, and now and then
// nod, laugh or scratch their chin over a move.
function stepRegulars(dt) {
  const youNear = (r) => mode === 'walk' && Math.hypot(walker.pos.x - r.pos.x, walker.pos.z - r.pos.z) < 3.2;
  for (const r of regulars) {
    const table = stationById(r.station);
    const playingHere = atTable() && atStation?.id === r.station && activeTable;
    let target = youNear(r) && me ? headOf(me) : tmpV.copy(table.centre).setY(0.7);
    if (playingHere) target = r.lookAt ?? activeTable.focus?.() ?? activeTable.view.target;
    r.gestureIn -= dt;
    if (r.gestureIn <= 0 && !(playingHere && mode === 'tplay')) {
      r.c.gesture(pickLine(r.standing ? ['nod', 'chin', 'laugh'] : ['nod', 'chin', 'laugh', 'chin']), 1.4 + Math.random());
      r.gestureIn = 5 + Math.random() * 10;
    }
    r.c.animate(dt, { ...(r.pose ?? {}), time: time + r.pos.x, seated: !r.standing, look: lookToward(r.c, r.c.root.rotation.y, target), talking: talkingNow(r.name) });
  }
}
const clock = new THREE.Clock();
let time = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  stepTweens(dt);
  followHand(dt);
  // the menu slowly circles from your back to your face, framing both players
  // you: walking about, sitting down, or seated at the Ayo table
  if (mode === 'walk') {
    if (walker.seat) stepSitting(dt);
    else stepWalker(dt);
    stepMinimap(dt);
    playerNode.position.copy(walker.pos);
    playerNode.rotation.y = walker.heading;
  } else if (atTable() && atStation) {
    playerNode.position.copy(atStation.seat);
    playerNode.rotation.y = atStation.face;
  } else {
    playerNode.position.set(0, 0, SEAT_Z);
    playerNode.rotation.y = Math.PI;
  }
  if (activeTable && mode === 'tplay') activeTable.update(dt, time);
  pathLine.update(dt, walker.pos, mode === 'walk' && walker.target ? [walker.target, ...walker.path] : null);
  signs.visible = mode === 'walk';

  const tall = Math.max(0, 1 / camera.aspect - 1);
  if (mode === 'walk') {
    // follow behind you, kept inside the walls and under the verandah roof
    const head = tmpCam.set(walker.pos.x, 1.35, walker.pos.z);
    // pull the camera in along its line rather than letting a wall squash it overhead
    const dir = tmpDir.set(
      Math.sin(walkCam.yaw) * Math.cos(walkCam.pitch),
      Math.sin(walkCam.pitch),
      Math.cos(walkCam.yaw) * Math.cos(walkCam.pitch),
    );
    let d = walkCam.dist * (1 + tall * 0.25);
    const room = (v, lo, hi, dv) => (dv > 0 ? (hi - v) / dv : dv < 0 ? (lo - v) / dv : Infinity);
    d = Math.min(d,
      room(head.x, VERANDAH.minX + 0.3, VERANDAH.maxX - 0.3, dir.x),
      room(head.z, VERANDAH.back + 0.3, YARD.front - 0.3, dir.z));
    wantPos.copy(head).addScaledVector(dir, Math.max(0.6, d));
    if (wantPos.z < VERANDAH.front + 0.3) wantPos.y = Math.min(wantPos.y, 2.85); // under the roof
    wantLook.copy(head);
  } else if (atTable() && activeTable) {
    // at one of the other tables: its own view, which you can turn by dragging
    const look = activeTable.view.target;
    const d = dist * (1 + tall * (activeTable.view.maxPitch ? 0.1 : 0.3));
    wantPos.set(
      look.x + Math.sin(yaw) * Math.cos(pitch) * d,
      look.y + Math.sin(pitch) * d,
      look.z + Math.cos(yaw) * Math.cos(pitch) * d,
    );
    wantLook.copy(look);
  } else {
    // the menu slowly circles from your back to your face, framing both players
    const menu = mode === 'menu' && !cover;
    // on tall screens the camera stands further back, so keep its orbit clear of the house walls
    if (menu) yaw = tall > 0 ? 1.0 + Math.sin(time * 0.15) * 0.75 : 1.25 + Math.sin(time * 0.15) * 1.05;
    const wantFocus = mode === 'over' || (mode === 'playing' && game.turn === 1) ? 1 : 0;
    babaFocus += (wantFocus - babaFocus) * Math.min(1, dt * 2.2);
    target.lerpVectors(boardTarget, babaTarget, babaFocus);
    const look = menu ? menuTarget : target;
    // tall phone screens see less from side to side, so step back
    const d = (menu ? 3.1 * (1 + tall * 0.33) : (dist + 0.25 * babaFocus) * (1 + tall * 0.16));
    const p = menu ? 0.3 : pitch - 0.32 * babaFocus;
    wantPos.set(
      look.x + Math.sin(yaw) * Math.cos(p) * d,
      look.y + Math.sin(p) * d,
      look.z + Math.cos(yaw) * Math.cos(p) * d,
    );
    wantLook.copy(look);
  }
  // glide between the walking view and the table view; otherwise follow closely
  const camGroup = mode === 'walk' ? 'walk' : atTable() ? `table-${atStation?.id}` : 'ayo';
  if (camGroup !== lastCamGroup) { camEase = 1.4; lastCamGroup = camGroup; }
  camEase -= dt;
  const ck = camEase > 0 ? 1 - Math.exp(-dt * 3.2) : mode === 'walk' ? 1 - Math.exp(-dt * 12) : atTable() ? 1 - Math.exp(-dt * 8) : 1;
  if (!camReady || mode === 'cover') { camPos.copy(wantPos); camLook.copy(wantLook); camReady = true; }
  camPos.lerp(wantPos, ck);
  camLook.lerp(wantLook, ck);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  camera.updateMatrixWorld();
  setListener(camera);
  // hide a lantern when the camera is right up against it
  for (const o of house.occluders) o.visible = o.position.distanceTo(camPos) > 0.8;
  // while you play at a table, don't let your own character block the view of the game
  if (me) {
    let blocking = false;
    if (mode === 'tplay' && activeTable) {
      const head = headOf(me);
      const focus = activeTable.focus?.() ?? activeTable.view.target;
      const seg = tmpDir.subVectors(focus, camPos);
      const t = THREE.MathUtils.clamp(tmpCam.subVectors(head, camPos).dot(seg) / seg.lengthSq(), 0, 1);
      const nearest = camPos.clone().addScaledVector(seg, t);
      blocking = head.distanceTo(nearest) < 0.45 || head.distanceTo(camPos) < 0.9;
    }
    me.root.visible = !blocking;
  }
  // full detail (fingers, eyes) only for people near the camera
  for (const person of [me, baba, ...regulars.map((r) => r.c)]) {
    if (person) person.setDetail(person.root.getWorldPosition(tmpV).distanceTo(camPos) < 4.5);
  }
  followSun(mode === 'walk' ? walker.pos : camLook);

  const gaze = looks(dt);
  if (me) {
    me.animate(dt, {
      ...pose.me, time, leanIn: mode === 'cover' ? 1 : 0.35, look: gaze.me,
      seated: atTable()
        ? !atStation?.standing
        : mode !== 'walk' || (walker.seat && walker.seat.t > 0.45 && !walker.seat.station.standing),
      walk: mode === 'walk' ? walker.speed : 0,
      talking: talkingNow('you'),
    });
  }
  baba.animate(dt, { ...pose.baba, time: time + 1.3, look: gaze.baba, talking: talkingNow('baba') });
  stepRegulars(dt);
  stepChickens(dt);
  stepStreet(dt);

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
  t.innerHTML = '<h1>Ilé <span>Eré</span></h1><p>House of Play</p><small>Walk in. Pick a table. Play.</small>';
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
  // a wide view from the courtyard: the verandah and its tables, with you at Ayo against Baba
  // (?cover=x,y,z,yaw,pitch,dist to try another framing)
  const [cx, cy, cz, cyaw, cpitch, cdist] = (params.get('cover') || '3.6,1.0,0,-0.55,0.24,9').split(',').map(Number);
  boardTarget.set(cx, cy, cz);
  yaw = cyaw;
  pitch = cpitch;
  dist = cdist;
  pose.me.reach = 1;
  pose.me.reachToX = 0.05;
  mode = 'cover';
}

// Build every shader behind the loading screen (in parallel where the browser allows), so the
// first frame doesn't freeze the page.
// (with a time limit, so a slow or failed compile can never leave the loading screen up)
await Promise.race([renderer.compileAsync(scene, camera).catch(() => {}), new Promise((r) => setTimeout(r, 10000))]);
$('loading').hidden = true;
markReady();
preload();
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
    baba,
    get me() { return me; },
    renderer,
    walker,
    walkCam,
    walkTo: (x, z) => walkTo(new THREE.Vector3(x, 0, z)),
    stations: house.stations,
    sit: () => { walker.pos.copy(stationById('ayo').seat); walker.seat = null; setMode('menu'); },
    standUp,
    regulars,
    get activeTable() { return activeTable; },
    audioStats,
    say,
    toggleRadio,
    tableGames,
    // the active table's focus point on screen, for tests
    activeFocus: () => {
      const f = activeTable?.focus?.();
      if (!f) return null;
      f.project(camera);
      return { x: (f.x * 0.5 + 0.5) * innerWidth, y: (-f.y * 0.5 + 0.5) * innerHeight };
    },
    screenOf: (i) => {
      const v = pitCenter(i).project(camera);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
    },
  };
}
