// Physics, rules and AI tests: node tools/snooker.test.mjs
import assert from 'node:assert/strict';
import { TABLE, newFrame, legalTargets, placeCue, simulate, takeShot, chooseShot, ghostAim } from '../src/snooker.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

const { r: R, L, W } = TABLE;
const HL = L / 2;
const HW = W / 2;
const ball = (s, id) => s.balls.find((b) => b.id === id);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const aim = (from, to) => Math.atan2(to[1] - from[1], to[0] - from[0]);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// A position with only the listed balls on the table: spec = { id: [x, z] }.
function setup(spec, extra = {}) {
  const s = newFrame();
  const balls = s.balls.map((b) => (b.id in spec ? { ...b, x: spec[b.id][0], z: spec[b.id][1], potted: false } : { ...b, potted: true }));
  return { ...s, balls, ballInHand: false, message: '', ...extra };
}

// A cue position `back` metres behind `obj` on the line from the pocket through it: a dead-straight pot.
function straight(obj, pocket, back = 0.25) {
  const p = TABLE.pockets[pocket];
  const d = Math.hypot(p.x - obj[0], p.z - obj[1]);
  return [obj[0] - ((p.x - obj[0]) / d) * back, obj[1] - ((p.z - obj[1]) / d) * back];
}

// Seeded random so the AI tests are repeatable.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noOverlaps = (balls) => {
  const on = balls.filter((b) => !b.potted);
  for (let i = 0; i < on.length; i++) {
    for (let j = i + 1; j < on.length; j++) assert.ok(dist(on[i], on[j]) >= 2 * R - 1e-6, `${on[i].id} overlaps ${on[j].id}`);
  }
};

// Every ball not yet potted is on the cloth: inside the cushions, or in a pocket mouth.
const onTable = (b) => {
  if (b.potted) return true;
  if (Math.abs(b.x) <= HL - R + 1e-6 && Math.abs(b.z) <= HW - R + 1e-6) return true;
  return Math.abs(b.x) <= HL && Math.abs(b.z) <= HW && TABLE.pockets.some((p) => dist(b, p) < 0.12);
};

// A mid-frame position: some reds scattered, colours on their spots, cue somewhere free.
function randomPosition(random) {
  const s = newFrame();
  const reds = 2 + Math.floor(random() * 9);
  const placed = s.balls.filter((b) => !b.id.startsWith('red') && b.id !== 'cue').map((b) => ({ ...b }));
  const free = (x, z) => placed.every((b) => Math.hypot(b.x - x, b.z - z) > 2 * R + 0.01);
  const drop = (id) => {
    for (;;) {
      const x = (random() * 2 - 1) * (HL - R - 0.01);
      const z = (random() * 2 - 1) * (HW - R - 0.01);
      if (free(x, z) && TABLE.pockets.every((p) => Math.hypot(p.x - x, p.z - z) > 0.12)) return placed.push({ id, x, z, potted: false });
    }
  };
  for (let i = 0; i < 15; i++) {
    if (i < reds) drop(`red${i}`);
    else placed.push({ id: `red${i}`, x: 0, z: 0, potted: true });
  }
  drop('cue');
  const order = s.balls.map((b) => b.id);
  placed.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { ...s, balls: placed, ballInHand: false, turn: 1, on: random() < 0.6 ? 'red' : 'colour' };
}

// Kinetic energy (equal unit masses) from the bodies the simulator hands to onStep.
const energy = (bodies) => bodies.reduce((e, b) => e + (b.potted ? 0 : b.vx * b.vx + b.vz * b.vz), 0);

// ── Layout ──

