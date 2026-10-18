// Snooker on a small "bar" table: 2D physics, the referee and the computer player.
//
// Everything is in metres on the cloth, seen from above: x runs along the table (baulk end at
// -L/2, black end at +L/2) and z across it. The 3D scene draws the balls at these positions;
// nothing here touches the DOM, so the same code runs the game, the AI and the tests.
//
// Rules (standard snooker, simplified):
//  - While reds remain you must hit a red first. Each red potted scores 1 and earns a colour:
//    you nominate it (`target` in the shot), must hit it first, and score its value if it drops.
//    That colour is re-spotted and you are back on reds.
//  - Once the reds are gone (after the colour that follows the last red), the colours go down in
//    order yellow, green, brown, blue, pink, black and stay down.
//  - Fouls: missing every ball, hitting the wrong ball first, potting the cue ball, potting a ball
//    that isn't on. The opponent gets max(4, value of the ball on, value of the ball wrongly hit
//    or potted) and the turn passes. Colours potted on a foul are re-spotted; reds stay down.
//    After the cue ball is potted the next player has ball in hand in the D.
//    Not modelled: "foul and a miss", free ball, push shots, touching ball.
//  - If the cue's colour nomination is missing, the first colour it hits counts as nominated.
//  - The frame ends when the black is potted (or fouled) in the final sequence. If the scores are
//    then level the black is re-spotted and the other player has ball in hand to play for it.

// ── Table ──
const L = 2.6;
const W = 1.4;
const R = 0.026;
const HL = L / 2;
const HW = W / 2;
const BAULK_X = -HL + 0.55;
const D_RADIUS = 0.22;
// The cushion stops this far (in ball-centre terms) from a corner and either side of a middle
// pocket, leaving an open mouth the ball can roll through.
const CORNER_MOUTH = 0.07;
const MIDDLE_MOUTH = 0.05;

const SPOTS = {
  yellow: { x: BAULK_X, z: 0.22 },
  green: { x: BAULK_X, z: -0.22 },
  brown: { x: BAULK_X, z: 0 },
  blue: { x: 0, z: 0 },
  pink: { x: 0.62, z: 0 },
  black: { x: 1.05, z: 0 },
};

const corner = (x, z) => ({ x, z, radius: 0.055, kind: 'corner' });
const middle = (x, z) => ({ x, z, radius: 0.05, kind: 'middle' });

export const TABLE = {
  L,
  W,
  r: R,
  pockets: [corner(-HL, -HW), middle(0, -HW), corner(HL, -HW), corner(-HL, HW), middle(0, HW), corner(HL, HW)],
  baulkX: BAULK_X,
  dRadius: D_RADIUS,
  spots: SPOTS,
};

export const COLOURS = ['yellow', 'green', 'brown', 'blue', 'pink', 'black'];
const VALUES = { yellow: 2, green: 3, brown: 4, blue: 5, pink: 6, black: 7 };
const CUE_START = { x: -0.85, z: 0.08 };
const NAMES = ['You', 'Emeka'];

const isRed = (id) => id.startsWith('red');
export const valueOf = (id) => (isRed(id) ? 1 : VALUES[id] ?? 0);
const ballName = (id) => (isRed(id) ? 'a red' : id === 'cue' ? 'the cue ball' : `the ${id}`);

// ── Physics constants ──
const DT = 1 / 240;
const MAX_SPEED = 6; // m/s at full power
const ROLL_DECEL = 0.18; // m/s², rolling resistance of the cloth
const DRAG = 0.4; // 1/s, speed-proportional loss so hard shots don't run forever (~3 m from 2 m/s)
const STOP_SPEED = 0.004;
const BALL_E = 0.95;
const CUSHION_E = 0.75;
const SPIN_GAIN = 0.6; // full top/back spin adds ±60% of the cue's contact speed after the hit
const MAX_TIME = 30;

