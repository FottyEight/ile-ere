// Ludo with Kemi and Tobi. Rules and their play are in ludo.js; this draws the board, tokens
// and die, rolls, and moves the tokens square by square.
//
// The board is the usual 15×15 cross. Cells are (u, v) = (column, row) on the printed board,
// then the whole board is turned a quarter so your red corner sits nearest you.
import * as THREE from 'three';
import * as L from './ludo.js';

const COLOUR_HEX = ['#d63031', '#00a65a', '#f5b700', '#1e6fd9'];
const PLAYERS = ['You', 'Kemi', 'Tobi'];
const BASE_ORIGIN = [[0, 0], [9, 0], [9, 9], [0, 9]]; // [u, v] of each colour's 6×6 corner

// the 52 track squares, clockwise from red's start square, as [u, v] cell centres
const TRACK = (() => {
  const t = [];
  const run = (cells) => cells.forEach(([c, r]) => t.push([c + 0.5, r + 0.5]));
  run([1, 2, 3, 4, 5].map((c) => [c, 6]));
  run([5, 4, 3, 2, 1, 0].map((r) => [6, r]));
  run([[7, 0]]);
  run([0, 1, 2, 3, 4, 5].map((r) => [8, r]));
  run([9, 10, 11, 12, 13, 14].map((c) => [c, 6]));
  run([[14, 7]]);
  run([14, 13, 12, 11, 10, 9].map((c) => [c, 8]));
  run([9, 10, 11, 12, 13, 14].map((r) => [8, r]));
  run([[7, 14]]);
  run([14, 13, 12, 11, 10, 9].map((r) => [6, r]));
  run([5, 4, 3, 2, 1, 0].map((c) => [c, 8]));
  run([[0, 7]]);
  run([[0, 6]]);
  return t;
})();
// each colour's 5 home-column squares, from the entrance inwards
const HOME = [
  [1, 2, 3, 4, 5].map((c) => [c + 0.5, 7.5]),
  [1, 2, 3, 4, 5].map((r) => [7.5, r + 0.5]),
  [13, 12, 11, 10, 9].map((c) => [c + 0.5, 7.5]),
  [13, 12, 11, 10, 9].map((r) => [7.5, r + 0.5]),
];
const FINISH = [[6.6, 7.5], [7.5, 6.6], [8.4, 7.5], [7.5, 8.4]];

