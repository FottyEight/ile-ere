// Rule tests: node tools/ayo.test.mjs
import assert from 'node:assert/strict';
import { newGame, play, legalMoves, chooseMove, clone } from '../src/ayo.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const board = (pits, extra = {}) => ({ ...newGame(), pits, stores: [0, 0], ...extra });
const total = (s) => s.pits.reduce((a, b) => a + b, 0) + s.stores[0] + s.stores[1];

test('opening move sows one seed into each of the next four pits', () => {
  const { state, path } = play(newGame(), 2);
  assert.deepEqual(path, [3, 4, 5, 6]);
  assert.deepEqual(state.pits, [4, 4, 0, 5, 5, 5, 5, 4, 4, 4, 4, 4]);
  assert.equal(state.turn, 1);
});

test('last seed making 2 or 3 in an opponent pit captures it', () => {
  const s = board([0, 0, 0, 0, 0, 2, 1, 5, 0, 0, 0, 0]);
  const { state, captures } = play(s, 5); // 6 → 2, 7 → 6 ... last lands in 7 (6 seeds) no
  assert.equal(captures.length, 0);
  const s2 = board([0, 0, 0, 0, 0, 1, 2, 5, 0, 0, 0, 0]);
  const r2 = play(s2, 5); // last seed into pit 6 → 3, capture
  assert.deepEqual(r2.captures, [{ pit: 6, count: 3 }]);
  assert.equal(r2.state.stores[0], 3);
  assert.equal(r2.state.pits[6], 0);
});

test('captures chain backwards through opponent pits holding 2 or 3', () => {
  const s = board([0, 0, 0, 3, 0, 0, 1, 2, 1, 4, 0, 0]);
  const { captures, state } = play(s, 3); // sows 4, 5, 6(→2): last in 6 only
  assert.deepEqual(captures, [{ pit: 6, count: 2 }]);
  const s2 = board([0, 0, 0, 0, 0, 3, 1, 2, 2, 4, 0, 0]);
  const r2 = play(s2, 5); // sows 6(→2) 7(→3) 8(→3): capture 8, 7, 6
  assert.deepEqual(r2.captures, [{ pit: 8, count: 3 }, { pit: 7, count: 3 }, { pit: 6, count: 2 }]);
  assert.equal(r2.state.stores[0], 8);
  assert.equal(total(r2.state), total(s2));
});

test('chain stops at your own side', () => {
  const s = board([0, 0, 0, 0, 1, 2, 2, 0, 0, 0, 0, 3]);
  const r = play(s, 5); // sows 6(→3) 7(→1): last in 7 = 1 → no capture
  assert.equal(r.captures.length, 0);
  const s2 = board([0, 0, 0, 0, 2, 1, 1, 0, 0, 0, 0, 3]);
  const r2 = play(s2, 5); // sows 6 (→2): capture 6, then 5 is our own pit → stop
  assert.deepEqual(r2.captures, [{ pit: 6, count: 2 }]);
});

test('a pit of 12+ skips its own pit on the next lap', () => {
  const s = board([12, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
  const { path, state } = play(s, 0);
  assert.equal(path.length, 12);
  assert.ok(!path.includes(0));
  assert.equal(state.pits[0], 0);
  assert.equal(state.pits[1], 2); // got a seed on both laps
});

test('no grand slam: taking every opponent seed captures nothing', () => {
  const s = board([0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0], { stores: [20, 20] });
  const { captures, grandSlam, state } = play(s, 5);
  assert.equal(grandSlam, true);
  assert.equal(captures.length, 0);
  assert.equal(state.stores[0], 20); // nothing taken
  // Player 1's 3 seeds can't reach player 0's empty row, so the game ends and they keep them.
  assert.equal(state.over, true);
  assert.equal(state.stores[1], 23);
});

test('must feed an empty opponent when possible', () => {
  const s = board([3, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0], { stores: [20, 23] });
  assert.deepEqual(legalMoves(s), [4]); // pit 0's 3 seeds stop at pit 3; pit 4 reaches pit 6
});

test('game ends when the opponent cannot be fed; you keep your seeds', () => {
  const s = board([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2], { stores: [20, 21], turn: 1 });
  const r = play(s, 11); // sows into 0 and 1; player 1's row is now empty
  // player 0 holds 2 + 1 seeds but neither move reaches pit 6, so the game ends and they keep 3
  assert.equal(r.state.over, true);
  assert.equal(r.state.endReason, 'no-moves');
  assert.equal(r.state.stores[0], 23);
  const s2 = board([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { stores: [23, 24] });
  // player 0 can't reach player 1's side with one seed in pit 0 → no legal moves
  assert.deepEqual(legalMoves(s2), []);
});

test('seeds are never created or lost over thousands of random games', () => {
  for (let g = 0; g < 2000; g++) {
    let s = newGame(g % 2);
    let moves = 0;
    while (!s.over) {
      const m = legalMoves(s);
      assert.ok(m.length > 0, 'a game in progress always has a move');
      s = play(s, m[Math.floor(Math.random() * m.length)]).state;
      assert.equal(total(s), 48);
      assert.ok(++moves < 2000, 'games end');
    }
    if (s.endReason === 'majority') assert.ok(Math.max(...s.stores) >= 25);
    else assert.equal(s.stores[0] + s.stores[1], 48); // the board was swept into the stores
  }
});

test('hard computer beats random play almost always', () => {
  let wins = 0;
  for (let g = 0; g < 20; g++) {
    let s = newGame(g % 2);
    while (!s.over) s = play(s, s.turn === 1 ? chooseMove(s, 2) : legalMoves(s)[Math.floor(Math.random() * legalMoves(s).length)]).state;
    if (s.winner === 1) wins++;
  }
  console.log('   hard vs random:', wins, '/ 20');
  assert.ok(wins >= 18);
});

test('levels are ordered: hard beats easy', () => {
  let hard = 0;
  for (let g = 0; g < 10; g++) {
    let s = newGame(g % 2);
    while (!s.over) s = play(s, chooseMove(s, s.turn === 0 ? 0 : 2)).state;
    if (s.winner === 1) hard++;
  }
  console.log('   hard vs easy:', hard, '/ 10');
  assert.ok(hard >= 8);
});

test('hard move is quick enough for the browser', () => {
  const s = clone(newGame());
  const t = performance.now();
  chooseMove(s, 2);
  const ms = performance.now() - t;
  console.log('   hard opening move:', Math.round(ms), 'ms');
  assert.ok(ms < 1500);
});

console.log(`\n${passed} tests passed`);
