// Rule tests: node tools/draughts.test.mjs
import assert from 'node:assert/strict';
import { SIZE, newGame, owner, isKing, legalMoves, play, chooseMove } from '../src/draughts.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const sq = (row, col) => row * SIZE + col;
// A position with only the given pieces: { [square]: piece }.
const position = (pieces, turn = 0) => {
  const board = Array(SIZE * SIZE).fill(0);
  for (const [s, p] of Object.entries(pieces)) board[s] = p;
  return { ...newGame(), board, turn };
};
const simple = (moves) => moves.map((m) => [m.from, m.path, m.captures]).sort();
const count = (s, player) => s.board.filter((p) => owner(p) === player).length;
const randomMove = (s) => { const m = legalMoves(s); return m[Math.floor(Math.random() * m.length)]; };

test('opening position: 20 men each, white has exactly 9 moves', () => {
  const s = newGame();
  assert.equal(count(s, 0), 20);
  assert.equal(count(s, 1), 20);
  assert.equal(s.board[sq(9, 0)], 1); // (row + col) odd squares only
  assert.equal(s.board[sq(0, 1)], 3);
  const moves = legalMoves(s);
  assert.equal(moves.length, 9);
  assert.ok(moves.every((m) => m.captures.length === 0 && m.from >= sq(6, 0) && m.to < sq(6, 0)));
});

test('men only step forward when not capturing', () => {
  const s = position({ [sq(5, 4)]: 1, [sq(0, 1)]: 3 });
  assert.deepEqual(legalMoves(s).map((m) => m.to).sort(), [sq(4, 3), sq(4, 5)]);
  const b = position({ [sq(5, 4)]: 1, [sq(2, 3)]: 3 }, 1);
  assert.deepEqual(legalMoves(b).map((m) => m.to).sort(), [sq(3, 2), sq(3, 4)]);
});

test('men capture backwards', () => {
  const s = position({ [sq(4, 5)]: 1, [sq(5, 6)]: 3 });
  assert.deepEqual(simple(legalMoves(s)), [[sq(4, 5), [sq(6, 7)], [sq(5, 6)]]]);
});

test('capturing is compulsory', () => {
  const s = position({ [sq(6, 3)]: 1, [sq(6, 9)]: 1, [sq(5, 4)]: 3, [sq(0, 1)]: 3 });
  const moves = legalMoves(s);
  assert.deepEqual(simple(moves), [[sq(6, 3), [sq(4, 5)], [sq(5, 4)]]]);
});

test('you must take the sequence that captures the most pieces', () => {
  // 81 can take one piece; 67 can take two in a row.
  const s = position({ [sq(8, 1)]: 1, [sq(7, 2)]: 3, [sq(6, 7)]: 1, [sq(5, 6)]: 3, [sq(3, 4)]: 3 });
  assert.deepEqual(simple(legalMoves(s)), [[sq(6, 7), [sq(4, 5), sq(2, 3)], [sq(5, 6), sq(3, 4)]]]);
});

test('a multi-jump lists every landing square and capture in order', () => {
  const s = position({ [sq(9, 0)]: 1, [sq(8, 1)]: 3, [sq(6, 1)]: 3, [sq(4, 1)]: 3 });
  const [m, ...rest] = legalMoves(s);
  assert.equal(rest.length, 0);
  assert.deepEqual(m, {
    from: sq(9, 0), to: sq(3, 2), path: [sq(7, 2), sq(5, 0), sq(3, 2)],
    captures: [sq(8, 1), sq(6, 1), sq(4, 1)], crowned: false,
  });
  const after = play(s, m);
  assert.equal(count(after, 1), 0);
  assert.equal(after.board[sq(3, 2)], 1);
});

test('flying king moves any distance along an empty diagonal', () => {
  const s = position({ [sq(9, 0)]: 2, [sq(0, 9)]: 3 });
  const moves = legalMoves(s);
  assert.equal(moves.length, 8); // 81 … 18; 09 is occupied with nothing beyond it
  assert.ok(moves.every((m) => m.captures.length === 0 && !m.crowned));
});

test('flying king captures at a distance, with each landing square a separate move', () => {
  const s = position({ [sq(9, 0)]: 2, [sq(6, 3)]: 3 });
  const moves = legalMoves(s);
  assert.deepEqual(moves.map((m) => m.to).sort((a, b) => a - b), [9, 18, 27, 36, 45, 54]);
  assert.ok(moves.every((m) => m.from === 90 && m.captures.join() === '63'));
  // With a second piece on 25, only landing on 36 lets the king keep capturing: maximum rule.
  const t = position({ [sq(9, 0)]: 2, [sq(6, 3)]: 3, [sq(2, 5)]: 3 });
  assert.deepEqual(simple(legalMoves(t)), [[90, [36, 14], [63, 25]], [90, [36, 3], [63, 25]]]);
});

test('Turkish strike: jumped pieces block and are never jumped twice', () => {
  // A king alone with one enemy can't bounce back over it.
  assert.ok(legalMoves(position({ [sq(5, 4)]: 2, [sq(4, 3)]: 3 })).every((m) => m.captures.length === 1));
  // If jumped pieces vanished at once this king could take 4; they stay until the move ends, so 3.
  const s = position({ 49: 2, 21: 3, 63: 3, 67: 3, 78: 3, 87: 3 });
  const moves = legalMoves(s);
  assert.deepEqual(simple(moves), [[49, [85, 30, 12], [67, 63, 21]], [49, [85, 30, 3], [67, 63, 21]]]);
  assert.equal(count(play(s, moves[0]), 1), 2);
});