function boardTexture() {
  const W = 900;
  const s = W / 15;
  const cv = document.createElement('canvas');
  cv.width = cv.height = W;
  const g = cv.getContext('2d');
  // turn the printed board a quarter, so red's corner ends up nearest you
  g.setTransform(0, -1, 1, 0, 0, W);
  g.fillStyle = '#fbf6ec';
  g.fillRect(0, 0, W, W);
  BASE_ORIGIN.forEach(([u, v], k) => {
    g.fillStyle = COLOUR_HEX[k];
    g.fillRect(u * s, v * s, 6 * s, 6 * s);
    g.fillStyle = '#fbf6ec';
    g.fillRect((u + 1) * s, (v + 1) * s, 4 * s, 4 * s);
    g.fillStyle = COLOUR_HEX[k];
    for (const [ox, oy] of [[2, 2], [4, 2], [2, 4], [4, 4]]) {
      g.beginPath();
      g.arc((u + ox) * s, (v + oy) * s, s * 0.6, 0, Math.PI * 2);
      g.fill();
    }
  });
  // track squares, start squares in their colour, stars on the safe squares
  g.strokeStyle = '#3a3a3a';
  g.lineWidth = 2;
  TRACK.forEach(([u, v], i) => {
    const x = (u - 0.5) * s;
    const y = (v - 0.5) * s;
    const start = i % 13 === 0 ? i / 13 : -1;
    if (start >= 0) { g.fillStyle = COLOUR_HEX[start]; g.fillRect(x, y, s, s); }
    g.strokeRect(x, y, s, s);
    if (L.STARS.includes(i)) {
      g.fillStyle = '#9a9a9a';
      g.font = `${s * 0.7}px Arial`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('★', u * s, v * s + 2);
    }
  });
  HOME.forEach((cells, k) => cells.forEach(([u, v]) => {
    g.fillStyle = COLOUR_HEX[k];
    g.fillRect((u - 0.5) * s, (v - 0.5) * s, s, s);
    g.strokeRect((u - 0.5) * s, (v - 0.5) * s, s, s);
  }));
  // the centre triangles
  const c = 7.5 * s;
  [[Math.PI], [-Math.PI / 2], [0], [Math.PI / 2]].forEach(([a], k) => {
    g.fillStyle = COLOUR_HEX[k];
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(c + Math.cos(a - Math.PI / 4) * 1.5 * s * Math.SQRT2, c + Math.sin(a - Math.PI / 4) * 1.5 * s * Math.SQRT2);
    g.lineTo(c + Math.cos(a + Math.PI / 4) * 1.5 * s * Math.SQRT2, c + Math.sin(a + Math.PI / 4) * 1.5 * s * Math.SQRT2);
    g.fill();
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function pipTexture(n) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#fbf6ec';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = n === 1 ? '#c8231c' : '#1d1d1d';
  const P = { 1: [[32, 32]], 2: [[18, 18], [46, 46]], 3: [[16, 16], [32, 32], [48, 48]], 4: [[18, 18], [46, 18], [18, 46], [46, 46]], 5: [[16, 16], [48, 16], [32, 32], [16, 48], [48, 48]], 6: [[18, 14], [46, 14], [18, 32], [46, 32], [18, 50], [46, 50]] };
  for (const [x, y] of P[n]) { g.beginPath(); g.arc(x, y, n === 1 ? 9 : 6, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createLudoTable(ctx) {
  const { scene, info } = ctx;
  const c = info.center;
  const size = info.size;
  const s = size / 15;
  const Y = info.top + 0.002;
  const kid = (colour) => ctx.regular(PLAYERS[colour]);

  // printed board (u, v) → world, after the quarter turn
  const at = ([u, v], y = Y) => new THREE.Vector3(c.x - size / 2 + v * s, y, c.z - size / 2 + (15 - u) * s);

  const board = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.6 }));
  board.position.set(c.x, info.top + 0.0008, c.z);
  board.receiveShadow = true;
  scene.add(board);

  // ── Tokens: little pawns ──
  const tokenMats = COLOUR_HEX.map((col) => new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.3, clearcoat: 0.6 }));
  const pawn = (mat) => {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.32, s * 0.38, s * 0.18, 16), mat);
    base.position.y = s * 0.09;
    const body = new THREE.Mesh(new THREE.ConeGeometry(s * 0.26, s * 0.55, 16), mat);
    body.position.y = s * 0.42;
    const head = new THREE.Mesh(new THREE.SphereGeometry(s * 0.17, 14, 10), mat);
    head.position.y = s * 0.74;
    for (const m of [base, body, head]) { m.castShadow = true; g.add(m); }
    scene.add(g);
    return g;
  };
  const tokens = {}; // colour → [4 pawn groups]
  for (const col of [0, 1, 2]) tokens[col] = [0, 1, 2, 3].map(() => pawn(tokenMats[col]));
  const ringGeo = new THREE.RingGeometry(s * 0.42, s * 0.52, 24).rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0.9, depthWrite: false });
  const rings = [0, 1, 2, 3].map(() => {
    const r = new THREE.Mesh(ringGeo, ringMat);
    r.visible = false;
    scene.add(r);
    return r;
  });

  // ── The die ──
  const faces = [2, 5, 1, 6, 3, 4].map((n) => new THREE.MeshStandardMaterial({ map: pipTexture(n), roughness: 0.4 }));
  const die = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, 0.024), faces);
  die.castShadow = true;
  scene.add(die);
  const DIE_UP = { 1: [0, 0, 0], 6: [Math.PI, 0, 0], 2: [0, 0, Math.PI / 2], 5: [0, 0, -Math.PI / 2], 3: [-Math.PI / 2, 0, 0], 4: [Math.PI / 2, 0, 0] };
  const dieRest = new THREE.Vector3(c.x + size / 2 + 0.06, info.top + 0.0115, c.z + 0.08);
  die.position.copy(dieRest);
  let tumble = 0;

  // where a token sits for a given progress (several tokens on one square spread out a little)
  function spotOf(colour, progress, index) {
    const loc = L.locate(colour, progress, index);
    if (loc.kind === 'base') {
      const [u0, v0] = BASE_ORIGIN[colour];
      const [ox, oy] = [[2, 2], [4, 2], [2, 4], [4, 4]][loc.slot ?? index];
      return at([u0 + ox, v0 + oy]);
    }
    if (loc.kind === 'track') return at(TRACK[loc.index]);
    if (loc.kind === 'home') return at(HOME[colour][loc.step]);
    const [u, v] = FINISH[colour];
    return at([u + ((index % 2) - 0.5) * 0.4, v + (Math.floor(index / 2) - 0.5) * 0.4]);
  }
  function layout(state, instant = true) {
    // count how many tokens share each square, to fan them out
    const seen = new Map();
    const jobs = [];
    for (const col of state.colours) {
      state.tokens[col].forEach((p, i) => {
        const pos = spotOf(col, p, i);
        const key = `${pos.x.toFixed(3)},${pos.z.toFixed(3)}`;
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        if (n && p >= 0 && p < 56) pos.add(new THREE.Vector3((n % 2 ? 1 : -1) * s * 0.22, 0, (n > 1 ? 1 : -1) * s * 0.18));
        const t = tokens[col][i];
        if (instant) t.position.copy(pos);
        else if (t.position.distanceTo(pos) > 0.001) jobs.push(ctx.fly(t, pos, 0.25, 0.02));
      });
    }
    return Promise.all(jobs);
  }

  let state = L.newGame({ colours: [0, 1, 2] });
  let level = 1;
  let playing = false;
  let busy = false;
  let focusPoint = c.clone();
  layout(state);

  function hud() {
    ctx.score(state.colours.map((col) => ({
      name: PLAYERS[col],
      value: `${state.tokens[col].filter((p) => p === 56).length}/4`,
      active: state.turn === col && !state.over,
    })));
  }
  function clearRings() { for (const r of rings) r.visible = false; }

  async function rollDie(colour, forced) {
    ctx.sfx.pickup();
    tumble = 0.6 / Math.min(ctx.speed, 3);
    const r = kid(colour);
    if (r) r.pose = { reach: 1, reachToX: 0 };
    if (colour === 0) ctx.pose.me.reach = 1;
    await ctx.wait(600);
    if (r) r.pose = { reach: 0 };
    ctx.pose.me.reach = 0;
    const result = L.roll(state, Math.random, forced);
    state = result.state;
    const v = result.events.find((e) => e.type === 'roll').value;
    tumble = 0;
    die.rotation.set(...DIE_UP[v]);
    ctx.sfx.clack();
    focusPoint = die.position.clone();
    return { v, events: result.events };
  }

  async function doMove(choice) {
    const result = L.move(state, choice);
    for (const e of result.events) {
      if (e.type === 'move') {
        const t = tokens[e.colour][e.token];
        // hop square by square along the path
        for (const p of e.path) {
          const pos = spotOf(e.colour, p, e.token);
          focusPoint = pos.clone();
          await ctx.fly(t, pos, 0.16, 0.025);
          ctx.sfx.clack();
        }
      }
      if (e.type === 'capture') {
        ctx.sfx.capture();
        ctx.teach('capture');
        const victim = kid(e.colour);
        const by = kid(e.by);
        if (e.colour === 0) { by?.c.gesture('laugh', 1.6); ctx.say(ctx.pickLine(['Go back home! Haha!', 'I don chop you!', 'Sorry o! (I’m not sorry)']), PLAYERS[e.by], 2200); }
        else if (e.by === 0) { victim?.c.gesture('shake', 1.4); ctx.say(ctx.pickLine(['Ahhh! Why me?', 'You chop me!', 'No fair o!']), PLAYERS[e.colour], 2200); }
        else { by?.c.gesture('laugh', 1.4); victim?.c.gesture('shake', 1.2); }
      }
      if (e.type === 'finish' && e.colour !== 0) kid(e.colour)?.c.gesture('nod', 1.2);
    }
    // where your tokens ended up: a safe square or your home column is worth explaining
    if (choice !== undefined && state.turn === 0) {
      const mine = result.state.tokens[0];
      if (mine.some((p) => p >= 51 && p < 56)) ctx.teach('homeColumn');
      else if (mine.some((p) => p >= 0 && p <= 50 && L.isSafe(L.trackIndex(0, p)))) ctx.teach('safe');
    }
    state = result.state;
    await layout(state, false);
    hud();
    const win = result.events.find((e) => e.type === 'win');
    if (win) return gameOver(win.colour);
    next();
  }

  function gameOver(winner) {
    playing = false;
    clearRings();
    ctx.actions([]);
    ctx.hint('');
    const won = winner === 0;
    for (const col of [1, 2]) kid(col)?.c.gesture(col === winner ? 'laugh' : won ? 'clap' : 'nod', 2.2);
    ctx.say(won ? 'You won! Again, again!' : `${PLAYERS[winner]} wins! Yay!`, won ? 'Kemi' : PLAYERS[winner], 2600);
    setTimeout(() => ctx.finish({
      outcome: won ? 'win' : 'loss',
      title: won ? 'You won at Ludo!' : `${PLAYERS[winner]} wins this one`,
      detail: `Your tokens home: ${state.tokens[0].filter((p) => p === 56).length} of 4`,
    }), 1300);
  }

  async function next() {
    hud();
    clearRings();
    if (state.over) return;
    const col = state.turn;
    if (col === 0) {
      if (state.phase === 'roll') {
        ctx.turn(state.sixes ? 'You rolled a 6: roll again!' : 'Your turn: roll the die');
        ctx.hint('Tap Roll, or press Space');
        ctx.actions([{ label: 'Roll', onClick: () => yourRoll() }]);
      }
      return;
    }
    // Kemi or Tobi
    ctx.actions([]);
    ctx.turn(`${PLAYERS[col]}’s turn`);
    ctx.hint('');
    busy = true;
    await ctx.wait(500);
    const { v, events } = await rollDie(col);
    if (state.phase === 'move') {
      await ctx.wait(450);
      const choice = L.chooseMove(state, level);
      busy = false;
      await doMove(choice);
    } else {
      if (events.some((e) => e.type === 'forfeit')) ctx.say('Three sixes! Ah, I lost it.', PLAYERS[col], 1800);
      else if (v !== 6) ctx.turn(`${PLAYERS[col]} rolled ${v}: no move`);
      await ctx.wait(700);
      busy = false;
      next();
    }
  }

  async function yourRoll() {
    if (busy || state.turn !== 0 || state.phase !== 'roll' || !playing) return;
    busy = true;
    ctx.actions([]);
    const { v, events } = await rollDie(0);
    busy = false;
    if (state.phase !== 'move') {
      if (v !== 6 && state.tokens[0].every((p) => p < 0 || p === 56)) ctx.teach('needSix');
      ctx.turn(events.some((e) => e.type === 'forfeit') ? 'Three sixes in a row: your turn is lost' : `You rolled ${v}: no move`);
      await ctx.wait(1100);
      next();
      return;
    }
    const moves = L.legalMoves(state);
    if (v === 6) ctx.teach('rolledSix');
    if (moves.length === 1) { ctx.turn(`You rolled ${v}`); await ctx.wait(350); return yourPick(moves[0].token); }
    ctx.teach('pickToken');
    ctx.turn(`You rolled ${v}: pick a token to move`);
    ctx.hint('Tap one of your glowing tokens');
    moves.forEach((m, i) => {
      const r = rings[i];
      r.position.copy(tokens[0][m.token].position).setY(Y + 0.001);
      r.userData.token = m.token;
      r.visible = true;
    });
  }
  async function yourPick(token) {
    if (busy || state.phase !== 'move' || state.turn !== 0) return;
    busy = true;
    clearRings();
    ctx.pose.me.reach = 1;
    await doMove(token);
    ctx.pose.me.reach = 0;
    busy = false;
  }

  const pickables = () => tokens[0].flatMap((g) => g.children);
  return {
    id: 'ludo',
    title: 'Ludo',
    lead: 'Kemi and Tobi have been waiting for a third player. You’re red; get all four of your tokens home before they do.',
    levelLabel: 'How clever are the kids?',
    rules: [
      'Roll a <b>6</b> to bring a token out. A 6 also gives you another roll, but <b>three 6s in a row</b> loses your turn.',
      'Move a token by the number on the die. Land on a single enemy token to send it home (and roll again).',
      'Stars and coloured start squares are safe. Two tokens of one colour together form a <b>block</b> nobody can pass or land on, even on a start square.',
      'Go round the board and up your coloured column; you need the exact number to finish. Getting a token home earns another roll. First with all four home wins.',
    ],
    greetings: ['Yay, you came! Sit there, you’re red.', 'Play with us! Please!', 'Ludo! I’m going to win!'],
    view: { target: new THREE.Vector3(c.x, info.top + 0.02, c.z + 0.05), yaw: 0, pitch: 1.05, dist: 1.15 },
    focus: () => focusPoint.clone(),

    idle() {
      if (playing) return;
      state = L.newGame({ colours: [0, 1, 2] });
      layout(state);
      clearRings();
    },
    start(lv) {
      level = lv;
      state = L.newGame({ colours: [0, 1, 2] });
      playing = true;
      busy = false;
      layout(state);
      ctx.say('You start! Roll the die.', 'Kemi', 2000);
      next();
    },
    update(dt) {
      if (tumble > 0) {
        die.rotation.x += dt * 17;
        die.rotation.y += dt * 11;
        die.rotation.z += dt * 13;
        die.position.y = dieRest.y + Math.abs(Math.sin(performance.now() / 70)) * 0.03;
      } else {
        die.position.y = dieRest.y;
      }
      for (const r of rings) if (r.visible) r.material.opacity = 0.6 + Math.sin(performance.now() / 160) * 0.3;
    },
    stop() {
      playing = false;
      busy = false;
      this.idle();
    },

    testMove() {
      if (playing && !busy && state.turn === 0) {
        if (state.phase === 'roll') yourRoll();
        else if (state.phase === 'move') yourPick(L.chooseMove(state, 1));
      }
      return { turn: state.turn, phase: state.phase, over: state.over, home: state.colours.map((col) => state.tokens[col].filter((p) => p === 56).length) };
    },
    pointerDown() { return false; },
    pointerUp(e, ray, { tap }) {
      if (!tap || busy || !playing || state.turn !== 0) return;
      if (state.phase === 'roll') {
        if (ray.intersectObject(die).length) yourRoll();
        return;
      }
      const moves = L.legalMoves(state);
      const hitRing = ray.intersectObjects(rings.filter((r) => r.visible))[0];
      const hitPawn = ray.intersectObjects(pickables())[0];
      let token = hitRing?.object.userData.token;
      if (token === undefined && hitPawn) token = tokens[0].findIndex((g) => g.children.includes(hitPawn.object));
      if (token !== undefined && token >= 0 && moves.some((m) => m.token === token)) yourPick(token);
    },
    keyDown(e, k) {
      if (k === ' ') { e.preventDefault(); if (state.phase === 'roll') yourRoll(); }
    },
  };
}