test('new frame: 22 balls, none touching, reds racked behind the pink, colours on their spots', () => {
  const s = newFrame();
  assert.equal(s.balls.length, 22);
  assert.equal(s.balls.filter((b) => b.id.startsWith('red')).length, 15);
  noOverlaps(s.balls);
  const reds = s.balls.filter((b) => b.id.startsWith('red'));
  const apex = reds.reduce((a, b) => (b.x < a.x ? b : a));
  assert.ok(near(apex.x, 0.62 + 2 * R + 0.002) && near(apex.z, 0));
  for (const r of reds) {
    assert.ok(r.x >= apex.x - 1e-9 && r.x < ball(s, 'black').x - 2 * R, `${r.id} is in the triangle`);
    assert.ok(Math.abs(r.z) <= (r.x - apex.x) / Math.sqrt(3) + 1e-6, `${r.id} is inside the triangle`);
  }
  for (const c of ['yellow', 'green', 'brown', 'blue', 'pink', 'black']) {
    assert.deepEqual([ball(s, c).x, ball(s, c).z], [TABLE.spots[c].x, TABLE.spots[c].z]);
  }
  const cue = ball(s, 'cue');
  assert.ok(Math.hypot(cue.x - TABLE.baulkX, cue.z) <= TABLE.dRadius && cue.x < TABLE.baulkX, 'cue starts in the D');
  assert.equal(s.turn, 0);
  assert.equal(s.ballInHand, true);
  assert.equal(s.on, 'red');
  assert.deepEqual(legalTargets(s).length, 15);
});

test('placeCue only allows free spots inside the D', () => {
  const s = newFrame();
  const t = placeCue(s, TABLE.baulkX - 0.1, -0.05);
  assert.ok(near(ball(t, 'cue').x, TABLE.baulkX - 0.1));
  assert.equal(ball(s, 'cue').x, -0.85, 'input untouched');
  assert.throws(() => placeCue(s, TABLE.baulkX + 0.05, 0)); // past the baulk line
  assert.throws(() => placeCue(s, TABLE.baulkX - 0.1, 0.21)); // outside the semicircle
  assert.throws(() => placeCue(s, TABLE.baulkX - 0.02, 0.01)); // on top of the brown
  assert.throws(() => placeCue({ ...s, ballInHand: false }, -0.85, 0));
});

// ── Physics ──

test('a straight shot pots the object ball in the aimed pocket', () => {
  for (const [obj, pocket] of [[[0.9, 0.3], 5], [[-0.6, -0.3], 0], [[0.15, 0.25], 4], [[-0.3, -0.4], 1]]) {
    const cue = straight(obj, pocket);
    const s = setup({ cue, red0: obj });
    const { events } = simulate(s, { angle: aim(cue, obj), power: 0.35 });
    assert.equal(events.firstHit, 'red0');
    assert.deepEqual(events.potted.map((p) => [p.id, p.pocket]), [['red0', pocket]]);
    assert.equal(events.cuePotted, false);
  }
});

test('ghostAim cut shots go in too', () => {
  const s = setup({ cue: [0.0, 0.1], red0: [0.7, 0.2] });
  const g = ghostAim(s, 'red0', 5);
  assert.equal(g.blocked, false);
  assert.ok(g.cut > 0.3 && g.cut < 0.8, `a real cut: ${g.cut.toFixed(2)} rad`);
  const { events } = simulate(s, { angle: g.angle, power: 0.6 });
  assert.equal(events.potted[0]?.id, 'red0');
  assert.equal(events.potted[0].pocket, 5);
  // a ball in the way blocks the pot
  const blocked = setup({ cue: [0.0, 0.1], red0: [0.7, 0.2], red1: [0.95, 0.42] });
  assert.equal(ghostAim(blocked, 'red0', 5).blocked, true);
});

test('a ball rolled up the table loses energy and stops a sensible distance away', () => {
  const s = setup({ cue: [-1.2, 0] });
  const r = simulate(s, { angle: 0, power: 1 / 3 }); // 2 m/s
  const end = ball(r, 'cue');
  const travelled = (HL - R - -1.2) + (HL - R - end.x); // up to the top cushion and back
  assert.ok(travelled > 2.2 && travelled < 4, `2 m/s travels ${travelled.toFixed(2)} m`);
  assert.equal(r.events.cushions.length, 1);
});

