// Table football: a small 2D simulation of the ball, the rods and the kicks, plus the computer
// player. No graphics here; foosballTable.js draws it.
//
// Coordinates are in metres on the pitch: x runs along the table (your goal at -x, Chidi's at
// +x), z runs across it (+z is your side of the table, where you stand). Each team has four
// rods (goalie 1, defence 2, midfield 5, attack 3) that slide across the pitch together.

export const PITCH = { L: 1.12, W: 0.62, goalW: 0.2 };
export const BALL_R = 0.017;
const MAN_R = 0.013; // the foot that touches the ball, as a circle
const REACH_X = 0.042; // how far in front of or behind its rod a man's swing reaches
const REACH_Z = 0.026;
const WIN = 5;

// rods from your goal to Chidi's: [team, men, spacing between men]
const LAYOUT = [
  [0, 1, 0], [0, 2, 0.24], [1, 3, 0.2], [0, 5, 0.12],
  [1, 5, 0.12], [0, 3, 0.2], [1, 2, 0.24], [1, 1, 0],
];

export function newMatch() {
  const step = PITCH.L / LAYOUT.length;
  const rods = LAYOUT.map(([team, men, gap], i) => {
    const offsets = Array.from({ length: men }, (_, m) => (m - (men - 1) / 2) * gap);
    // how far the rod can slide before its end man hits a wall
    const travel = PITCH.W / 2 - 0.03 - Math.max(...offsets.map(Math.abs));
    return { team, x: -PITCH.L / 2 + step * (i + 0.5), offsets, travel, slide: 0, speed: 0, kick: 0, kicked: new Set() };
  });
  return {
    rods,
    ball: { x: 0, z: 0, vx: 0, vz: 0, spin: 0 },
    score: [0, 0],
    over: false,
    winner: null,
    serveIn: 0.6,
    servingTo: Math.random() < 0.5 ? 0 : 1,
    stillFor: 0,
    time: 0,
  };
}

// The ball is dropped in at the centre, rolling gently towards one side.
function serve(m) {
  const b = m.ball;
  b.x = 0;
  b.z = (Math.random() - 0.5) * 0.1;
  b.vx = (m.servingTo === 0 ? -1 : 1) * (0.15 + Math.random() * 0.1);
  b.vz = (Math.random() - 0.5) * 0.5;
  m.stillFor = 0;
}

// Moves a team's rods towards a slide target (-1 .. 1 of each rod's travel), at a limited speed.
function slideRods(m, team, target, maxSpeed, dt) {
  for (const r of m.rods) {
    if (r.team !== team) continue;
    const want = Math.max(-1, Math.min(1, target)) * r.travel;
    const d = want - r.slide;
    const stepMax = maxSpeed * dt;
    const move = Math.max(-stepMax, Math.min(stepMax, d));
    r.speed = move / dt;
    r.slide += move;
  }
}

export function kick(m, team) {
  for (const r of m.rods) {
    if (r.team === team && r.kick <= 0) {
      r.kick = 0.22;
      r.kicked.clear();
    }
  }
}

// One rod at a time for the computer: each rod lines its nearest man up with where the ball
// will be, and kicks when it's in reach. `level` 0–2 sets speed, accuracy and reactions.
export function computerControl(m, team, level, dt, state) {
  const b = m.ball;
  const speed = [0.55, 0.9, 1.35][level];
  const noise = [0.05, 0.025, 0.01][level];
  state.wobble = (state.wobble ?? 0) + (Math.random() - 0.5) * noise * dt * 20;
  state.wobble *= 0.96;
  // aim with the rod nearest the ball (in front of it), the others follow the same slide
  const mine = m.rods.filter((r) => r.team === team);
  let best = mine[0];
  for (const r of mine) if (Math.abs(r.x - b.x) < Math.abs(best.x - b.x)) best = r;
  // where will the ball cross that rod?
  let zAt = b.z;
  if (Math.abs(b.vx) > 0.05) {
    const t = (best.x - b.x) / b.vx;
    if (t > 0 && t < 0.6) zAt = b.z + b.vz * t;
  }
  zAt = Math.max(-PITCH.W / 2, Math.min(PITCH.W / 2, zAt)) + state.wobble;
  // pick the man on that rod closest to the ball and slide so he's on it
  let target = best.slide;
  let bestGap = Infinity;
  for (const off of best.offsets) {
    const s = zAt - off;
    if (Math.abs(s) <= best.travel + 0.02 && Math.abs(s - best.slide) < bestGap) {
      bestGap = Math.abs(s - best.slide);
      target = s;
    }
  }
  slideRods(m, team, target / best.travel, speed, dt);
  // kick when a man can reach the ball (with a reaction delay on easier levels)
  state.react = (state.react ?? 0) - dt;
  for (const r of mine) {
    if (Math.abs(b.x - r.x) > REACH_X) continue;
    if (!r.offsets.some((o) => Math.abs(b.z - (r.slide + o)) < REACH_Z)) continue;
    if (state.react <= 0) {
      if (Math.random() < [0.55, 0.8, 0.97][level]) kick(m, team);
      state.react = [0.45, 0.25, 0.12][level];
    }
  }
}

