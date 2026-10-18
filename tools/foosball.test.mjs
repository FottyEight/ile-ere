// Table football simulation tests: node tools/foosball.test.mjs
import assert from 'node:assert/strict';
import { newMatch, step, computerControl, PITCH, BALL_R } from '../src/foosball.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

// plays a whole match between two computer teams; returns the match and how long it took
function match(level0, level1, maxSeconds = 900) {
  const m = newMatch();
  const s0 = {};
  const s1 = {};
  const dt = 1 / 60;
  let t = 0;
  while (!m.over && t < maxSeconds) {
    computerControl(m, 0, level0, dt, s0);
    computerControl(m, 1, level1, dt, s1);
    step(m, dt);
    t += dt;
    const b = m.ball;
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z), 'ball position stays a number');
    assert.ok(Math.abs(b.z) <= PITCH.W / 2 + 1e-6, 'ball stays between the side walls');
    assert.ok(Math.abs(b.x) <= PITCH.L / 2 + BALL_R * 2 + 0.05, 'ball only leaves through a goal');
  }
  return { m, t };
}

test('rods are laid out 1-2-5-3 for each team, inside the pitch', () => {
  const m = newMatch();
  assert.equal(m.rods.length, 8);
  const men = (team) => m.rods.filter((r) => r.team === team).map((r) => r.offsets.length);
  assert.deepEqual(men(0), [1, 2, 5, 3]);
  assert.deepEqual(men(1).reverse(), [1, 2, 5, 3]);
  for (const r of m.rods) {
    assert.ok(r.travel > 0);
    for (const o of r.offsets) assert.ok(Math.abs(o) + r.travel <= PITCH.W / 2);
  }
});

test('a ball rolling straight into the goal mouth scores', () => {
  const m = newMatch();
  m.serveIn = 0;
  m.rods.forEach((r) => { r.slide = r.travel; }); // everyone out of the way
  m.rods.forEach((r) => { if (r.offsets.length === 1) r.slide = r.travel; });
  Object.assign(m.ball, { x: 0.3, z: 0, vx: 3, vz: 0 });
  // move goalies right out of line
  for (const r of m.rods) if (r.offsets.length === 1) r.offsets = [0.25];
  let goal = null;
  for (let i = 0; i < 120 && !goal; i++) goal = step(m, 1 / 60).find((e) => e.type === 'goal');
  assert.ok(goal, 'goal scored');
  assert.equal(goal.team, 0);
});

test('a ball hitting the end wall outside the mouth bounces back', () => {
  const m = newMatch();
  m.serveIn = 0;
  for (const r of m.rods) r.offsets = [];
  Object.assign(m.ball, { x: 0.4, z: 0.25, vx: 2, vz: 0 });
  for (let i = 0; i < 30; i++) step(m, 1 / 60);
  assert.ok(m.ball.vx < 0, 'rebounded');
  assert.deepEqual(m.score, [0, 0]);
});

test('whole computer-vs-computer matches finish with a winner on 5', () => {
  for (let g = 0; g < 6; g++) {
    const { m, t } = match(1, 1);
    assert.ok(m.over, `match ${g} finished (took ${Math.round(t)} s)`);
    assert.equal(Math.max(...m.score), 5);
  }
});

test('hard beats easy', () => {
  let hard = 0;
  for (let g = 0; g < 8; g++) if (match(0, 2).m.winner === 1) hard++;
  console.log('   hard vs easy:', hard, '/ 8');
  assert.ok(hard >= 6);
});

test('matches take a sensible time', () => {
  const times = [];
  for (let g = 0; g < 4; g++) times.push(match(1, 1).t);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log('   average match length:', Math.round(avg), 's');
  assert.ok(avg > 30 && avg < 600);
});

console.log(`\n${passed} tests passed`);
