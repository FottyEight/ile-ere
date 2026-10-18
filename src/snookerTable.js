// Snooker with Emeka under the zinc canopy. Physics, rules and Emeka's play are in snooker.js;
// this draws the balls and cue, lets you place the cue ball, aim and shoot, and replays each
// shot from the simulation.
import * as THREE from 'three';
import * as S from './snooker.js';
import { think } from './think.js';

const COLOURS = {
  cue: '#f7f3ea', yellow: '#f5d300', green: '#2a8f3a', brown: '#7a4a22',
  blue: '#1e5bc6', pink: '#ef6fa6', black: '#151515', red: '#b3121c',
};

export function createSnookerTable(ctx) {
  const { scene, info } = ctx;
  const c = info.center;
  const R = S.TABLE.r;
  const Y = info.top + R;
  const emeka = () => ctx.regular('Emeka');
  const world = (x, z, y = Y) => new THREE.Vector3(c.x + x, y, c.z + z);

  // ── Balls ──
  const ballGeo = new THREE.SphereGeometry(R, 24, 18);
  const mats = {};
  for (const [k, col] of Object.entries(COLOURS)) mats[k] = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 });
  const balls = new Map();
  for (const b of S.newFrame().balls) {
    const m = new THREE.Mesh(ballGeo, mats[b.id.startsWith('red') ? 'red' : b.id]);
    m.castShadow = true;
    scene.add(m);
    balls.set(b.id, m);
  }

  // ── The cue, an aiming line and a ghost ball ──
  const cue = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.014, 1.45, 12), new THREE.MeshStandardMaterial({ color: '#d9b37c', roughness: 0.45 }));
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = -0.745; // the tip at the group's origin, the butt behind it
  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.016, 0.45, 12), new THREE.MeshStandardMaterial({ color: '#2b1a10', roughness: 0.5 }));
  butt.rotation.z = Math.PI / 2;
  butt.position.x = -1.25;
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.01, 10), new THREE.MeshStandardMaterial({ color: '#3a6fd8' }));
  tip.rotation.z = Math.PI / 2;
  tip.position.x = -0.004;
  cue.add(shaft, butt, tip);
  cue.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(cue);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
  const aimLine = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.02, gapSize: 0.015, transparent: true, opacity: 0.8 }));
  scene.add(aimLine);
  const ghost = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, depthWrite: false }));
  scene.add(ghost);

  let state = S.newFrame();
  let level = 1;
  let playing = false;
  let busy = false; // a shot is rolling, or Emeka is thinking
  let aim = 0; // radians in the table's x–z plane, 0 = towards the black end
  let power = 0;
  let charging = false;
  let chargeT = 0;
  let placing = false;
  let replay = null; // { frames, t, potted: Set, done }
  let focusPoint = c.clone();
  const savedSeat = ctx.station.seat.clone();
  const savedFace = ctx.station.face;

  function drawBalls(list) {
    for (const b of list) {
      const m = balls.get(b.id);
      m.visible = !b.potted;
      m.position.copy(world(b.x, b.z));
    }
  }
  const cueBall = () => state.balls.find((b) => b.id === 'cue');

  // a straight dashed line from the cue ball to the first ball or cushion in the aim direction
  function aimGuide() {
    const cb = cueBall();
    const show = playing && !busy && state.turn === 0 && !placing;
    aimLine.visible = ghost.visible = cue.visible = show || (busy && state.turn === 1 && cue.userData.emeka);
    if (!show) return;
    const dx = Math.cos(aim);
    const dz = Math.sin(aim);
    let best = 3;
    for (const b of state.balls) {
      if (b.potted || b.id === 'cue') continue;
      // where along the line would the cue ball touch this ball?
      const px = b.x - cb.x;
      const pz = b.z - cb.z;
      const along = px * dx + pz * dz;
      if (along <= 0) continue;
      const off2 = px * px + pz * pz - along * along;
      if (off2 > (2 * R) ** 2) continue;
      const t = along - Math.sqrt((2 * R) ** 2 - off2);
      if (t < best) best = t;
    }
    // or a cushion
    const hx = S.TABLE.L / 2 - R;
    const hz = S.TABLE.W / 2 - R;
    const tx = dx > 0 ? (hx - cb.x) / dx : dx < 0 ? (-hx - cb.x) / dx : Infinity;
    const tz = dz > 0 ? (hz - cb.z) / dz : dz < 0 ? (-hz - cb.z) / dz : Infinity;
    best = Math.min(best, tx, tz);
    // the guide only shows the whole line on Easy; on Normal it's short, on Hard it's very short
    const shown = level === 0 ? best : level === 1 ? Math.min(best, 0.6) : Math.min(best, 0.25);
    const from = world(cb.x, cb.z, info.top + 0.003);
    const to = world(cb.x + dx * shown, cb.z + dz * shown, info.top + 0.003);
    aimLine.geometry.setFromPoints([from, to]);
    aimLine.computeLineDistances();
    ghost.visible = level < 2 && shown === best;
    ghost.position.copy(world(cb.x + dx * best, cb.z + dz * best));
    // the cue lies behind the cue ball along the aim, pulled back with the power
    cue.position.copy(world(cb.x, cb.z));
    cue.position.addScaledVector(new THREE.Vector3(dx, 0, dz), -(R + 0.01 + power * 0.18));
    cue.position.y = Y + 0.012;
    cue.rotation.set(0, -aim, 0.06);
    cue.userData.emeka = false;
  }

  function hud() {
    ctx.score([
      { name: 'You', value: state.scores[0], active: state.turn === 0 && !state.over },
      { name: 'Emeka', value: state.scores[1], active: state.turn === 1 && !state.over },
    ]);
    const on = state.on === 'red' ? 'a red' : state.on === 'colour' ? 'a colour' : `the ${state.on}`;
    ctx.turn(state.over ? '' : `${state.turn === 0 ? 'Your shot' : 'Emeka’s shot'} · on ${on}${state.breakNo ? ` · break ${state.breakNo}` : ''}`);
  }

  // your controls: move the pointer over the table to aim, hold Shoot (or Space) to charge
  function yourTurn() {
    hud();
    placing = state.ballInHand;
    if (placing) {
      ctx.hint('Ball in hand: move the pointer to place the cue ball inside the D, then tap to put it down');
      ctx.actions([]);
      return;
    }
    ctx.hint('Point at the table to aim · hold Shoot (or Space) and let go to strike · ← → fine-tune');
    ctx.actions([{ label: 'Hold to shoot', onDown: startCharge, onUp: release }]);
  }
  function startCharge() {
    if (busy || placing || state.turn !== 0 || !playing) return;
    charging = true;
    chargeT = 0;
  }
  function release() {
    if (!charging) return;
    charging = false;
    if (power < 0.04) { power = 0; return; }
    shoot({ angle: aim, power: Math.max(0.06, power), spin: 0 });
  }

  async function shoot(shot) {
    busy = true;
    ctx.actions([]);
    const mover = state.turn;
    // the cue strikes
    const cb = cueBall();
    const dir = new THREE.Vector3(Math.cos(shot.angle), 0, Math.sin(shot.angle));
    cue.visible = true;
    cue.userData.emeka = mover === 1;
    cue.rotation.set(0, -shot.angle, 0.06);
    const back = world(cb.x, cb.z).addScaledVector(dir, -(R + 0.02 + shot.power * 0.18));
    back.y = Y + 0.012;
    cue.position.copy(back);
    await ctx.wait(mover === 1 ? 500 : 60);
    await ctx.fly(cue, world(cb.x, cb.z, Y + 0.012).addScaledVector(dir, -R - 0.002), 0.08, 0);
    ctx.sfx.clack();
    const result = S.takeShot(state, shot);
    replay = { frames: result.frames, t: 0, potted: new Set(), result, mover };
    aimLine.visible = ghost.visible = false;
  }

  function endOfShot() {
    const { result, mover } = replay;
    replay = null;
    cue.visible = false;
    state = result.state;
    drawBalls(state.balls);
    const o = result.outcome;
    ctx.toast(o.message, 2600);
    const e = emeka();
    if (o.foul) {
      if (mover === 0) { e?.c.gesture('laugh', 1.4); ctx.say(ctx.pickLine(['Foul! Thank you o.', 'Ehn, free points!']), 'Emeka', 2000); }
      else { e?.c.gesture('shake', 1.4); ctx.say(ctx.pickLine(['Ah, foul. My hand shake.', 'That one slip.']), 'Emeka', 2000); }
    } else if (o.potted.length && mover === 0 && o.scored >= 5) {
      e?.c.gesture('surprise', 1.4);
      ctx.say(ctx.pickLine(['Clean pot!', 'Ehn! Sharp shooter.', 'I see you!']), 'Emeka', 1800);
    } else if (o.potted.length && mover === 1) {
      e?.c.gesture('nod', 1.2);
    }
    busy = false;
    next();
  }

  async function next() {
    if (state.over) {
      playing = false;
      ctx.actions([]);
      ctx.hint('');
      hud();
      const won = state.winner === 0;
      emeka()?.c.gesture(won ? 'clap' : 'laugh', 2.4);
      ctx.say(won ? 'You beat me for snooker! Respect.' : 'Frame to Emeka! Practise your cue.', 'Emeka', 3000);
      setTimeout(() => ctx.finish({
        outcome: won ? 'win' : 'loss',
        title: won ? 'You beat Emeka!' : 'Emeka wins the frame',
        detail: `${state.scores[0]} – ${state.scores[1]}`,
      }), 1400);
      return;
    }
    if (state.turn === 0) { yourTurn(); return; }
    // Emeka's shot
    hud();
    ctx.actions([]);
    ctx.hint('');
    busy = true;
    const t0 = performance.now();
    const shot = await think('./snooker.js', S, 'chooseShot', [state, level]);
    const wait = Math.max(0, 700 / ctx.speed - (performance.now() - t0));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    if (!playing) return;
    if (shot.place) {
      state = S.placeCue(state, shot.place.x, shot.place.z);
      drawBalls(state.balls);
      delete shot.place;
    }
    shoot(shot);
  }

  // ── Pointer ──
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -Y);
  const hit = new THREE.Vector3();
  function tableXZ(ray) {
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x - c.x, z: hit.z - c.z };
  }
  function aimTowards(p) {
    const cb = cueBall();
    if (Math.hypot(p.x - cb.x, p.z - cb.z) > 0.03) aim = Math.atan2(p.z - cb.z, p.x - cb.x);
  }
  function moveCueInD(p) {
    // keep it inside the D and off other balls
    const sp = S.TABLE.spots.brown;
    let x = Math.min(p.x, sp.x - 0.001);
    let z = p.z;
    const dx = x - sp.x;
    const d = Math.hypot(dx, z);
    const maxR = S.TABLE.dRadius - 0.002;
    if (d > maxR) { x = sp.x + (dx / d) * maxR; z = (z / d) * maxR; }
    try {
      state = S.placeCue({ ...state, ballInHand: true }, x, z);
      state.ballInHand = true;
      drawBalls(state.balls);
    } catch { /* over another ball: leave it */ }
  }

  return {
    id: 'snooker',
    title: 'Snooker',
    lead: 'Emeka runs the snooker table under the canopy. One frame: pot a red, then a colour, and keep your break going. Most points when the black goes down wins.',
    levelLabel: 'How good is Emeka?',
    rules: [
      'While reds are on the table, pot a <b>red</b> (1 point), then any <b>colour</b>: yellow 2, green 3, brown 4, blue 5, pink 6, black 7.',
      'Colours come back to their spots until the reds are gone; then pot them in order, yellow to black.',
      'Hitting the wrong ball first, missing everything or potting the white is a <b>foul</b>: at least 4 points to Emeka.',
      'Aim with the pointer, hold <b>Shoot</b> (or Space) to build power and let go to strike. The guide line is long on Easy, short on Hard.',
    ],
    greetings: ['You play snooker? Pick a cue.', 'One frame? Oya, rack them!', 'Ah, new challenger. Your break.'],
    // (kept low enough to stay under the zinc canopy)
    view: { target: new THREE.Vector3(c.x, info.top, c.z + 0.1), yaw: 0, pitch: 0.62, dist: 2.3, maxPitch: 0.72 },
    focus: () => focusPoint.clone(),

    idle() {
      if (playing) return;
      state = S.newFrame();
      drawBalls(state.balls);
      cue.visible = aimLine.visible = ghost.visible = false;
    },
    start(lv) {
      level = lv;
      state = S.newFrame();
      playing = true;
      busy = false;
      replay = null;
      aim = 0;
      power = 0;
      drawBalls(state.balls);
      ctx.say('Your break. Place the white in the D.', 'Emeka', 2400);
      next();
    },
    update(dt) {
      if (charging) {
        // power swings up and down while you hold, so you let go at the right moment
        chargeT += dt;
        power = 0.5 - 0.5 * Math.cos(chargeT * 2.2);
        ctx.hint(`Power ${'▮'.repeat(Math.round(power * 10))}${'▯'.repeat(10 - Math.round(power * 10))}  · let go to strike`);
      }
      if (replay) {
        replay.t += dt * Math.min(ctx.speed, 2.5);
        const i = Math.min(replay.frames.length - 1, Math.floor(replay.t * 60));
        const f = replay.frames[i];
        drawBalls(f.balls);
        for (const b of f.balls) {
          if (b.potted && !replay.potted.has(b.id)) { replay.potted.add(b.id); ctx.sfx.capture(); }
        }
        const cb = f.balls.find((b) => b.id === 'cue');
        if (cb && !cb.potted) focusPoint = world(cb.x, cb.z);
        if (i >= replay.frames.length - 1) endOfShot();
      }
      aimGuide();
      // you stand behind the cue ball when it's your shot; Emeka does when it's his
      const cb = cueBall();
      if (playing && cb) {
        const back = (a, d) => world(cb.x - Math.cos(a) * d, cb.z - Math.sin(a) * d, 0);
        const yourTurnNow = state.turn === 0 && !replay;
        if (yourTurnNow && !placing) {
          const p = back(aim, 0.95);
          ctx.station.seat.set(p.x, 0, p.z);
          ctx.station.face = Math.atan2(cb.x + c.x - p.x, cb.z + c.z - p.z);
        }
        const e = emeka();
        if (e && state.turn === 1 && cue.userData.emeka) {
          const p = back(-cue.rotation.y, 0.95);
          e.c.root.position.set(p.x, 0, p.z);
          e.c.root.rotation.y = Math.atan2(cb.x + c.x - p.x, cb.z + c.z - p.z);
        }
      }
    },
    stop() {
      playing = false;
      busy = false;
      charging = false;
      replay = null;
      ctx.station.seat.copy(savedSeat);
      ctx.station.face = savedFace;
      const e = emeka();
      if (e) { e.c.root.position.copy(e.pos); e.c.root.rotation.y = e.face; }
      this.idle();
    },

    // for automated tests: plays a normal-strength shot for you
    testMove() {
      if (playing && !busy && state.turn === 0 && !state.over) {
        const shot = S.chooseShot(state, 1);
        if (shot.place) { state = S.placeCue(state, shot.place.x, shot.place.z); delete shot.place; }
        placing = false;
        shoot(shot);
      }
      return { turn: state.turn, over: state.over, scores: state.scores };
    },
    pointerDown(e, ray) {
      if (!playing || busy || state.turn !== 0) return false;
      const p = tableXZ(ray);
      if (!p || Math.abs(p.x) > S.TABLE.L / 2 + 0.1 || Math.abs(p.z) > S.TABLE.W / 2 + 0.1) return false;
      if (placing) moveCueInD(p);
      else aimTowards(p);
      return true; // pointing at the table aims rather than turning the camera
    },
    pointerMove(e, ray, owned) {
      if (!playing || busy || state.turn !== 0) return false;
      const p = tableXZ(ray);
      if (!p) return false;
      if (placing) { if (e.pointerType === 'mouse' || owned) moveCueInD(p); }
      else if (e.pointerType === 'mouse' || owned) aimTowards(p);
      return !!owned;
    },
    pointerUp(e, ray, { tap, owned }) {
      if (placing && owned && tap) {
        placing = false;
        state = { ...state, ballInHand: false };
        yourTurn();
      }
    },
    keyDown(e, k) {
      if (k === ' ') { e.preventDefault(); if (!charging) startCharge(); }
      if (k === 'ArrowLeft') { aim -= e.shiftKey ? 0.002 : 0.012; e.preventDefault(); }
      if (k === 'ArrowRight') { aim += e.shiftKey ? 0.002 : 0.012; e.preventDefault(); }
      if (k === 'Enter' && placing) { placing = false; state = { ...state, ballInHand: false }; yourTurn(); }
    },
    keyUp(e, k) {
      if (k === ' ') release();
    },
  };
}