// Your rods: `target` is where you've put them (-1 .. 1). They follow quickly but not instantly.
export function playerControl(m, target, dt) {
  slideRods(m, 0, target, 1.9, dt);
}

// Advances the match by dt seconds (in small steps). Returns events: goals and kicks.
export function step(m, dt) {
  const events = [];
  const n = Math.ceil(dt / (1 / 240));
  const h = dt / n;
  for (let i = 0; i < n && !m.over; i++) stepOnce(m, h, events);
  return events;
}

function stepOnce(m, h, events) {
  m.time += h;
  const b = m.ball;
  if (m.serveIn > 0) {
    m.serveIn -= h;
    if (m.serveIn <= 0) serve(m);
    else return;
  }
  for (const r of m.rods) if (r.kick > 0) r.kick -= h;

  // rolling friction
  const k = Math.max(0, 1 - 0.45 * h);
  b.vx *= k;
  b.vz *= k;
  b.x += b.vx * h;
  b.z += b.vz * h;

  // side walls
  const zLim = PITCH.W / 2 - BALL_R;
  if (b.z > zLim) { b.z = zLim; b.vz = -Math.abs(b.vz) * 0.8; }
  if (b.z < -zLim) { b.z = -zLim; b.vz = Math.abs(b.vz) * 0.8; }

  // ends: a goal if it's in the mouth, otherwise it bounces back
  const xLim = PITCH.L / 2 - BALL_R;
  if (Math.abs(b.x) > xLim) {
    if (Math.abs(b.z) < PITCH.goalW / 2 - BALL_R * 0.5) {
      if (Math.abs(b.x) > PITCH.L / 2 + BALL_R) {
        const scorer = b.x > 0 ? 0 : 1; // past Chidi's end = your goal
        m.score[scorer]++;
        events.push({ type: 'goal', team: scorer, score: [...m.score] });
        if (m.score[scorer] >= WIN) {
          m.over = true;
          m.winner = scorer;
          events.push({ type: 'win', team: scorer });
        } else {
          m.servingTo = 1 - scorer; // the team that let it in gets the ball
          m.serveIn = 1.4;
        }
        b.vx = b.vz = 0;
        return;
      }
    } else {
      b.x = Math.sign(b.x) * xLim;
      b.vx = -b.vx * 0.75;
    }
  }

  // the men: kicks first, then plain bumps
  for (const r of m.rods) {
    if (Math.abs(b.x - r.x) > REACH_X + BALL_R) continue;
    const dir = r.team === 0 ? 1 : -1;
    r.offsets.forEach((off, mi) => {
      const mz = r.slide + off;
      // a swinging foot sends the ball away (once per swing)
      if (r.kick > 0.08 && !r.kicked.has(mi) && Math.abs(b.x - r.x) < REACH_X && Math.abs(b.z - mz) < REACH_Z) {
        r.kicked.add(mi);
        const power = 2.0 + Math.random() * 0.7;
        b.vx = dir * power;
        b.vz = (b.z - mz) * 22 + r.speed * 0.45 + (Math.random() - 0.5) * 0.3;
        b.x = r.x + dir * (MAN_R + BALL_R + 0.002);
        events.push({ type: 'kick', team: r.team });
        return;
      }
      // a still foot is an obstacle
      const dx = b.x - r.x;
      const dz = b.z - mz;
      const d = Math.hypot(dx, dz);
      const min = MAN_R + BALL_R;
      if (d < min && d > 1e-6) {
        const nx = dx / d;
        const nz = dz / d;
        b.x = r.x + nx * min;
        b.z = mz + nz * min;
        const rel = (b.vx * nx + (b.vz - r.speed) * nz);
        if (rel < 0) {
          b.vx -= 1.5 * rel * nx;
          b.vz -= 1.5 * rel * nz;
        }
        b.vz += r.speed * 0.3;
      }
    });
  }

  // a dead ball out of everyone's reach gets nudged back into play
  const speed = Math.hypot(b.vx, b.vz);
  m.stillFor = speed < 0.03 ? m.stillFor + h : 0;
  if (m.stillFor > 2.5) {
    b.vx = -Math.sign(b.x || 1) * 0.3;
    b.vz = (Math.random() - 0.5) * 0.3;
    m.stillFor = 0;
    events.push({ type: 'nudge' });
  }
}
