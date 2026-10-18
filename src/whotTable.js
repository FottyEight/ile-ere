// Whot with Iya Bisi, Uncle Femi and Mama Ngozi at the round table. Rules and their play are in
// whot.js; this deals and moves the cards, shows your hand, and lets you play, call and go to
// market.
import * as THREE from 'three';
import * as W from './whot.js';

const NAMES = ['You', 'Uncle Femi', 'Iya Bisi', 'Mama Ngozi'];
const SHAPE_WORD = { circle: 'circle', triangle: 'triangle', cross: 'cross', square: 'square', star: 'star' };
const SHAPE_ICON = { circle: '●', triangle: '▲', cross: '✚', square: '■', star: '★' };
const CARD_W = 0.062;
const CARD_H = 0.092;

// ── Card faces, drawn once per card ──
function drawShape(g, shape, x, y, s) {
  g.beginPath();
  if (shape === 'circle') g.arc(x, y, s, 0, Math.PI * 2);
  else if (shape === 'triangle') { g.moveTo(x, y - s); g.lineTo(x + s, y + s * 0.8); g.lineTo(x - s, y + s * 0.8); g.closePath(); }
  else if (shape === 'square') g.rect(x - s * 0.85, y - s * 0.85, s * 1.7, s * 1.7);
  else if (shape === 'cross') { const t = s * 0.38; g.rect(x - t, y - s, t * 2, s * 2); g.rect(x - s, y - t, s * 2, t * 2); }
  else if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? s * 0.45 : s;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      if (i) g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.closePath();
  }
  g.fill();
}
function faceTexture(card) {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 192;
  const g = cv.getContext('2d');
  g.fillStyle = '#fbf6ec';
  g.fillRect(0, 0, 128, 192);
  g.strokeStyle = '#7a1f2b';
  g.lineWidth = 4;
  g.strokeRect(5, 5, 118, 182);
  g.fillStyle = '#7a1f2b';
  g.font = 'bold 26px Arial';
  g.textAlign = 'center';
  g.fillText(String(card.number), 22, 32);
  g.save();
  g.translate(106, 160);
  g.rotate(Math.PI);
  g.fillText(String(card.number), 0, 0);
  g.restore();
  if (card.shape === 'whot') {
    g.font = 'bold 30px Arial';
    g.fillText('WHOT', 64, 104);
  } else {
    drawShape(g, card.shape, 64, 98, 30);
    drawShape(g, card.shape, 22, 50, 8);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function backTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 192;
  const g = cv.getContext('2d');
  g.fillStyle = '#7a1f2b';
  g.fillRect(0, 0, 128, 192);
  g.strokeStyle = '#f2c14e';
  g.lineWidth = 6;
  g.strokeRect(10, 10, 108, 172);
  g.fillStyle = '#f2c14e';
  g.font = 'bold 30px Arial';
  g.textAlign = 'center';
  g.fillText('WHOT', 64, 106);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createWhotTable(ctx) {
  const { scene, info } = ctx;
  const c = info.center;
  const Y = info.top + 0.001;
  // seat directions from the table centre: you (+z), Uncle Femi (+x), Iya Bisi (−z), Mama Ngozi (−x)
  const DIRS = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)];
  const regular = (p) => ctx.regular(NAMES[p]);

  const backMat = new THREE.MeshStandardMaterial({ map: backTexture(), roughness: 0.6 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: '#efe6d4', roughness: 0.7 });
  const planeGeo = new THREE.PlaneGeometry(CARD_W, CARD_H).rotateX(-Math.PI / 2);
  const edgeGeo = new THREE.BoxGeometry(CARD_W, 0.0012, CARD_H);
  const deck = W.newDeck();
  const cards = new Map(); // card id → group
  for (const card of deck) {
    const g = new THREE.Group();
    const face = new THREE.Mesh(planeGeo, new THREE.MeshStandardMaterial({ map: faceTexture(card), roughness: 0.55 }));
    face.position.y = 0.0007;
    face.userData.cardId = card.id;
    const back = new THREE.Mesh(planeGeo, backMat);
    back.rotation.z = Math.PI;
    back.position.y = -0.0007;
    const edge = new THREE.Mesh(edgeGeo, edgeMat);
    g.add(face, back, edge);
    g.userData = { face, id: card.id, up: false };
    scene.add(g);
    cards.set(card.id, g);
  }
  const faceMeshes = [...cards.values()].map((g) => g.userData.face);

  // where each card should be: in a hand, on the pile or in the market
  const marketPos = new THREE.Vector3(c.x - 0.1, Y, c.z - 0.02);
  const pilePos = new THREE.Vector3(c.x + 0.08, Y, c.z - 0.01);
  function place(g, pos, yaw, faceUp, lift = 0, instant = false) {
    g.userData.up = faceUp;
    const to = pos.clone();
    to.y += lift;
    const flip = faceUp ? 0 : Math.PI;
    if (instant) {
      g.position.copy(to);
      g.rotation.set(flip, yaw, 0, 'YXZ');
      return Promise.resolve();
    }
    g.userData.target = { yaw, flip };
    return ctx.fly(g, to, 0.3, 0.05);
  }
  // cards ease to their target rotation each frame
  function turnCards(dt) {
    const k = Math.min(1, dt * 12);
    for (const g of cards.values()) {
      const t = g.userData.target;
      if (!t) continue;
      g.rotation.order = 'YXZ';
      g.rotation.x += (t.flip - g.rotation.x) * k;
      let dy = t.yaw - g.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.rotation.y += dy * k;
    }
  }

  let state = null;
  let level = 1;
  let busy = false;
  let playing = false;
  let focusPoint = pilePos.clone();
  let hovered = -1;
  let pendingWhot = null; // a Whot card you've picked, waiting for you to call a shape

  // lays every card where the state says it should be
  function layout(instant = false) {
    const jobs = [];
    state.market.forEach((card, i) => {
      jobs.push(place(cards.get(card.id), marketPos, 0.12, false, i * 0.0013, instant));
    });
    state.pile.forEach((card, i) => {
      const g = cards.get(card.id);
      const jitter = ((card.id * 37) % 11 - 5) * 0.03;
      jobs.push(place(g, pilePos, jitter, true, i * 0.0013, instant));
    });
    state.hands.forEach((hand, p) => {
      const dir = DIRS[p];
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const yaw = Math.atan2(dir.x, dir.z);
      const n = hand.length;
      const spread = Math.min(p === 0 ? 0.068 : 0.04, (p === 0 ? 0.6 : 0.32) / Math.max(1, n));
      const legal = p === 0 && state.turn === 0 && !state.over ? new Set(W.legalPlays(state).filter((a) => a.type === 'play').map((a) => a.cardId)) : null;
      hand.forEach((card, i) => {
        const along = (i - (n - 1) / 2) * spread;
        const pos = c.clone().addScaledVector(dir, p === 0 ? 0.3 : 0.33).addScaledVector(side, -along);
        pos.y = Y;
        // your playable cards sit slightly forward; the one under the pointer lifts
        if (legal?.has(card.id)) pos.addScaledVector(dir, -0.012);
        const lift = i * 0.0013 + (p === 0 && hovered === card.id ? 0.008 : 0);
        jobs.push(place(cards.get(card.id), pos, yaw, p === 0, lift, instant));
      });
    });
    return Promise.all(jobs);
  }

  function hud() {
    ctx.score(state.hands.map((h, p) => ({ name: p === 0 ? 'You' : NAMES[p].split(' ').pop(), value: h.length, active: state.turn === p && !state.over })));
    const top = W.topCard(state);
    const need = state.called ? `Called: ${SHAPE_ICON[state.called]} ${SHAPE_WORD[state.called]}` : `On top: ${top.shape === 'whot' ? 'Whot' : `${top.number} ${SHAPE_ICON[top.shape]}`}`;
    const pen = state.pending ? ` · Pick ${state.pending.amount} pending!` : '';
    ctx.turn(state.over ? '' : `${state.turn === 0 ? 'Your turn' : `${NAMES[state.turn]}’s turn`} · ${need}${pen}`);
  }

  function yourButtons() {
    if (state.turn !== 0 || state.over || busy) { ctx.actions([]); return; }
    if (pendingWhot !== null) {
      ctx.actions(W.SHAPES.map((s) => ({ label: `${SHAPE_ICON[s]} ${SHAPE_WORD[s]}`, onClick: () => act({ type: 'play', cardId: pendingWhot, callShape: s }) }))
        .concat([{ label: 'Cancel', alt: true, onClick: () => { pendingWhot = null; yourButtons(); } }]));
      ctx.hint('Call a shape for your Whot');
      return;
    }
    const penalty = state.pending;
    ctx.actions([{ label: penalty ? `Pick ${penalty.amount}` : 'Go to market', alt: true, onClick: () => act({ type: 'market' }) }]);
    const canPlay = W.legalPlays(state).some((a) => a.type === 'play');
    ctx.teach(canPlay ? 'match' : 'market');
    ctx.hint(penalty
      ? (canPlay ? `Defend with a ${penalty.kind === 'two' ? '2' : '5'}, or pick ${penalty.amount}` : `You have no ${penalty.kind === 'two' ? '2' : '5'}: pick ${penalty.amount}`)
      : canPlay ? 'Tap a card to play it (the playable ones sit forward)' : 'Nothing to play: go to market');
  }

  // what each player shouts as they play
  const SHOUT = {
    holdOn: ['Hold on!', 'Hold on o!'],
    two: ['Pick two!', 'Pick two! Carry go!'],
    three: ['Pick three!', 'Pick three, my dear!'],
    suspended: ['Suspension!', 'Suspend!'],
    general: ['General market!', 'General market! Everybody go market!'],
  };
  function shout(p, lines) {
    const line = ctx.pickLine(lines);
    if (p === 0) ctx.say(line, 'you', 1800);
    else ctx.say(line, NAMES[p], 1800);
  }

  async function act(action) {
    if (busy || state.over) return;
    pendingWhot = null;
    busy = true;
    ctx.actions([]);
    const mover = state.turn;
    const result = W.play(state, action);
    state = result.state;
    for (const e of result.events) {
      if (e.type === 'play') {
        focusPoint = pilePos.clone();
        const r = regular(e.player);
        if (r) r.pose = { reach: 1, reachToX: 0 };
        if (e.player === 0) { ctx.pose.me.reach = 1; ctx.pose.me.reachToX = 0; }
        ctx.sfx.play('card_slap');
        if (e.card.number === 2) { shout(e.player, SHOUT.two); ctx.teach('pickTwo'); }
        else if (e.card.number === 5) { shout(e.player, SHOUT.three); ctx.teach('pickThree'); }
      }
      if (e.type === 'holdOn') { shout(e.player, SHOUT.holdOn); ctx.teach('holdOn'); }
      if (e.type === 'suspended') { shout(mover, SHOUT.suspended); regular(e.player)?.c.gesture('shake', 1.2); ctx.teach('suspension'); }
      if (e.type === 'generalMarket') { shout(e.player, SHOUT.general); ctx.teach('generalMarket'); }
      if (e.type === 'call') { ctx.say(`I need ${SHAPE_WORD[e.shape]}!`, mover === 0 ? 'you' : NAMES[mover], 2000); ctx.teach('whot'); }
      if (e.type === 'draw') { focusPoint = marketPos.clone(); ctx.sfx.play('card_draw'); }
      if (e.type === 'reshuffle') ctx.toast('The market is finished. The pile is shuffled back in.', 2200);
    }
    await layout();
    for (const r of [1, 2, 3].map(regular)) if (r) r.pose = { reach: 0 };
    ctx.pose.me.reach = 0;
    busy = false;
    const win = result.events.find((e) => e.type === 'win');
    if (win) return gameOver(win.player, win.reason);
    // check up: one card left
    if (state.hands[mover].length === 1 && mover !== 0) ctx.say('Last card!', NAMES[mover], 1600);
    if (state.hands[mover].length === 1) ctx.teach('lastCard');
    next();
  }

  function gameOver(winner) {
    playing = false;
    hud();
    ctx.actions([]);
    ctx.hint('');
    const won = winner === 0;
    for (let p = 1; p < 4; p++) regular(p)?.c.gesture(p === winner ? 'laugh' : won ? 'clap' : 'nod', 2.2);
    if (won) ctx.say('Check up! You don finish us.', 'Iya Bisi', 2600);
    else ctx.say(ctx.pickLine(['Check up! I don finish!', 'Last card done! I win.']), NAMES[winner], 2600);
    setTimeout(() => ctx.finish({
      outcome: won ? 'win' : 'loss',
      title: won ? 'You won at Whot!' : `${NAMES[winner]} wins this round`,
      detail: won ? 'You played your last card first.' : `You had ${state.hands[0].length} card${state.hands[0].length === 1 ? '' : 's'} left.`,
    }), 1300);
  }

  async function next() {
    hud();
    if (state.turn === 0) { yourButtons(); layout(); return; }
    ctx.actions([]);
    ctx.hint('');
    busy = true;
    await new Promise((r) => setTimeout(r, (700 + Math.random() * 500) / ctx.speed));
    busy = false;
    act(W.chooseAction(state, level));
  }

  return {
    id: 'whot',
    title: 'Whot',
    lead: 'Iya Bisi, Uncle Femi and Mama Ngozi play Whot every evening, and they talk plenty while they do. Five cards each; play your last card first to win.',
    levelLabel: 'How sharp are they?',
    rules: [
      'Play a card that matches the top card’s <b>shape</b> or <b>number</b>, or go to market (draw one).',
      '<b>1</b> Hold on: play again · <b>2</b> Pick two · <b>5</b> Pick three (defend with the same number) · <b>8</b> Suspension · <b>14</b> General market',
      '<b>Whot (20)</b> plays on anything except a Pick two or Pick three, and you call the shape the next player must follow.',
      'First to play their last card wins.',
    ],
    greetings: ['Come and sit! We go deal you in.', 'Ehen, a fourth player! Sit down.', 'You know Whot? Pick two dey wait you o!'],
    view: { target: new THREE.Vector3(c.x, info.top + 0.02, c.z + 0.08), yaw: 0, pitch: 1.0, dist: 1.4 },
    focus: () => focusPoint.clone(),

    idle() {
      if (playing) return;
      // a game left on the table, cards face down
      state = W.newGame();
      layout(true);
    },
    async start(lv) {
      level = lv;
      playing = true;
      busy = true;
      pendingWhot = null;
      state = W.newGame();
      // gather everything into the market, then deal
      for (const g of cards.values()) place(g, marketPos, 0.12, false, 0, true);
      ctx.sfx.play('card_shuffle', { volume: 0.8 });
      for (let i = 0; i < 6; i++) setTimeout(() => ctx.sfx.play('card_deal', { volume: 0.6, fallback: false }), 900 + i * 160);
      await layout();
      busy = false;
      ctx.say(ctx.pickLine(['Cards don share. You start!', 'Oya, you first.']), 'Iya Bisi', 2000);
      next();
    },
    update(dt) { turnCards(dt); },
    stop() {
      playing = false;
      busy = false;
      pendingWhot = null;
      this.idle();
    },

    // for automated tests: plays a sensible move for you
    testMove() {
      if (playing && !busy && state.turn === 0 && !state.over) act(W.chooseAction(state, 1));
      return { turn: state?.turn, over: state?.over, hands: state?.hands.map((h) => h.length) };
    },
    pointerDown() { return false; },
    pointerMove(e, ray) {
      if (!playing || state.turn !== 0) return false;
      const h = ray.intersectObjects(faceMeshes.filter((f) => state.hands[0].some((c2) => c2.id === f.userData.cardId)))[0];
      const id = h ? h.object.userData.cardId : -1;
      if (id !== hovered) { hovered = id; if (!busy) layout(); }
      return false;
    },
    pointerUp(e, ray, { tap }) {
      if (!tap || busy || !playing || state.turn !== 0 || state.over) return;
      const mine = faceMeshes.filter((f) => state.hands[0].some((c2) => c2.id === f.userData.cardId));
      const h = ray.intersectObjects(mine)[0];
      if (!h) return;
      const id = h.object.userData.cardId;
      const plays = W.legalPlays(state).filter((a) => a.type === 'play' && a.cardId === id);
      if (!plays.length) {
        ctx.say(state.pending ? `You must defend or pick ${state.pending.amount}.` : 'That card doesn’t match.', 'Iya Bisi', 1800);
        return;
      }
      if (plays[0].callShape) { pendingWhot = id; yourButtons(); return; }
      act(plays[0]);
    },
  };
}