test('full-power breaks and random shots: energy never rises, everything stops, nothing leaves the table', () => {
  const random = rng(7);
  const shots = [];
  const s = newFrame();
  // break off the side of the pack, then a straight smash into it, then random shots
  shots.push([placeCue(s, -0.85, 0.16), { angle: aim([-0.85, 0.16], [0.857, 0.106 + 1.4 * R]), power: 1 }]);
  shots.push([setup(Object.fromEntries(s.balls.filter((b) => b.id !== 'pink' && b.id !== 'blue' && b.id !== 'brown').map((b) => [b.id, [b.x, b.id === 'cue' ? 0 : b.z]]))), { angle: 0, power: 1 }]);
  for (let i = 0; i < 25; i++) shots.push([randomPosition(random), { angle: random() * 2 * Math.PI, power: 0.3 + random() * 0.7 }]);
  let longest = 0;
  for (const [state, shot] of shots) {
    let last = Infinity;
    const r = simulate(state, shot, {
      onStep: (t, bodies) => {
        const e = energy(bodies);
        assert.ok(e <= last + 1e-9, `energy rose at t=${t.toFixed(3)}: ${last} -> ${e}`);
        last = e;
      },
    });
    assert.ok(r.time < 30, 'came to rest by itself');
    longest = Math.max(longest, r.time);
    for (const f of r.frames) for (const b of f.balls) assert.ok(onTable(b), `${b.id} off the table at (${b.x.toFixed(3)}, ${b.z.toFixed(3)})`);
    noOverlaps(r.balls);
    assert.ok(r.frames.length >= 2 && r.frames[0].t === 0);
    assert.ok(r.frames.every((f, i) => i === 0 || f.t >= r.frames[i - 1].t));
  }
  console.log('   longest shot:', longest.toFixed(1), 's');
});

test('a 6 m/s cue ball cannot tunnel through a ball', () => {
  for (let k = 0; k < 20; k++) {
    const z = -0.04 + k * 0.004; // every offset that should touch the red
    const s = setup({ cue: [-1.1, z], red0: [0.4, 0] });
    const { events } = simulate(s, { angle: 0, power: 1 }, { record: false });
    assert.equal(events.firstHit, Math.abs(z) < 2 * R ? 'red0' : null, `offset ${z.toFixed(3)}`);
  }
});

test('top spin follows through, back spin draws the cue ball back', () => {
  // soft enough that the red never comes back off the top cushion
  const s = setup({ cue: [-0.9, 0.1], red0: [-0.5, 0.1] });
  const plain = ball(simulate(s, { angle: 0, power: 0.25 }), 'cue').x;
  const follow = ball(simulate(s, { angle: 0, power: 0.25, spin: 1 }), 'cue').x;
  const draw = ball(simulate(s, { angle: 0, power: 0.25, spin: -1 }), 'cue').x;
  assert.ok(Math.abs(plain - (-0.5 - 2 * R)) < 0.05, `a plain straight hit stops dead: ${plain.toFixed(2)}`);
  assert.ok(follow > plain + 0.3, `follow ${follow.toFixed(2)} vs ${plain.toFixed(2)}`);
  assert.ok(draw < plain - 0.3, `draw comes back to ${draw.toFixed(2)}`);
});

test('the break spreads the pack without anything flying off', () => {
  const s = placeCue(newFrame(), -0.85, 0.16);
  const { balls, events, frames } = simulate(s, { angle: aim([-0.85, 0.16], [0.857, 0.106 + 1.4 * R]), power: 0.8 });
  assert.ok(events.firstHit.startsWith('red'));
  const moved = balls.filter((b) => b.id.startsWith('red') && dist(b, ball(s, b.id)) > 0.05).length;
  assert.ok(moved >= 5, `${moved} reds moved`);
  for (const f of frames) for (const b of f.balls) assert.ok(onTable(b), b.id);
});

// ── Rules ──

test('potting the cue ball is a foul: 4 to the opponent, ball in hand in the D', () => {
  const s = setup({ cue: [1.1, 0.5], red0: [-0.5, 0] });
  const { state, outcome } = takeShot(s, { angle: aim([1.1, 0.5], [1.3, 0.7]), power: 0.3 });
  assert.equal(outcome.foul, true);
  assert.equal(outcome.foulPoints, 4);
  assert.ok(outcome.potted.includes('cue'));
  assert.deepEqual(state.scores, [0, 4]);
  assert.equal(state.turn, 1);
  assert.equal(state.ballInHand, true);
  const cue = ball(state, 'cue');
  assert.equal(cue.potted, false);
  assert.ok(Math.hypot(cue.x - TABLE.baulkX, cue.z) <= TABLE.dRadius && cue.x <= TABLE.baulkX);
  assert.ok(state.message.startsWith('Foul'));
});