// ── Frame set-up ──
export function newFrame() {
  const balls = [{ id: 'cue', ...CUE_START, potted: false }];
  // The triangle points at the pink; each row is one ball wider, a hair apart so nothing starts touching.
  const d = 2 * R + 0.001;
  const apex = 0.62 + 2 * R + 0.002;
  let n = 0;
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      balls.push({ id: `red${n++}`, x: apex + row * d * Math.sqrt(3) / 2, z: (k - row / 2) * d, potted: false });
    }
  }
  for (const c of COLOURS) balls.push({ id: c, ...SPOTS[c], potted: false });
  return {
    balls,
    turn: 0,
    scores: [0, 0],
    on: 'red',
    ballInHand: true,
    breakNo: 0,
    over: false,
    winner: null,
    message: 'Your break. Place the cue ball in the D.',
  };
}

const live = (balls) => balls.filter((b) => !b.potted);
const find = (balls, id) => balls.find((b) => b.id === id);
const redsLeft = (balls) => balls.filter((b) => isRed(b.id) && !b.potted).length;

export function legalTargets(s) {
  if (s.over) return [];
  if (s.on === 'red') return live(s.balls).filter((b) => isRed(b.id)).map((b) => b.id);
  if (s.on === 'colour') return COLOURS.filter((c) => !find(s.balls, c).potted);
  return [s.on];
}

export function inD(x, z) {
  return x <= BAULK_X && x >= -HL + R && (x - BAULK_X) ** 2 + z ** 2 <= D_RADIUS ** 2;
}

function isFree(balls, x, z, ignore) {
  return live(balls).every((b) => b.id === ignore || (b.x - x) ** 2 + (b.z - z) ** 2 >= (2 * R) ** 2);
}

export function placeCue(s, x, z) {
  if (!s.ballInHand) throw new Error('no ball in hand');
  if (!inD(x, z)) throw new Error('the cue ball must go in the D');
  if (!isFree(s.balls, x, z, 'cue')) throw new Error('that spot is taken');
  return { ...s, balls: s.balls.map((b) => (b.id === 'cue' ? { ...b, x, z, potted: false } : { ...b })) };
}

// Somewhere legal in the D for a cue ball that went in: the usual spot, else the first free point.
function freeDSpot(balls) {
  if (isFree(balls, CUE_START.x, CUE_START.z, 'cue')) return CUE_START;
  for (let rad = 0.02; rad <= D_RADIUS; rad += 0.02) {
    for (let a = Math.PI / 2; a <= 1.5 * Math.PI; a += 0.2) {
      const x = BAULK_X + rad * Math.cos(a);
      const z = rad * Math.sin(a);
      if (inD(x, z) && isFree(balls, x, z, 'cue')) return { x, z };
    }
  }
  return CUE_START; // the D can't realistically be full
}

// Own spot first, then the highest-value free spot, then as near its own spot as possible
// (along the line toward the top cushion, then toward baulk).
function respot(balls, id) {
  const tries = [id, ...COLOURS.slice().reverse().filter((c) => c !== id)];
  const ball = find(balls, id);
  const put = (x, z) => Object.assign(ball, { x, z, potted: false });
  for (const c of tries) {
    if (isFree(balls, SPOTS[c].x, SPOTS[c].z, id)) return put(SPOTS[c].x, SPOTS[c].z);
  }
  const { x, z } = SPOTS[id];
  for (let d = 0.002; d < L; d += 0.002) {
    if (x + d <= HL - R && isFree(balls, x + d, z, id)) return put(x + d, z);
    if (x - d >= -HL + R && isFree(balls, x - d, z, id)) return put(x - d, z);
  }
}

// ── Physics ──
// Fixed steps; each step is split into sub-steps short enough that no ball moves more than a
// third of its radius, and every contact is rewound to the moment of touch before it's resolved,
// so a 6 m/s cue ball can't pass through anything and cut angles come out true.

const speed = (b) => Math.hypot(b.vx, b.vz);
const inMouthX = (x) => Math.abs(x) > HL - CORNER_MOUTH || Math.abs(x) < MIDDLE_MOUTH;
const inMouthZ = (z) => Math.abs(z) > HW - CORNER_MOUTH;

