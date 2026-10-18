// Rule tests: node tools/ludo.test.mjs
import assert from 'node:assert/strict';
import { newGame, roll, move, legalMoves, locate, chooseMove, FINISHED, BASE } from '../src/ludo.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

// Seeded generator so the simulated games are the same on every run.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A game with chosen token positions, rolled with `value` for whoever's turn it is.
function position(tokens, value, { turn = 0, ...options } = {}) {
  const s = newGame({ colours: [0, 1, 2], ...options });
  for (const c of s.colours) s.tokens[c] = tokens[c] ?? [BASE, BASE, BASE, BASE];
  s.turn = turn;
  return value ? roll(s, Math.random, value) : { state: s, events: [] };
}
const types = (events) => events.map((e) => e.type);

test('a token needs a 6 to leave base', () => {
  const s = newGame();
  const five = roll(s, Math.random, 5);
  assert.deepEqual(types(five.events), ['roll', 'noMove', 'turn']);
  assert.equal(five.state.turn, 1);
  const six = roll(s, Math.random, 6);
  assert.equal(six.state.phase, 'move');
  const moves = legalMoves(six.state);
  assert.equal(moves.length, 4);
  assert.ok(moves.every((m) => m.enters && m.from === -1 && m.to === 0));
  const { state, events } = move(six.state, 2);
  assert.equal(state.tokens[0][2], 0);
  assert.deepEqual(events[0].path, [0]);
});

test('each colour enters on its own start square', () => {
  for (const c of [0, 1, 2, 3]) {
    assert.deepEqual(locate(c, 0, 0), { kind: 'track', index: 13 * c });
  }
  assert.deepEqual(locate(1, 0), { kind: 'track', index: 13 });
});

test('every colour turns the corner into its home column', () => {
  for (const c of [0, 1, 2, 3]) {
    const others = [0, 1, 2, 3].filter((x) => x !== c).slice(0, 2);
    const s = newGame({ colours: [c, ...others] });
    s.tokens[c] = [48, BASE, BASE, BASE];
    s.turn = c;
    const { state, events } = move(roll(s, Math.random, 5).state, 0);
    assert.deepEqual(events[0].path, [49, 50, 51, 52, 53]);
    assert.deepEqual(events[0].path.map((p) => locate(c, p)), [
      { kind: 'track', index: (13 * c + 49) % 52 },
      { kind: 'track', index: (13 * c + 50) % 52 },
      { kind: 'home', step: 0 },
      { kind: 'home', step: 1 },
      { kind: 'home', step: 2 },
    ]);
    assert.equal(state.tokens[c][0], 53);
  }
  // the last track square sits at the end of the colour's own arm, two before its start
  assert.deepEqual(locate(0, 50), { kind: 'track', index: 50 });
  assert.deepEqual(locate(3, 50), { kind: 'track', index: 37 });
});

test('finishing needs the exact roll', () => {
  const four = position({ 0: [53, BASE, BASE, BASE] }, 4).state;
  assert.equal(four.turn, 1, 'a 4 from 53 overshoots, so nothing can move');
  const { state, events } = move(position({ 0: [53, BASE, BASE, BASE] }, 3).state, 0);
  assert.equal(state.tokens[0][0], FINISHED);
  assert.deepEqual(types(events), ['move', 'finish', 'bonus']);
  assert.equal(events[2].reason, 'finish');
  assert.equal(state.turn, 0);
  const plain = move(position({ 0: [53, BASE, BASE, BASE] }, 3, { bonusOnFinish: false }).state, 0);
  assert.equal(plain.state.turn, 1);
});

test('capture sends the opponent home and earns a bonus roll', () => {
  // green progress 49 is track 10; red from 7 rolls 3 onto it
  const { state, events } = move(position({ 0: [7, BASE, BASE, BASE], 1: [49, 20, BASE, BASE] }, 3).state, 0);
  assert.deepEqual(state.tokens[1], [BASE, 20, BASE, BASE]);
  assert.deepEqual(events[1], { type: 'capture', colour: 1, token: 0, by: 0 });
  assert.deepEqual(events[2], { type: 'bonus', colour: 0, reason: 'capture' });
  assert.equal(state.turn, 0);
  assert.equal(state.phase, 'roll');
});