test('hitting a colour first when on a red is a foul worth the higher value', () => {
  const s = setup({ cue: [-0.3, 0], black: [0.3, 0], green: [0.3, 0.4], red0: [-0.5, 0.5] });
  const black = takeShot(s, { angle: 0, power: 0.3 });
  assert.equal(black.outcome.foul, true);
  assert.equal(black.outcome.foulPoints, 7);
  assert.deepEqual(black.state.scores, [0, 7]);
  assert.equal(black.state.turn, 1);
  assert.equal(black.state.ballInHand, false);
  const green = takeShot(s, { angle: aim([-0.3, 0], [0.3, 0.4]), power: 0.3 });
  assert.equal(green.outcome.foulPoints, 4); // max(4, red 1, green 3)
  const nothing = takeShot(s, { angle: Math.PI, power: 0.05 });
  assert.equal(nothing.outcome.foul, true); // missed everything
  assert.equal(nothing.outcome.foulPoints, 4);
});

test('red then a nominated colour: both score, the colour is re-spotted, back on reds', () => {
  const cue = straight([0.9, 0.3], 5);
  const s = setup({ cue, red0: [0.9, 0.3], red1: [-0.6, 0.4], pink: [0.62, 0], black: [1.05, 0] });
  const first = takeShot(s, { angle: aim(cue, [0.9, 0.3]), power: 0.35 });
  assert.equal(first.outcome.foul, false);
  assert.deepEqual(first.state.scores, [1, 0]);
  assert.equal(first.state.turn, 0);
  assert.equal(first.state.on, 'colour');
  assert.equal(first.state.breakNo, 1);
  assert.deepEqual(legalTargets(first.state), ['pink', 'black']);

  // Move the pink to a straight pot and nominate it.
  const pinkAt = [0.3, -0.35];
  const cue2 = straight(pinkAt, 2);
  const s2 = { ...first.state, balls: first.state.balls.map((b) => (b.id === 'pink' ? { ...b, x: pinkAt[0], z: pinkAt[1] } : b.id === 'cue' ? { ...b, x: cue2[0], z: cue2[1] } : b)) };
  const second = takeShot(s2, { angle: aim(cue2, pinkAt), power: 0.35, target: 'pink' });
  assert.equal(second.outcome.foul, false);
  assert.deepEqual(second.outcome.potted, ['pink']);
  assert.deepEqual(second.state.scores, [7, 0]);
  assert.equal(second.state.breakNo, 7);
  assert.equal(second.state.turn, 0);
  assert.equal(second.state.on, 'red');
  const pink = ball(second.state, 'pink');
  assert.deepEqual([pink.x, pink.z, pink.potted], [0.62, 0, false]);

  // Nominating the pink but hitting the black first is a foul worth 7.
  const wrong = takeShot({ ...s2, balls: s2.balls.map((b) => (b.id === 'black' ? { ...b, x: (cue2[0] + pinkAt[0]) / 2, z: (cue2[1] + pinkAt[1]) / 2 } : b)) }, { angle: aim(cue2, pinkAt), power: 0.35, target: 'pink' });
  assert.equal(wrong.outcome.foul, true);
  assert.equal(wrong.outcome.foulPoints, 7);
});

test('a colour whose spot is taken goes on the highest free spot', () => {
  const pinkAt = [0.3, -0.35];
  const cue = straight(pinkAt, 2);
  const s = setup({ cue, pink: pinkAt, red0: [0.62, 0], black: [1.05, 0], blue: [0, 0], brown: [-0.75, 0], red1: [-0.4, 0.5] }, { on: 'colour' });
  const { state } = takeShot(s, { angle: aim(cue, pinkAt), power: 0.35, target: 'pink' });
  // pink spot has a red on it; black, blue and brown are on theirs: green is the highest free spot
  const pink = ball(state, 'pink');
  assert.deepEqual([pink.x, pink.z], [TABLE.spots.green.x, TABLE.spots.green.z]);
});