function pocketBall(b, ctx) {
  // every pocket sits on a long edge, so a ball well clear of both long cushions can't be in one
  if (Math.abs(b.z) < HW - 0.06) return;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < 6; i++) {
    const d = Math.hypot(b.x - TABLE.pockets[i].x, b.z - TABLE.pockets[i].z);
    if (d < bestD) { bestD = d; best = i; }
  }
  const p = TABLE.pockets[best];
  // inside the capture circle, or past the table edge (only possible through a mouth): it's down
  if (bestD < p.radius || Math.abs(b.x) > HL || Math.abs(b.z) > HW) {
    Object.assign(b, { x: p.x, z: p.z, vx: 0, vz: 0, potted: true });
    ctx.events.potted.push({ id: b.id, pocket: best, t: ctx.t });
    if (b.id === 'cue') ctx.events.cuePotted = true;
  }
}

function cushion(b, ctx) {
  if (Math.abs(b.x) < HL - R && Math.abs(b.z) < HW - R) return;
  let hit = false;
  const zMax = HW - R;
  if (Math.abs(b.z) > zMax && !inMouthX(b.x) && Math.sign(b.vz) === Math.sign(b.z)) {
    b.z = Math.sign(b.z) * (2 * zMax - Math.abs(b.z));
    b.vz = -b.vz * CUSHION_E;
    hit = true;
  }
  const xMax = HL - R;
  if (Math.abs(b.x) > xMax && !inMouthZ(b.z) && Math.sign(b.vx) === Math.sign(b.x)) {
    b.x = Math.sign(b.x) * (2 * xMax - Math.abs(b.x));
    b.vx = -b.vx * CUSHION_E;
    hit = true;
  }
  if (hit) ctx.events.cushions.push({ id: b.id, t: ctx.t });
}

function collide(a, b, h, ctx) {
  let dx = b.x - a.x;
  let dz = b.z - a.z;
  const d2 = dx * dx + dz * dz;
  if (d2 >= 4 * R * R) return;
  const wx = b.vx - a.vx;
  const wz = b.vz - a.vz;
  const pw = dx * wx + dz * wz;
  if (pw < 0) {
    // Rewind both balls to the moment they touched: |p - s·w| = 2R, the positive root.
    const ww = wx * wx + wz * wz;
    const s = Math.min(h, (pw + Math.sqrt(pw * pw - ww * (d2 - 4 * R * R))) / ww);
    a.x -= a.vx * s; a.z -= a.vz * s;
    b.x -= b.vx * s; b.z -= b.vz * s;
    dx = b.x - a.x;
    dz = b.z - a.z;
    const d = Math.hypot(dx, dz) || 1e-9;
    const nx = dx / d;
    const nz = dz / d;
    const vn = wx * nx + wz * nz;
    if (vn < 0) {
      const cue = a.id === 'cue' ? a : b.id === 'cue' ? b : null;
      const spin = cue && !ctx.events.firstHit && ctx.spin ? { vx: cue.vx, vz: cue.vz } : null;
      if (cue && !ctx.events.firstHit) ctx.events.firstHit = cue === a ? b.id : a.id;
      // equal masses: each ball takes half of (1 + e) of the closing speed along the line of centres
      const j = ((1 + BALL_E) / 2) * vn;
      a.vx += j * nx; a.vz += j * nz;
      b.vx -= j * nx; b.vz -= j * nz;
      if (spin) {
        // Top/back spin grips after the hit: push the cue ball along (or back down) its old line.
        // Spin wears off as the cue ball rolls, so it fades with the distance travelled first.
        const k = ctx.spin * SPIN_GAIN * Math.exp(-ctx.cueTravel / 2);
        cue.vx += spin.vx * k;
        cue.vz += spin.vz * k;
      }
      ctx.events.contacts++;
    }
    a.x += a.vx * s; a.z += a.vz * s;
    b.x += b.vx * s; b.z += b.vz * s;
    dx = b.x - a.x;
    dz = b.z - a.z;
  }
  separate(a, b);
}

// Pushes two overlapping balls apart along their line of centres (positions only, never speeds).
function separate(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d >= 2 * R) return;
  const nx = d > 1e-9 ? dx / d : 1;
  const nz = d > 1e-9 ? dz / d : 0;
  const push = (2 * R - d) / 2 + 1e-7;
  a.x -= nx * push; a.z -= nz * push;
  b.x += nx * push; b.z += nz * push;
}