test('no capture on stars or start squares', () => {
  // green progress 8 is track 21 (a star); red from 18 rolls 3
  const star = move(position({ 0: [18, BASE, BASE, BASE], 1: [8, BASE, BASE, BASE] }, 3).state, 0);
  assert.equal(star.state.tokens[1][0], 8);
  assert.equal(star.state.turn, 1);
  // green sits on its own start square, track 13; red from 10 rolls 3
  const start = move(position({ 0: [10, BASE, BASE, BASE], 1: [0, BASE, BASE, BASE] }, 3).state, 0);
  assert.equal(start.state.tokens[1][0], 0);
  // green coming out onto its start square doesn't capture red sitting there
  const enter = move(position({ 0: [13, BASE, BASE, BASE], 1: [BASE, BASE, BASE, BASE] }, 6, { turn: 1 }).state, 0);
  assert.equal(enter.state.tokens[0][0], 13);
  assert.equal(enter.state.tokens[1][0], 0);
});

test('blocks cannot be landed on or passed', () => {
  const green = { 1: [49, 49, BASE, BASE] }; // two green tokens on track 10
  const land = position({ 0: [7, 30, FINISHED, FINISHED], ...green }, 3).state;
  assert.deepEqual(legalMoves(land).map((m) => m.token), [1]);
  const pass = position({ 0: [7, 30, FINISHED, FINISHED], ...green }, 5).state;
  assert.deepEqual(legalMoves(pass).map((m) => m.token), [1]);
  const stuck = position({ 0: [7, FINISHED, FINISHED, FINISHED], ...green }, 5).state;
  assert.equal(stuck.turn, 1);
  // your own tokens may pass your own block
  const own = move(position({ 0: [5, 7, 7, BASE] }, 4).state, 0);
  assert.equal(own.state.tokens[0][0], 9);
  // with blocks off the pair is just two tokens, and landing on them takes both
  const off = move(position({ 0: [7, BASE, BASE, BASE], ...green }, 3, { blocks: false }).state, 0);
  assert.deepEqual(off.state.tokens[1], [BASE, BASE, BASE, BASE]);
  assert.equal(off.events.filter((e) => e.type === 'capture').length, 2);
});

test('a 6 earns another roll after moving', () => {
  const { state, events } = move(position({ 0: [10, BASE, BASE, BASE] }, 6).state, 0);
  assert.deepEqual(events.at(-1), { type: 'bonus', colour: 0, reason: 'six' });
  assert.equal(state.turn, 0);
  assert.equal(state.phase, 'roll');
  assert.equal(state.sixes, 1);
});

test('the third six in a row is forfeited', () => {
  let s = position({ 0: [10, BASE, BASE, BASE] }).state;
  s = move(roll(s, Math.random, 6).state, 0).state;
  s = move(roll(s, Math.random, 6).state, 0).state;
  assert.equal(s.tokens[0][0], 22);
  const third = roll(s, Math.random, 6);
  assert.deepEqual(types(third.events), ['roll', 'forfeit', 'turn']);
  assert.equal(third.state.turn, 1);
  assert.equal(third.state.tokens[0][0], 22);
  assert.equal(third.state.sixes, 0);
  // a bonus roll that isn't a 6 breaks the run
  let t = move(position({ 0: [7, 20, BASE, BASE], 1: [49, BASE, BASE, BASE] }, 6).state, 1).state;
  t = move(roll(t, Math.random, 3).state, 0).state; // capture: bonus, run reset
  assert.equal(t.sixes, 0);
});

test('no legal move passes the turn, even on a 6', () => {
  const { state, events } = position({ 0: [55, FINISHED, FINISHED, FINISHED] }, 6);
  assert.deepEqual(types(events), ['roll', 'noMove', 'turn']);
  assert.equal(state.turn, 1);
  assert.equal(state.roll, null);
  // turn order wraps to the first colour after the last
  const last = position({}, 2, { turn: 2 }).state;
  assert.equal(last.turn, 0);
});

test('getting the last token home wins and ends the game', () => {
  const { state, events } = move(position({ 0: [FINISHED, FINISHED, 55, FINISHED] }, 1).state, 2);
  assert.deepEqual(types(events), ['move', 'finish', 'win']);
  assert.equal(state.over, true);
  assert.equal(state.winner, 0);
  assert.throws(() => roll(state, Math.random, 3));
  assert.deepEqual(legalMoves(state), []);
});