test('a colour potted on a foul comes back; a red potted on a foul stays down', () => {
  const cue = straight([0.9, 0.3], 5);
  // on a red, the cue hits the blue first, which is potted: foul, blue re-spotted
  const s = setup({ cue, blue: [0.9, 0.3], red0: [-0.5, 0.4] });
  const { state, outcome } = takeShot(s, { angle: aim(cue, [0.9, 0.3]), power: 0.35 });
  assert.equal(outcome.foul, true);
  assert.equal(outcome.foulPoints, 5);
  assert.deepEqual([ball(state, 'blue').x, ball(state, 'blue').z, ball(state, 'blue').potted], [0, 0, false]);
  // on a colour, a red goes in instead: foul, red stays down
  const s2 = setup({ cue, red0: [0.9, 0.3], red1: [-0.5, 0.4], pink: [0.62, 0] }, { on: 'colour' });
  const r2 = takeShot(s2, { angle: aim(cue, [0.9, 0.3]), power: 0.35, target: 'pink' });
  assert.equal(r2.outcome.foul, true);
  assert.equal(r2.outcome.foulPoints, 6);
  assert.equal(ball(r2.state, 'red0').potted, true);
  assert.equal(r2.state.on, 'red');
});

test('after the last red and its colour, the colours must go in order and stay down', () => {
  const cue = straight([0.9, 0.3], 5);
  const all = { yellow: [-0.75, 0.22], green: [-0.75, -0.22], brown: [-0.75, 0], blue: [0, 0], pink: [0.62, 0], black: [1.05, 0] };
  const last = takeShot(setup({ cue, red0: [0.9, 0.3], ...all }), { angle: aim(cue, [0.9, 0.3]), power: 0.35 });
  assert.equal(last.state.on, 'colour');
  // the colour after the last red is still re-spotted
  const blueAt = [0.4, 0.3];
  const cue2 = straight(blueAt, 5);
  const s2 = { ...last.state, balls: last.state.balls.map((b) => (b.id === 'blue' ? { ...b, x: blueAt[0], z: blueAt[1] } : b.id === 'cue' ? { ...b, x: cue2[0], z: cue2[1] } : b)) };
  const after = takeShot(s2, { angle: aim(cue2, blueAt), power: 0.35, target: 'blue' });
  assert.equal(ball(after.state, 'blue').potted, false);
  assert.equal(after.state.on, 'yellow');
  assert.deepEqual(legalTargets(after.state), ['yellow']);

  // yellow is on: potting it scores 2, it stays down, green is next
  const yellowAt = [0.9, 0.3];
  const s3 = setup({ cue, ...all, yellow: yellowAt }, { on: 'yellow' });
  const pot = takeShot(s3, { angle: aim(cue, yellowAt), power: 0.35 });
  assert.equal(pot.outcome.foul, false);
  assert.equal(pot.outcome.scored, 2);
  assert.equal(ball(pot.state, 'yellow').potted, true);
  assert.equal(pot.state.on, 'green');
  assert.equal(pot.state.turn, 0);
  // potting the black while on the yellow is a foul and the black comes back
  const s4 = setup({ cue, ...all, black: yellowAt }, { on: 'yellow' });
  const foul = takeShot(s4, { angle: aim(cue, yellowAt), power: 0.35 });
  assert.equal(foul.outcome.foul, true);
  assert.equal(foul.outcome.foulPoints, 7);
  assert.deepEqual([ball(foul.state, 'black').x, ball(foul.state, 'black').potted], [1.05, false]);
  assert.equal(foul.state.on, 'yellow');
});