function step(on, dt, ctx) {
  let vmax = 0;
  for (const b of on) vmax = Math.max(vmax, speed(b));
  const n = Math.max(1, Math.ceil((vmax * dt) / (R / 3)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    for (const b of on) {
      if (b.potted || (b.vx === 0 && b.vz === 0)) continue;
      b.x += b.vx * h;
      b.z += b.vz * h;
      if (b.id === 'cue' && !ctx.events.firstHit) ctx.cueTravel += speed(b) * h;
    }
    for (let p = 0; p < on.length; p++) {
      const a = on[p];
      if (a.potted) continue;
      const aMoving = a.vx !== 0 || a.vz !== 0;
      for (let q = p + 1; q < on.length; q++) {
        const b = on[q];
        if (b.potted || (!aMoving && b.vx === 0 && b.vz === 0)) continue;
        collide(a, b, h, ctx);
      }
    }
    for (const b of on) {
      if (b.potted) continue;
      cushion(b, ctx);
      pocketBall(b, ctx);
    }
  }
  for (const b of on) {
    const v = speed(b);
    if (v === 0) continue;
    const nv = v - (ROLL_DECEL + DRAG * v) * dt;
    const k = nv > STOP_SPEED ? nv / v : 0;
    b.vx *= k;
    b.vz *= k;
  }
}

// After everything stops, nudge apart any balls still touching from a crowded collision.
function settle(bodies) {
  const on = bodies.filter((b) => !b.potted);
  for (let pass = 0; pass < 50; pass++) {
    let moved = false;
    for (let p = 0; p < on.length; p++) {
      for (let q = p + 1; q < on.length; q++) {
        if ((on[q].x - on[p].x) ** 2 + (on[q].z - on[p].z) ** 2 < (2 * R) ** 2) {
          separate(on[p], on[q]);
          moved = true;
        }
      }
    }
    for (const b of on) {
      if (!inMouthZ(b.z)) b.x = Math.max(-HL + R, Math.min(HL - R, b.x));
      if (!inMouthX(b.x)) b.z = Math.max(-HW + R, Math.min(HW - R, b.z));
    }
    if (!moved) break;
  }
}

const snapshot = (t, bodies) => ({ t, balls: bodies.map(({ id, x, z, potted }) => ({ id, x, z, potted })) });

// Runs a shot to rest. Physics only, no rules. Returns
//   frames: [{ t, balls: [{ id, x, z, potted }] }] at 60 fps for animation,
//   events: { firstHit, cushions: [{ id, t }], potted: [{ id, pocket, t }], cuePotted, contacts },
//   balls: where everything ended up, time: seconds until rest.
// `options` is for tools and tests: { dt, record: false to skip frames, onStep(t, bodies) }.
export function simulate(s, shot, { dt = DT, record = true, onStep } = {}) {
  const bodies = s.balls.map(({ id, x, z, potted }) => ({ id, x, z, potted, vx: 0, vz: 0 }));
  const cue = find(bodies, 'cue');
  if (!cue || cue.potted) throw new Error('the cue ball is not on the table');
  const v = Math.max(0, Math.min(1, shot.power)) * MAX_SPEED;
  cue.vx = Math.cos(shot.angle) * v;
  cue.vz = Math.sin(shot.angle) * v;
  const events = { firstHit: null, cushions: [], potted: [], cuePotted: false, contacts: 0 };
  const ctx = { events, t: 0, spin: Math.max(-1, Math.min(1, shot.spin || 0)), cueTravel: 0 };
  const every = Math.max(1, Math.round(1 / 60 / dt));
  const frames = record ? [snapshot(0, bodies)] : [];
  let steps = 0;
  let on = bodies.filter((b) => !b.potted);
  const moving = () => on.some((b) => b.vx !== 0 || b.vz !== 0);
  while (moving()) {
    if (ctx.t >= MAX_TIME) {
      for (const b of bodies) { b.vx = 0; b.vz = 0; }
      break;
    }
    const pots = ctx.events.potted.length;
    step(on, dt, ctx);
    if (ctx.events.potted.length !== pots) on = on.filter((b) => !b.potted);
    ctx.t += dt;
    steps++;
    if (onStep) onStep(ctx.t, bodies);
    if (record && steps % every === 0) frames.push(snapshot(ctx.t, bodies));
  }
  settle(bodies);
  if (record) frames.push(snapshot(ctx.t, bodies));
  return { frames, events, balls: snapshot(ctx.t, bodies).balls, time: ctx.t };
}

// ── Referee ──
function referee(s, shot, sim) {
  const me = s.turn;
  const opp = 1 - me;
  const before = s.on;
  const first = sim.events.firstHit;
  const potted = sim.events.potted.map((p) => p.id);
  let nominated = null;
  let isOn;
  let onValue;
  if (before === 'red') {
    isOn = isRed;
    onValue = 1;
  } else if (before === 'colour') {
    nominated = COLOURS.includes(shot.target) ? shot.target : COLOURS.includes(first) ? first : null;
    isOn = (id) => id === nominated;
    onValue = nominated ? VALUES[nominated] : 4;
  } else {
    isOn = (id) => id === before;
    onValue = VALUES[before];
  }

  const reasons = [];
  const wrong = [];
  if (!first) reasons.push('missed every ball');
  else if (!isOn(first)) { reasons.push(`hit ${ballName(first)} first`); wrong.push(valueOf(first)); }
  if (sim.events.cuePotted) reasons.push('potted the cue ball');
  for (const id of potted) {
    if (id !== 'cue' && !isOn(id)) { reasons.push(`potted ${ballName(id)}`); wrong.push(valueOf(id)); }
  }
  const foul = reasons.length > 0;
  const foulPoints = foul ? Math.max(4, onValue, ...wrong) : 0;

  const balls = sim.balls.map((b) => ({ ...b }));
  const next = { ...s, balls, scores: s.scores.slice(), ballInHand: false };
  const endgame = before !== 'red' && before !== 'colour';
  // Colours come back unless legally potted in the final sequence; reds always stay down.
  const back = potted.filter((id) => COLOURS.includes(id) && (foul || !endgame));
  back.sort((a, b) => VALUES[b] - VALUES[a]).forEach((id) => respot(balls, id));
  const reds = redsLeft(balls);
  const lowest = COLOURS.find((c) => !find(balls, c).potted) ?? 'black';

  let scored = 0;
  let turnPasses = true;
  let message;
  let frameEnds = false;
  if (foul) {
    next.scores[opp] += foulPoints;
    next.on = reds ? 'red' : endgame ? before : lowest;
    message = `Foul: ${NAMES[me]} ${reasons.join(' and ')}. ${foulPoints} to ${NAMES[opp]}.`;
    frameEnds = before === 'black';
  } else {
    scored = potted.reduce((n, id) => n + valueOf(id), 0);
    turnPasses = scored === 0;
    next.scores[me] += scored;
    if (before === 'red') next.on = turnPasses ? 'red' : 'colour';
    else if (before === 'colour') next.on = reds ? 'red' : 'yellow';
    else next.on = turnPasses ? before : COLOURS[COLOURS.indexOf(before) + 1] ?? 'black';
    frameEnds = before === 'black' && !turnPasses;
    const what = isRed(potted[0] ?? '') ? (potted.length > 1 ? `${potted.length} reds` : 'Red') : `${(potted[0] ?? '').replace(/^./, (c) => c.toUpperCase())}`;
    message = turnPasses ? `No pot. ${NAMES[opp]} to play.` : `${what} down: ${scored} point${scored === 1 ? '' : 's'}.`;
  }
  next.turn = turnPasses ? opp : me;
  next.breakNo = turnPasses ? 0 : s.breakNo + scored;

  if (sim.events.cuePotted) {
    Object.assign(find(balls, 'cue'), freeDSpot(balls), { potted: false });
    next.ballInHand = true;
  }

  if (frameEnds) {
    if (next.scores[0] === next.scores[1]) {
      // Level: re-spot the black and the other player plays for it from the D.
      respot(balls, 'black');
      Object.assign(find(balls, 'cue'), freeDSpot(balls), { potted: false });
      Object.assign(next, { on: 'black', turn: opp, ballInHand: true, breakNo: 0 });
      message += ' Scores level: the black is re-spotted.';
    } else {
      next.over = true;
      next.winner = next.scores[0] > next.scores[1] ? 0 : 1;
      message += ` ${next.winner === 0 ? 'You win' : 'Emeka wins'} the frame ${next.scores[next.winner]}–${next.scores[1 - next.winner]}.`;
    }
  }
  next.message = message;
  return {
    state: next,
    outcome: { foul, foulPoints, potted, scored, turnPasses, message, reasons },
  };
}

// Plays a shot for whoever's turn it is: shot = { angle, power, spin = 0, target, place? }.
// `place: { x, z }` puts the cue ball in the D first (ball in hand), as chooseShot returns it.
export function takeShot(s, shot, options) {
  if (s.over) throw new Error('the frame is over');
  const start = shot.place ? placeCue(s, shot.place.x, shot.place.z) : s;
  const sim = simulate(start, shot, options);
  const { state, outcome } = referee(start, shot, sim);
  return { state, frames: sim.frames, events: sim.events, outcome };
}

// ── Aiming ──
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

const pathClear = (balls, ax, az, bx, bz, skip) =>
  live(balls).every((b) => skip.includes(b.id) || segDist(b.x, b.z, ax, az, bx, bz) >= 2 * R - 1e-6);

// Where the object ball should be sent for each pocket. Middle pockets are aimed a little past
// the cushion line so the ball goes in square rather than clipping the far jaw.
const aimPoint = (p) => (p.kind === 'middle' ? { x: p.x, z: p.z + Math.sign(p.z) * 0.02 } : p);

// Ghost-ball aim: the cue ball must arrive touching the object ball on the far side from the pocket.
// Returns the cue angle, the cut angle (radians, 0 = full ball) and whether the pot is on at all.
export function ghostAim(s, targetId, pocketIndex) {
  const cue = find(s.balls, 'cue');
  const obj = find(s.balls, targetId);
  const p = aimPoint(TABLE.pockets[pocketIndex]);
  const ox = p.x - obj.x;
  const oz = p.z - obj.z;
  const distPocket = Math.hypot(ox, oz);
  const ux = ox / distPocket;
  const uz = oz / distPocket;
  const gx = obj.x - 2 * R * ux;
  const gz = obj.z - 2 * R * uz;
  const cx = gx - cue.x;
  const cz = gz - cue.z;
  const distCue = Math.hypot(cx, cz) || 1e-9;
  const cut = Math.acos(Math.max(-1, Math.min(1, (cx * ux + cz * uz) / distCue)));
  const blocked =
    cut >= Math.PI / 2 - 0.02 ||
    Math.abs(gx) > HL - R + 1e-6 || Math.abs(gz) > HW - R + 1e-6 ||
    // a middle pocket only takes balls coming at it fairly square
    (TABLE.pockets[pocketIndex].kind === 'middle' && Math.abs(uz) < 0.55) ||
    !pathClear(s.balls, cue.x, cue.z, gx, gz, ['cue', targetId]) ||
    !pathClear(s.balls, obj.x, obj.z, p.x, p.z, ['cue', targetId]);
  return { angle: Math.atan2(cz, cx), cut, blocked, ghost: { x: gx, z: gz }, distCue, distPocket };
}

// ── Computer player ──
// Candidate pots come from the ghost-ball geometry, the best few are played out with the real
// physics and judged by the referee, and the winner gets some human aim error added.

// Distance a ball rolls before stopping from speed v (solves dv/dx = -(a + k·v) / v).
const rollDistance = (v) => v / DRAG - (ROLL_DECEL / DRAG ** 2) * Math.log(1 + (DRAG * v) / ROLL_DECEL);

// Launch speed that still has `arrive` m/s left after `dist` metres.
function launchSpeed(dist, arrive = 0) {
  const want = dist + rollDistance(arrive);
  let lo = 0;
  let hi = 20;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rollDistance(mid) < want) lo = mid; else hi = mid;
  }
  return hi;
}

