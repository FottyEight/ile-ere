// Draughts with Tunde the barber: the 10×10 board on the verandah. Rules and Tunde's play are
// in draughts.js; this draws the pieces, lets you pick and move them, and animates his moves.
import * as THREE from 'three';
import * as D from './draughts.js';
import { think } from './think.js';

export function createDraughtsTable(ctx) {
  const { scene, info } = ctx;
  const c = info.center;
  const N = D.SIZE;
  const sq = info.size / N;
  const tunde = () => ctx.regular('Tunde');

  // square index ↔ position on the table. Row 0 is Tunde's side (−z), you sit at +z.
  const posOf = (i, y = info.top) => new THREE.Vector3(
    c.x - info.size / 2 + ((i % N) + 0.5) * sq,
    y,
    c.z - info.size / 2 + (Math.floor(i / N) + 0.5) * sq,
  );
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -info.top);
  const hit = new THREE.Vector3();
  function squareAt(ray) {
    if (!ray.ray.intersectPlane(plane, hit)) return -1;
    const col = Math.floor((hit.x - (c.x - info.size / 2)) / sq);
    const row = Math.floor((hit.z - (c.z - info.size / 2)) / sq);
    if (col < 0 || col >= N || row < 0 || row >= N) return -1;
    return row * N + col;
  }

  // ── Pieces: a disc for a man, two stacked for a king ──
  const discGeo = new THREE.CylinderGeometry(sq * 0.4, sq * 0.42, sq * 0.2, 24);
  const ringGeo = new THREE.TorusGeometry(sq * 0.3, sq * 0.03, 6, 24).rotateX(Math.PI / 2);
  const mats = [
    new THREE.MeshPhysicalMaterial({ color: '#f1ead9', roughness: 0.35, clearcoat: 0.5 }),
    new THREE.MeshPhysicalMaterial({ color: '#221a16', roughness: 0.35, clearcoat: 0.5 }),
  ];
  const ringMats = [new THREE.MeshStandardMaterial({ color: '#c9b892' }), new THREE.MeshStandardMaterial({ color: '#4a3a30' })];
  const pieces = new Map(); // square → mesh group
  function makePiece(side, king) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(discGeo, mats[side]);
    base.position.y = sq * 0.1;
    base.castShadow = true;
    const ring = new THREE.Mesh(ringGeo, ringMats[side]);
    ring.position.y = sq * 0.205;
    g.add(base, ring);
    if (king) addCrown(g, side);
    scene.add(g);
    return g;
  }
  function addCrown(g, side) {
    if (g.userData.king) return;
    const top = new THREE.Mesh(discGeo, mats[side]);
    top.position.y = sq * 0.3;
    top.castShadow = true;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: '#e8b84a', metalness: 0.7, roughness: 0.3 }));
    ring.position.y = sq * 0.405;
    g.add(top, ring);
    g.userData.king = true;
  }
  function layout(state) {
    for (const p of pieces.values()) scene.remove(p);
    pieces.clear();
    state.board.forEach((piece, i) => {
      if (!piece) return;
      const g = makePiece(D.owner(piece), D.isKing(piece));
      g.position.copy(posOf(i));
      pieces.set(i, g);
    });
  }

  // ── Highlights: your selected piece, where it can go, compulsory captures ──
  const hlGeo = new THREE.PlaneGeometry(sq * 0.92, sq * 0.92).rotateX(-Math.PI / 2);
  const hlMats = {
    select: new THREE.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0.55, depthWrite: false }),
    move: new THREE.MeshBasicMaterial({ color: '#7fc8ff', transparent: true, opacity: 0.5, depthWrite: false }),
    capture: new THREE.MeshBasicMaterial({ color: '#ff7a59', transparent: true, opacity: 0.55, depthWrite: false }),
    last: new THREE.MeshBasicMaterial({ color: '#d8fd71', transparent: true, opacity: 0.3, depthWrite: false }),
  };
  const highlights = [];
  function clearHighlights() {
    for (const h of highlights) scene.remove(h);
    highlights.length = 0;
  }
  function highlight(i, kind) {
    const m = new THREE.Mesh(hlGeo, hlMats[kind]);
    m.position.copy(posOf(i, info.top + 0.002));
    m.renderOrder = 2;
    scene.add(m);
    highlights.push(m);
  }

  let state = D.newGame();
  let level = 1;
  let busy = false;
  let selected = -1;
  let lastMove = null;
  let playing = false;
  let focusPoint = posOf(45);
  layout(state);

  const count = (side) => state.board.filter((p) => p && D.owner(p) === side).length;
  function hud() {
    ctx.score([
      { name: 'You', value: count(0), active: state.turn === 0 && !state.over },
      { name: 'Tunde', value: count(1), active: state.turn === 1 && !state.over },
    ]);
  }

  function showYourMoves() {
    clearHighlights();
    if (lastMove) for (const i of [lastMove.from, lastMove.to]) highlight(i, 'last');
    const moves = D.legalMoves(state);
    const capturing = moves.some((m) => m.captures.length);
    if (capturing) ctx.teach('mustCapture');
    if (selected >= 0) {
      highlight(selected, 'select');
      for (const m of moves.filter((m) => m.from === selected)) highlight(m.to, m.captures.length ? 'capture' : 'move');
    } else if (capturing) {
      // show which pieces must capture
      for (const from of new Set(moves.map((m) => m.from))) highlight(from, 'capture');
    }
    ctx.hint(capturing
      ? `You must capture${moves[0].captures.length > 1 ? ` ${moves[0].captures.length} pieces` : ''}: pick a glowing piece`
      : selected >= 0 ? 'Now tap where to move it' : 'Tap one of your pieces, then where to move it');
  }

  // slides a piece along its path, hopping over captures, then removes the captured pieces
  async function animate(move, side) {
    const g = pieces.get(move.from);
    pieces.delete(move.from);
    for (const to of move.path) {
      const dest = posOf(to);
      const jump = move.captures.length > 0;
      await ctx.fly(g, dest, jump ? 0.34 : 0.28, jump ? 0.05 : 0.02);
      ctx.sfx.play('piece_place');
      focusPoint = dest;
    }
    pieces.set(move.to, g);
    // the jumped pieces go to the side of the board, by the capturer
    let k = 0;
    for (const cap of move.captures) {
      const p = pieces.get(cap);
      pieces.delete(cap);
      if (!p) continue;
      const pile = new THREE.Vector3(c.x + info.size / 2 + 0.05 + (k % 2) * sq * 0.9, info.top - 0.03, c.z + (side === 0 ? 0.12 : -0.12) - Math.floor(k / 2) * sq * 0.3);
      ctx.fly(p, pile, 0.4, 0.06).then(() => scene.remove(p));
      k++;
    }
    if (move.crowned) addCrown(g, side);
    if (move.captures.length) ctx.sfx.play('piece_slide', { volume: 1.1 });
  }

  async function yourMove(move) {
    busy = true;
    selected = -1;
    clearHighlights();
    ctx.pose.me.reach = 1;
    ctx.pose.me.reachToX = -(posOf(move.from).x - ctx.station.seat.x);
    await animate(move, 0);
    ctx.pose.me.reach = 0;
    state = D.play(state, move);
    lastMove = move;
    ctx.teach(move.captures.length ? 'firstCapture' : 'firstMove');
    if (move.crowned) ctx.teach('king');
    if (move.captures.length >= 2) {
      tunde()?.c.gesture('surprise', 1.6);
      ctx.say(ctx.pickLine([`Ehn! ${move.captures.length} at once?`, 'Who taught you that one?', 'Haba! Slow down.']), 'Tunde', 2400);
    } else if (move.captures.length) {
      tunde()?.c.gesture('shake', 1.2);
    }
    if (move.crowned) ctx.say('King! Okay, I see you.', 'Tunde', 2000);
    hud();
    busy = false;
    next();
  }

  async function tundeMove() {
    busy = true;
    ctx.turn('Tunde is thinking…');
    ctx.hint('');
    const t0 = performance.now();
    const move = await think('./draughts.js', D, 'chooseMove', [state, level]);
    const wait = Math.max(0, 650 / ctx.speed - (performance.now() - t0));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const r = tunde();
    if (r) r.pose = { reach: 1, reachToX: posOf(move.from).x - r.pos.x };
    ctx.turn('Tunde moves');
    await animate(move, 1);
    if (r) r.pose = { reach: 0 };
    // play() re-checks the move: it must be one of the legal ones for this state
    state = D.play(state, D.legalMoves(state).find((m) => m.from === move.from && m.to === move.to && m.path.join() === move.path.join()) ?? move);
    lastMove = move;
    if (move.captures.length >= 2) {
      r?.c.gesture('laugh', 1.8);
      ctx.say(ctx.pickLine([`${move.captures.length} for me! Haha!`, 'Barber cut am clean!', 'You no see am coming?']), 'Tunde', 2400);
    } else if (move.crowned) {
      ctx.say('My king don land!', 'Tunde', 2000);
    }
    if (move.crowned) ctx.teach('king');
    hud();
    busy = false;
    next();
  }

  function next() {
    if (state.over) {
      playing = false;
      clearHighlights();
      const won = state.winner === 0;
      const draw = state.result === 'draw';
      tunde()?.c.gesture(won ? 'clap' : draw ? 'nod' : 'laugh', 2.4);
      ctx.say(won ? 'You beat me! Come back for another cut.' : draw ? 'Draw. We dey equal today.' : 'Barber don win! Haha.', 'Tunde', 3000);
      setTimeout(() => ctx.finish({
        outcome: draw ? 'draw' : won ? 'win' : 'loss',
        title: draw ? 'It’s a draw' : won ? 'You beat Tunde!' : 'Tunde wins this one',
        detail: `Pieces left: you ${count(0)}, Tunde ${count(1)}`,
      }), 1200);
      return;
    }
    if (state.turn === 0) {
      ctx.turn('Your move');
      showYourMoves();
    } else {
      tundeMove();
    }
  }

  return {
    id: 'draughts',
    title: 'Draughts',
    lead: 'Tunde plays between customers, and he plays to win. International draughts on a 10×10 board. You’re white and you move first.',
    levelLabel: 'How good is Tunde?',
    rules: [
      'Men move one square diagonally forward, and capture by jumping, <b>forwards or backwards</b>.',
      'Capturing is <b>compulsory</b>, and you must take the most pieces you can.',
      'Reach the far side to become a <b>king</b>: kings fly any distance along a diagonal.',
      'Take all of Tunde’s pieces, or leave him with no move, to win.',
    ],
    greetings: ['You want draughts? Sit down, the next customer can wait.', 'Ah, a challenger! White moves first.', 'Oya, let me cut you small.'],
    view: { target: new THREE.Vector3(c.x, info.top + 0.02, c.z + 0.04), yaw: 0, pitch: 1.05, dist: 1.25 },
    focus: () => focusPoint.clone(),

    idle() {
      if (playing) return;
      state = D.newGame();
      lastMove = null;
      clearHighlights();
      layout(state);
    },
    start(lv) {
      level = lv;
      state = D.newGame();
      lastMove = null;
      selected = -1;
      busy = false;
      playing = true;
      layout(state);
      hud();
      next();
    },
    update() {},
    stop() {
      playing = false;
      busy = false;
      selected = -1;
      clearHighlights();
      this.idle();
    },

    // for automated tests: plays a quick move for you
    testMove() {
      if (playing && !busy && state.turn === 0 && !state.over) {
        const m = D.chooseMove(state, 0, Math.random, 60);
        if (m) yourMove(m);
      }
      return { turn: state.turn, over: state.over, you: count(0), tunde: count(1) };
    },
    pointerDown() { return false; }, // drags still turn the camera; taps are handled on release
    pointerUp(e, ray, { tap }) {
      if (!tap || busy || !playing || state.turn !== 0) return;
      const i = squareAt(ray);
      if (i < 0) return;
      const moves = D.legalMoves(state);
      if (selected >= 0) {
        const move = moves.find((m) => m.from === selected && m.to === i);
        if (move) { yourMove(move); return; }
      }
      if (moves.some((m) => m.from === i)) selected = i;
      else if (state.board[i] && D.owner(state.board[i]) === 0) {
        ctx.say(moves.some((m) => m.captures.length) ? 'You must capture, my friend!' : 'That one can’t move.', 'Tunde', 1800);
        selected = -1;
      } else selected = -1;
      showYourMoves();
    },
  };
}