test('the frame ends on the final black; level scores re-spot it', () => {
  const cue = straight([0.9, 0.3], 5);
  const s = setup({ cue, black: [0.9, 0.3] }, { on: 'black' });
  const shot = { angle: aim(cue, [0.9, 0.3]), power: 0.35 };
  const win = takeShot({ ...s, scores: [20, 10] }, shot).state;
  assert.equal(win.over, true);
  assert.equal(win.winner, 0);
  assert.deepEqual(win.scores, [27, 10]);
  const lose = takeShot({ ...s, scores: [10, 20] }, shot).state;
  assert.equal(lose.over, true);
  assert.equal(lose.winner, 1);
  // a foul on the last black ends it too
  const foul = takeShot({ ...s, scores: [10, 12] }, { angle: Math.PI / 2, power: 0.05 }).state;
  assert.equal(foul.over, true);
  assert.deepEqual(foul.scores, [10, 19]);
  assert.equal(foul.winner, 1);
  // level: the black is re-spotted and the other player has it from the D
  const tie = takeShot({ ...s, scores: [13, 20] }, shot).state;
  assert.equal(tie.over, false);
  assert.deepEqual(tie.scores, [20, 20]);
  assert.equal(tie.on, 'black');
  assert.equal(tie.turn, 1);
  assert.equal(tie.ballInHand, true);
  assert.deepEqual([ball(tie, 'black').x, ball(tie, 'black').potted], [1.05, false]);
  assert.throws(() => takeShot(win, shot));
});

test('a miss passes the turn without points', () => {
  const s = setup({ cue: [-0.5, 0], red0: [0.3, 0] });
  const { state, outcome } = takeShot(s, { angle: 0, power: 0.2 });
  assert.equal(outcome.foul, false);
  assert.equal(outcome.turnPasses, true);
  assert.equal(state.turn, 1);
  assert.deepEqual(state.scores, [0, 0]);
});

test('takeShot and chooseShot never mutate their input', () => {
  const s = newFrame();
  const before = JSON.stringify(s);
  takeShot(s, { angle: 0.05, power: 0.8 });
  chooseShot(s, 1, rng(3));
  assert.equal(JSON.stringify(s), before);
  const mid = randomPosition(rng(9));
  const midBefore = JSON.stringify(mid);
  takeShot(mid, chooseShot(mid, 2, rng(4)));
  assert.equal(JSON.stringify(mid), midBefore);
});

// ── Computer player ──

test('chooseShot avoids fouls in most mid-frame positions, within the time limit', () => {
  const random = rng(11);
  for (const level of [0, 1, 2]) {
    let fouls = 0;
    let slowest = 0;
    const n = 30;
    for (let i = 0; i < n; i++) {
      let s = randomPosition(random);
      if (i % 5 === 0) s = { ...s, ballInHand: true, balls: s.balls.map((b) => (b.id === 'cue' ? { ...b, x: -0.85, z: 0.08 } : b)) };
      if (!s.balls.every((b) => b.id === 'cue' || b.potted || Math.hypot(b.x + 0.85, b.z - 0.08) > 2 * R)) continue;
      const t = performance.now();
      const shot = chooseShot(s, level, random);
      slowest = Math.max(slowest, performance.now() - t);
      if (s.ballInHand) assert.ok(shot.place, 'ball in hand returns a placement');
      if (takeShot(s, shot).outcome.foul) fouls++;
    }
    console.log(`   level ${level}: ${fouls} fouls in ${n}, slowest ${Math.round(slowest)} ms`);
    assert.ok(fouls <= (level === 0 ? n * 0.4 : n * 0.25));
    assert.ok(slowest < 400);
  }
});

test('hard scores more than easy over the same visits to the table', () => {
  const visit = (s, level, random) => {
    let points = 0;
    for (let shots = 0; shots < 8 && !s.over; shots++) {
      const me = s.turn;
      const { state, outcome } = takeShot(s, chooseShot(s, level, random));
      points += outcome.foul ? -outcome.foulPoints : outcome.scored;
      s = state;
      if (s.turn !== me) break;
    }
    return points;
  };
  const total = [0, 0];
  const positions = rng(21);
  for (let i = 0; i < 16; i++) {
    const s = randomPosition(positions);
    total[0] += visit(s, 0, rng(100 + i));
    total[1] += visit(s, 2, rng(100 + i));
  }
  console.log('   points: easy', total[0], 'hard', total[1]);
  assert.ok(total[1] > total[0]);
});

console.log(`\n${passed} tests passed`);