const LEVELS = [
  // easy: rough aim, few options, sometimes just rolls at the nearest ball
  { aimError: 3.5, powerError: 0.12, maxCut: 55, pots: 3, powers: [1.8], nearest: 0.3, leave: 0, places: 2, safeties: 3 },
  { aimError: 1.2, powerError: 0.05, maxCut: 68, pots: 6, powers: [1.4, 2.2], nearest: 0, leave: 0.4, places: 4, safeties: 5 },
  // hard: precise, plays for position and leaves the opponent little
  { aimError: 0.4, powerError: 0.02, maxCut: 76, pots: 8, powers: [1.2, 1.7, 2.5], nearest: 0, leave: 1, places: 6, safeties: 8 },
];
const EVAL_DT = 1 / 120; // a coarser step is plenty for judging candidates
const BUDGET_MS = 320; // chooseShot must answer within 400 ms, even on a cold start

const D_PLACES = [[-0.06, 0], [-0.1, 0.1], [-0.1, -0.1], [-0.04, 0.18], [-0.04, -0.18], [-0.17, 0], [-0.15, 0.08], [-0.15, -0.08]];

// How inviting a pot is, 0..1: thin cuts and long distances make it harder.
const ease = (g) => Math.cos(g.cut) ** 2 / (1 + 0.6 * g.distCue + 0.9 * g.distPocket);