test('locate maps every kind of position', () => {
  assert.deepEqual(locate(2, BASE, 3), { kind: 'base', slot: 3 });
  assert.deepEqual(locate(1, 0), { kind: 'track', index: 13 });
  assert.deepEqual(locate(1, 40), { kind: 'track', index: 1 });
  assert.deepEqual(locate(2, 30), { kind: 'track', index: 4 });
  assert.deepEqual(locate(0, 51), { kind: 'home', step: 0 });
  assert.deepEqual(locate(3, 55), { kind: 'home', step: 4 });
  assert.deepEqual(locate(3, FINISHED), { kind: 'finished' });
});

test('illegal moves throw and nothing is mutated', () => {
  const s = position({ 0: [7, BASE, BASE, BASE], 1: [49, BASE, BASE, BASE] }, 3).state;
  const before = JSON.stringify(s);
  move(s, 0);
  move(s, legalMoves(s)[0]);
  chooseMove(s, 2);
  assert.equal(JSON.stringify(s), before);
  assert.throws(() => move(s, 1), /illegal/);
  const fresh = newGame();
  roll(fresh, Math.random, 6);
  assert.deepEqual(fresh, newGame());
  assert.throws(() => move(fresh, 0), /illegal/);
  assert.throws(() => roll(roll(fresh, Math.random, 6).state, Math.random, 1), /roll/);
});

// Plays one game; levels[c] is the computer level for colour c. Returns the final state and turns.
function playGame(levels, random, check) {
  let s = newGame({ colours: [0, 1, 2] });
  let turns = 0;
  while (!s.over && turns < 3000) {
    const r = s.phase === 'roll' ? roll(s, random) : move(s, chooseMove(s, levels[s.turn], random));
    s = r.state;
    turns += r.events.filter((e) => e.type === 'turn').length;
    if (check) check(s);
  }
  return { state: s, turns };
}

test('thousands of random games all end with 4 tokens per colour', () => {
  const random = seeded(1);
  let longest = 0;
  for (let g = 0; g < 2000; g++) {
    const { state, turns } = playGame([0, 0, 0], random, (s) => {
      for (const c of s.colours) {
        assert.equal(s.tokens[c].length, 4);
        assert.ok(s.tokens[c].every((p) => Number.isInteger(p) && p >= BASE && p <= FINISHED));
      }
    });
    assert.ok(state.over, `game ${g} still going after 3000 turns`);
    assert.ok(state.tokens[state.winner].every((p) => p === FINISHED));
    longest = Math.max(longest, turns);
  }
  console.log('   longest game:', longest, 'turns');
});

// Win rate of `level` in one seat against two easy players, rotating seats to cancel any edge
// from moving first.
function winRate(level, games, seed) {
  const random = seeded(seed);
  let wins = 0;
  for (let g = 0; g < games; g++) {
    const seat = g % 3;
    const levels = [0, 0, 0];
    levels[seat] = level;
    if (playGame(levels, random).state.winner === seat) wins++;
  }
  return wins / games;
}

test('hard and normal clearly beat easy players', () => {
  const hard = winRate(2, 300, 7);
  const normal = winRate(1, 300, 8);
  console.log('   hard vs two easy:', Math.round(hard * 100) + '%,', 'normal vs two easy:', Math.round(normal * 100) + '%');
  assert.ok(hard > 0.5);
  assert.ok(normal > 0.45);
});

test('hard move is quick enough for the browser', () => {
  const random = seeded(3);
  const times = [];
  let s = newGame({ colours: [0, 1, 2, 3] });
  for (let i = 0; i < 3000 && !s.over; i++) {
    if (s.phase === 'roll') { s = roll(s, random).state; continue; }
    const t = performance.now();
    const token = chooseMove(s, 2, random);
    times.push(performance.now() - t);
    s = move(s, token).state;
  }
  // judge the typical and 99th-percentile call, so one garbage-collection pause can't fail it
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const p99 = times[Math.floor(times.length * 0.99)];
  console.log('   hard move: mean', mean.toFixed(3), 'ms, 99th percentile', p99.toFixed(2), 'ms');
  assert.ok(mean < 1);
  assert.ok(p99 < 10);
});

console.log(`\n${passed} tests passed`);