test('a man is crowned only when it ends its move on the far row', () => {
  const s = position({ [sq(2, 1)]: 1, [sq(1, 2)]: 3, [sq(5, 8)]: 3 });
  const [m] = legalMoves(s);
  assert.equal(m.to, sq(0, 3));
  assert.equal(m.crowned, true);
  assert.equal(play(s, m).board[sq(0, 3)], 2);
  // Passing through row 0 mid-capture and carrying on doesn't crown it.
  const t = position({ [sq(2, 1)]: 1, [sq(1, 2)]: 3, [sq(1, 4)]: 3, [sq(5, 8)]: 3 });
  const moves = legalMoves(t);
  assert.deepEqual(simple(moves), [[sq(2, 1), [sq(0, 3), sq(2, 5)], [sq(1, 2), sq(1, 4)]]]);
  assert.equal(moves[0].crowned, false);
  assert.equal(play(t, moves[0]).board[sq(2, 5)], 1);
  assert.ok(!isKing(1) && isKing(2) && isKing(4) && !isKing(0));
});

test('a player with no legal move loses', () => {
  // Black's only man on 09 is blocked by 18 with 27 behind it.
  const s = position({ [sq(1, 8)]: 1, [sq(2, 7)]: 1, [sq(8, 5)]: 1, [sq(0, 9)]: 3 });
  const after = play(s, legalMoves(s).find((m) => m.from === sq(8, 5)));
  assert.equal(after.over, true);
  assert.equal(after.winner, 0);
  assert.equal(after.result, 'win');
  assert.equal(after.reason, 'no-moves');
  assert.deepEqual(legalMoves(after), []);
  // Taking the last piece wins too.
  const t = play(position({ [sq(4, 5)]: 1, [sq(3, 6)]: 3 }), { from: sq(4, 5), path: [sq(2, 7)] });
  assert.equal(t.winner, 0);
});

test('threefold repetition and 25 king-only moves each are draws', () => {
  let s = position({ [sq(9, 8)]: 2, [sq(0, 1)]: 4 });
  const shuffle = [[98, 87], [1, 12], [87, 98], [12, 1]];
  let plies = 0;
  while (!s.over) {
    const [from, to] = shuffle[plies++ % 4];
    s = play(s, { from, path: [to] });
  }
  assert.equal(plies, 9); // the position after ply 1 recurs after plies 5 and 9
  assert.deepEqual([s.result, s.reason, s.winner], ['draw', 'repetition', null]);
  // Wandering kings that never repeat a position still draw after 50 plies.
  let t = { ...position({ [sq(9, 8)]: 2, [sq(0, 1)]: 4 }), quiet: 49 };
  t = play(t, { from: 98, path: [87] });
  assert.deepEqual([t.result, t.reason], ['draw', 'quiet']);
  // A man moving resets the count.
  const u = play({ ...position({ [sq(9, 8)]: 1, [sq(0, 1)]: 4 }), quiet: 49 }, { from: 98, path: [87] });
  assert.equal(u.over, false);
  assert.equal(u.quiet, 0);
});

test('illegal moves throw and play() never mutates its input', () => {
  const s = newGame();
  const before = JSON.stringify(s);
  assert.throws(() => play(s, { from: sq(6, 1), path: [sq(4, 1)] }));
  assert.throws(() => play(s, { from: sq(3, 0), path: [sq(4, 1)] })); // not your piece
  const next = play(s, legalMoves(s)[0]);
  chooseMove(next, 2, Math.random, 100);
  assert.equal(JSON.stringify(s), before);
  assert.equal(next.turn, 1);
});

test('thousands of random games end, and pieces are never created', () => {
  let finished = 0;
  for (let g = 0; g < 2000; g++) {
    let s = newGame();
    for (let ply = 0; ply < 400 && !s.over; ply++) {
      assert.ok(legalMoves(s).length > 0, 'a game in progress always has a move');
      const next = play(s, randomMove(s));
      for (const p of [0, 1]) assert.ok(count(next, p) <= count(s, p));
      s = next;
    }
    if (s.over) finished++;
    if (s.over && s.result === 'win') assert.equal(legalMoves({ ...s, over: false }).length, 0);
  }
  console.log('   random games finished within 400 plies:', finished, '/ 2000');
  assert.ok(finished >= 1900);
});

test('hard computer beats random play almost always', () => {
  let wins = 0;
  for (let g = 0; g < 10; g++) {
    let s = newGame();
    const computer = g % 2; // play both colours
    for (let ply = 0; ply < 400 && !s.over; ply++) {
      s = play(s, s.turn === computer ? chooseMove(s, 2, Math.random, 40) : randomMove(s));
    }
    if (s.winner === computer) wins++;
  }
  console.log('   hard vs random:', wins, '/ 10');
  assert.ok(wins >= 9);
});

test('levels are ordered: normal beats easy', () => {
  let normal = 0;
  for (let g = 0; g < 4; g++) {
    let s = newGame();
    for (let ply = 0; ply < 400 && !s.over; ply++) s = play(s, chooseMove(s, s.turn === 1 ? 1 : 0, Math.random, 40));
    if (s.winner === 1) normal++;
  }
  console.log('   normal vs easy:', normal, '/ 4');
  assert.ok(normal >= 3);
});

test('hard move is quick enough for the browser', () => {
  for (const s of [newGame(), play(newGame(), legalMoves(newGame())[4])]) {
    const t = performance.now();
    const m = chooseMove(s, 2);
    const ms = performance.now() - t;
    console.log('   hard move:', Math.round(ms), 'ms');
    assert.ok(legalMoves(s).includes(m) || legalMoves(s).some((x) => x.from === m.from && x.path.join() === m.path.join()));
    assert.ok(ms < 1000);
  }
});

console.log(`\n${passed} tests passed`);