// The easiest pot available to whoever plays next (ball in hand counts as a fair chance).
function bestEase(s) {
  if (s.over) return 0;
  if (s.ballInHand) return 0.5;
  let best = 0;
  for (const id of legalTargets(s)) {
    for (let p = 0; p < 6; p++) {
      const g = ghostAim(s, id, p);
      if (!g.blocked && g.cut < 1.3) best = Math.max(best, ease(g));
    }
  }
  return best;
}

function rate(s, result, cfg) {
  const { state: next, outcome } = result;
  const me = s.turn;
  if (next.over) return next.winner === me ? 1000 : -1000;
  if (outcome.foul) return -10 - outcome.foulPoints;
  if (!outcome.turnPasses) return 4 + outcome.scored + cfg.leave * 4 * bestEase(next);
  return -cfg.leave * 4 * bestEase(next);
}

// Returns { angle, power, spin, target } for whoever is to play, plus `place: { x, z }` with ball
// in hand. Pass it straight to takeShot. `level`: 0 easy, 1 normal, 2 hard.
export function chooseShot(s, level = 1, random = Math.random) {
  if (s.over) return null;
  const cfg = LEVELS[Math.max(0, Math.min(2, level))];
  const started = performance.now();
  const targets = legalTargets(s);
  const places = s.ballInHand
    ? D_PLACES.map(([dx, dz]) => ({ x: BAULK_X + dx, z: dz })).filter((p) => inD(p.x, p.z) && isFree(s.balls, p.x, p.z, 'cue')).slice(0, cfg.places)
    : [null];
  if (!places.length) places.push(null);
  const from = (place) => (place ? placeCue(s, place.x, place.z) : s);
  const nominate = (id) => (s.on === 'colour' ? id : undefined);

  const finish = (pick) => {
    const shot = {
      angle: pick.angle + ((random() * 2 - 1) * cfg.aimError * Math.PI) / 180,
      power: Math.max(0.05, Math.min(1, pick.power * (1 + (random() * 2 - 1) * cfg.powerError))),
      spin: pick.spin ?? 0,
      target: pick.target,
    };
    if (pick.place) shot.place = pick.place;
    return shot;
  };

  // Easy sometimes just rolls up to the nearest ball it's allowed to hit.
  if (random() < cfg.nearest) {
    const st = from(places[0]);
    const cue = find(st.balls, 'cue');
    const near = targets.map((id) => find(st.balls, id)).sort((a, b) => Math.hypot(a.x - cue.x, a.z - cue.z) - Math.hypot(b.x - cue.x, b.z - cue.z))[0];
    return finish({ angle: Math.atan2(near.z - cue.z, near.x - cue.x), power: 0.3 + random() * 0.2, target: near.id, place: places[0] });
  }

  // Pot candidates from geometry, best first.
  const pots = [];
  for (const place of places) {
    const st = from(place);
    for (const id of targets) {
      for (let p = 0; p < 6; p++) {
        const g = ghostAim(st, id, p);
        if (g.blocked || g.cut > (cfg.maxCut * Math.PI) / 180) continue;
        const weight = ease(g) * (s.on === 'colour' ? 1 + 0.15 * VALUES[id] : 1);
        // enough pace for the object ball to drop with a little to spare
        const objSpeed = launchSpeed(g.distPocket, 0.3);
        const base = launchSpeed(g.distCue, objSpeed / (((1 + BALL_E) / 2) * Math.cos(g.cut))) / MAX_SPEED;
        pots.push({ place, target: id, angle: g.angle, base, weight });
      }
    }
  }
  pots.sort((a, b) => b.weight - a.weight);

  const potTries = [];
  for (const c of pots.slice(0, cfg.pots)) {
    for (const m of cfg.powers) potTries.push({ ...c, power: Math.min(1, c.base * m), bonus: c.weight });
  }
  // Safeties: full-ball and half-ball contacts on the nearest legal balls with a clear line, played
  // to run on a little after contact. Ball in hand tries each spot in the D in turn.
  const safeties = [];
  for (const place of places) {
    const st = from(place);
    const cue = find(st.balls, 'cue');
    const near = targets.map((id) => find(st.balls, id)).sort((a, b) => Math.hypot(a.x - cue.x, a.z - cue.z) - Math.hypot(b.x - cue.x, b.z - cue.z));
    for (const b of near) {
      const d = Math.hypot(b.x - cue.x, b.z - cue.z);
      const a = Math.atan2(b.z - cue.z, b.x - cue.x);
      // full ball, half ball and a thin contact either side
      for (const miss of [0, R, -R, 1.6 * R, -1.6 * R]) {
        const angle = a + Math.asin(Math.max(-1, Math.min(1, miss / d)));
        // the cue ball stops short of the object ball where they touch: check the line to there
        const reach = d * Math.cos(angle - a) - Math.sqrt(Math.max(0, 4 * R * R - miss * miss));
        const ex = cue.x + Math.cos(angle) * reach;
        const ez = cue.z + Math.sin(angle) * reach;
        if (!pathClear(st.balls, cue.x, cue.z, ex, ez, ['cue', b.id])) continue;
        safeties.push({ place, target: b.id, angle, power: Math.min(1, launchSpeed(d + 0.6) / MAX_SPEED), bonus: 0 });
      }
      if (safeties.length >= cfg.safeties) break;
    }
    if (safeties.length >= cfg.safeties) break;
  }
  // A couple of safeties go first so there's always a fallback even if time runs short.
  const tries = [...safeties.slice(0, 2), ...potTries, ...safeties.slice(2, cfg.safeties)];

  let best = null;
  let sims = 0;
  // Stop before a simulation that would likely overrun the budget, judging by the ones so far.
  const outOfTime = () => {
    const spent = performance.now() - started;
    return spent + (sims ? spent / sims : 0) > BUDGET_MS;
  };
  const judge = (c) => {
    sims++;
    const st = from(c.place);
    const shot = { angle: c.angle, power: c.power, target: nominate(c.target) };
    const result = referee(st, shot, simulate(st, shot, { dt: EVAL_DT, record: false }));
    const score = rate(s, result, cfg) + c.bonus;
    if (!best || score > best.score) best = { ...c, score };
  };
  for (const c of tries) {
    if (outOfTime()) break;
    judge(c);
  }
  // Nothing found that avoids a foul (snookered): sweep round the table, cushions included.
  for (let i = 0; (!best || best.score <= -10) && i < 24; i++) {
    if (outOfTime()) break;
    // no nomination: on a colour the first colour hit counts as nominated
    judge({ place: places[0], target: undefined, angle: (i / 24) * 2 * Math.PI, power: 0.5, bonus: 0 });
  }
  if (!best) best = { place: places[0], target: targets[0], angle: 0, power: 0.4 };
  return finish(best);
}
