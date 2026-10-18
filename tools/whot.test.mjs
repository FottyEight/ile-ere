// Rule tests: node tools/whot.test.mjs
import assert from 'node:assert/strict';
import { SHAPES, newDeck, newGame, topCard, legalPlays, play, chooseAction } from '../src/whot.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

// A seeded random so failures can be replayed (mulberry32).
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const DECK = newDeck();
// The k-th card of a shape and number, e.g. card('whot', 20, 2) is the third Whot.
const card = (shape, number, k = 0) => DECK.filter((c) => c.shape === shape && c.number === number)[k];

// A hand-built table: everything not in a hand or on the pile goes to the market.
function table({ hands, pile, called = null, pending = null, turn = 0, market, generalMarketPlaysAgain = true }) {
  const used = new Set([...hands.flat(), ...pile].map((c) => c.id));
  return {
    hands, pile, market: market ?? DECK.filter((c) => !used.has(c.id)), called, pending,
    turn, over: false, winner: null, reason: null, turns: 0,
    options: { players: hands.length, handSize: 5, generalMarketPlaysAgain, maxTurns: 400 },
  };
}
// Two plain cards for seat `seat` (squares 3/7/10/11/13/… or triangles), distinct per seat.
const FILLER = [card('square', 3), card('square', 7), card('square', 10), card('square', 11), card('square', 13), card('triangle', 13)];
const filler = (seat) => FILLER.slice(2 * (seat - 1), 2 * seat);
const cardCount = (s) => s.hands.reduce((n, h) => n + h.length, 0) + s.market.length + s.pile.length;
const types = (events) => events.map((e) => e.type);
const canPlayId = (s, c) => legalPlays(s).some((a) => a.type === 'play' && a.cardId === c.id);

test('deck has 54 cards: 5 Whots and the right count per shape', () => {
  assert.equal(DECK.length, 54);
  assert.deepEqual(DECK.map((c) => c.id), [...Array(54).keys()]);
  const count = (shape) => DECK.filter((c) => c.shape === shape).length;
  assert.deepEqual([...SHAPES, 'whot'].map(count), [12, 12, 9, 9, 7, 5]);
  assert.ok(DECK.filter((c) => c.shape === 'whot').every((c) => c.number === 20));
  assert.equal(DECK.filter((c) => c.shape === 'cross' && [4, 8, 12].includes(c.number)).length, 0);
});

test('dealing gives 5 cards each, one pile card, the rest in the market', () => {
  const s = newGame({ random: seeded(1) });
  assert.equal(s.hands.length, 4);
  assert.ok(s.hands.every((h) => h.length === 5));
  assert.equal(s.pile.length, 1);
  assert.equal(s.market.length, 54 - 20 - 1);
  assert.equal(new Set([...s.hands.flat(), ...s.market, ...s.pile].map((c) => c.id)).size, 54);
  assert.deepEqual([s.turn, s.called, s.pending, s.over], [0, null, null, false]);
  const small = newGame({ players: 2, handSize: 7, random: seeded(2) });
  assert.deepEqual(small.hands.map((h) => h.length), [7, 7]);
});

test('the starting card is never special', () => {
  for (let seed = 0; seed < 500; seed++) {
    const s = newGame({ random: seeded(seed) });
    assert.ok(![1, 2, 5, 8, 14, 20].includes(topCard(s).number));
    assert.equal(cardCount(s), 54);
  }
});

test('a card matches the top card by shape or by number', () => {
  const sameShape = card('circle', 3), sameNumber = card('star', 7), neither = card('triangle', 4);
  const s = table({ hands: [[sameShape, sameNumber, neither], filler(1)], pile: [card('circle', 7)] });
  assert.ok(canPlayId(s, sameShape));
  assert.ok(canPlayId(s, sameNumber));
  assert.ok(!canPlayId(s, neither));
  assert.throws(() => play(s, { type: 'play', cardId: neither.id }));
  const { state, events } = play(s, { type: 'play', cardId: sameNumber.id });
  assert.equal(topCard(state).id, sameNumber.id);
  assert.equal(state.turn, 1);
  assert.deepEqual(types(events), ['play', 'turn']);
});

test('market is always allowed: draw one and the turn passes', () => {
  const s = table({ hands: [[card('circle', 3)], filler(1)], pile: [card('circle', 7)] });
  assert.ok(legalPlays(s).some((a) => a.type === 'market'));
  const { state, events } = play(s, { type: 'market' });
  assert.equal(state.hands[0].length, 2);
  assert.equal(state.turn, 1);
  assert.deepEqual(events[0], { type: 'draw', player: 0, count: 1, cards: [state.hands[0][1]] });
});

test('a Whot plays on anything and sets the called shape', () => {
  const whot = card('whot', 20);
  const s = table({ hands: [[whot, card('cross', 3)], filler(1)], pile: [card('circle', 7)] });
  const whotPlays = legalPlays(s).filter((a) => a.cardId === whot.id);
  assert.deepEqual(whotPlays.map((a) => a.callShape), SHAPES);
  assert.throws(() => play(s, { type: 'play', cardId: whot.id })); // must call a shape
  const { state, events } = play(s, { type: 'play', cardId: whot.id, callShape: 'star' });
  assert.equal(state.called, 'star');
  assert.deepEqual(types(events), ['play', 'call', 'turn']);
  assert.equal(events[0].callShape, 'star');
});

test('after a call the next player must follow the shape or play a Whot', () => {
  const star = card('star', 3), circle = card('circle', 13), whot = card('whot', 20, 1);
  const s = table({ hands: [filler(1), [star, circle, whot]], pile: [card('circle', 11), card('whot', 20)], called: 'star', turn: 1 });
  assert.ok(canPlayId(s, star));
  assert.ok(canPlayId(s, whot));
  assert.ok(!canPlayId(s, circle)); // the circle underneath the Whot no longer counts
  const { state } = play(s, { type: 'play', cardId: star.id });
  assert.equal(state.called, null);
});

test('Hold on (1) gives the same player another turn', () => {
  const one = card('circle', 1);
  const s = table({ hands: [[one, card('triangle', 1), card('circle', 3)], filler(1), filler(2)], pile: [card('circle', 7)] });
  const { state, events } = play(s, { type: 'play', cardId: one.id });
  assert.equal(state.turn, 0);
  assert.deepEqual(types(events), ['play', 'holdOn', 'turn']);
  assert.ok(canPlayId(state, card('triangle', 1)));
});

test('Pick two makes the next player pick 2', () => {
  const two = card('circle', 2);
  const s = table({ hands: [[two, card('circle', 3)], [card('star', 3), card('star', 4)], filler(1)], pile: [card('circle', 7)] });
  const r = play(s, { type: 'play', cardId: two.id });
  assert.deepEqual(r.state.pending, { kind: 'two', amount: 2 });
  assert.equal(r.state.turn, 1);
  assert.deepEqual(r.events[1], { type: 'pickPenalty', player: 1, amount: 2 });
  assert.deepEqual(legalPlays(r.state), [{ type: 'market' }]); // no 2 → can only pick
  const r2 = play(r.state, { type: 'market' });
  assert.equal(r2.state.hands[1].length, 4);
  assert.equal(r2.events[0].count, 2);
  assert.equal(r2.state.pending, null);
  assert.equal(r2.state.turn, 2); // picking ends their turn
});

test('defending with a 2 stacks the penalty to 4 for the following player', () => {
  const two = card('circle', 2), defend = card('star', 2), whot = card('whot', 20);
  const s = table({ hands: [[two, card('circle', 3)], [defend, whot, card('star', 4)], filler(1)], pile: [card('circle', 7)] });
  const r = play(s, { type: 'play', cardId: two.id });
  const plays = legalPlays(r.state);
  assert.ok(canPlayId(r.state, defend));
  assert.ok(!canPlayId(r.state, whot)); // a Whot can't answer a penalty
  assert.equal(plays.length, 2);
  const r2 = play(r.state, { type: 'play', cardId: defend.id });
  assert.deepEqual(r2.state.pending, { kind: 'two', amount: 4 });
  assert.equal(r2.state.turn, 2);
  const r3 = play(r2.state, { type: 'market' });
  assert.equal(r3.state.hands[2].length, 6);
  assert.equal(r3.state.turn, 0);
});

test('Pick three works the same way, answered only by a 5', () => {
  const five = card('circle', 5), defend = card('cross', 5), two = card('star', 2);
  const s = table({ hands: [[five, card('circle', 3)], [defend, two, card('star', 4)], filler(1)], pile: [card('circle', 7)] });
  const r = play(s, { type: 'play', cardId: five.id });
  assert.deepEqual(r.state.pending, { kind: 'three', amount: 3 });
  assert.ok(!canPlayId(r.state, two));
  const r2 = play(r.state, { type: 'play', cardId: defend.id });
  assert.deepEqual(r2.state.pending, { kind: 'three', amount: 6 });
  const r3 = play(r2.state, { type: 'market' });
  assert.equal(r3.state.hands[2].length, 8);
});

test('Suspension (8) skips the next player', () => {
  const eight = card('circle', 8);
  const s = table({ hands: [[eight, card('circle', 3)], filler(1), filler(2), filler(3)], pile: [card('circle', 7)] });
  const { state, events } = play(s, { type: 'play', cardId: eight.id });
  assert.equal(state.turn, 2);
  assert.deepEqual(events[1], { type: 'suspended', player: 1 });
});

test('General market (14): everyone else picks 1, then the player goes again', () => {
  const gm = card('circle', 14);
  const s = table({ hands: [[gm, card('circle', 3)], filler(1), filler(2), filler(3)], pile: [card('circle', 7)] });
  const { state, events } = play(s, { type: 'play', cardId: gm.id });
  assert.deepEqual(state.hands.map((h) => h.length), [1, 3, 3, 3]);
  assert.equal(state.turn, 0);
  assert.deepEqual(types(events), ['play', 'generalMarket', 'draw', 'draw', 'draw', 'turn']);
  assert.deepEqual(events[1].players, [1, 2, 3]);
  const off = play({ ...s, options: { ...s.options, generalMarketPlaysAgain: false } }, { type: 'play', cardId: gm.id });
  assert.equal(off.state.turn, 1);
});

test('an empty market is refilled from the pile, keeping the top card', () => {
  const pile = [card('star', 3), card('cross', 7), card('triangle', 10), card('circle', 7)];
  const s = table({ hands: [[card('circle', 3)], filler(1)], pile, market: [] });
  const { state, events } = play(s, { type: 'market' });
  assert.deepEqual(types(events), ['reshuffle', 'draw', 'turn']);
  assert.equal(topCard(state).id, card('circle', 7).id);
  assert.equal(state.pile.length, 1);
  assert.equal(state.market.length, 2);
  assert.equal(cardCount(state), cardCount(s));
  // with nothing anywhere to draw, the player just passes
  const bare = table({ hands: [[card('circle', 3)], filler(1)], pile: [card('circle', 7)], market: [] });
  const r = play(bare, { type: 'market' });
  assert.equal(r.events[0].count, 0);
  assert.equal(r.state.turn, 1);
});

test('playing your last card wins at once, even a Pick two', () => {
  const two = card('circle', 2);
  const s = table({ hands: [[two], filler(1), filler(2)], pile: [card('circle', 7)] });
  const { state, events } = play(s, { type: 'play', cardId: two.id });
  assert.deepEqual([state.over, state.winner, state.reason, state.pending], [true, 0, 'out', null]);
  assert.deepEqual(types(events), ['play', 'win']);
  assert.deepEqual(legalPlays(state), []);
  assert.throws(() => play(state, { type: 'market' }));
});

test('play() never changes the state it was given', () => {
  const s = newGame({ random: seeded(7) });
  const before = JSON.stringify(s);
  let t = s;
  const random = seeded(8);
  for (let i = 0; i < 50 && !t.over; i++) {
    const snapshot = JSON.stringify(t);
    const next = play(t, chooseAction(t, 1, random), random).state;
    assert.equal(JSON.stringify(t), snapshot);
    t = next;
  }
  assert.equal(JSON.stringify(s), before);
});

test('thousands of random games: cards conserved, every move legal, every game ends', () => {
  const random = seeded(42);
  const reasons = { out: 0, tender: 0 };
  for (let g = 0; g < 3000; g++) {
    let s = newGame({ players: 2 + (g % 3), random });
    while (!s.over) {
      const action = chooseAction(s, g % 3, random);
      assert.ok(legalPlays(s).some((a) => JSON.stringify(a) === JSON.stringify(action)));
      s = play(s, action, random).state;
      assert.equal(cardCount(s), 54);
      assert.ok(s.turns <= 400);
    }
    reasons[s.reason]++;
  }
  console.log('   endings:', reasons);
  assert.ok(reasons.out > reasons.tender);
});

// One computer at `level` (seat 1) against three easy players; returns its win count.
function winsAgainstEasy(level, games, seed) {
  const random = seeded(seed);
  let wins = 0;
  for (let g = 0; g < games; g++) {
    let s = newGame({ random });
    s = { ...s, turn: g % 4 }; // rotate who starts
    while (!s.over) s = play(s, chooseAction(s, s.turn === 1 ? level : 0, random), random).state;
    if (s.winner === 1) wins++;
  }
  return wins;
}

test('normal computer clearly beats easy players', () => {
  const wins = winsAgainstEasy(1, 200, 100);
  console.log('   normal vs 3 easy:', wins, '/ 200');
  assert.ok(wins >= 80); // 25% would be chance
});

test('hard computer clearly beats easy players', () => {
  const wins = winsAgainstEasy(2, 200, 200);
  console.log('   hard vs 3 easy:', wins, '/ 200');
  assert.ok(wins >= 80);
});

test('computer moves are fast', () => {
  const random = seeded(9);
  const times = [];
  for (let g = 0; g < 50; g++) {
    let s = newGame({ random });
    while (!s.over) {
      const t = performance.now();
      const action = chooseAction(s, 2, random);
      times.push(performance.now() - t);
      s = play(s, action, random).state;
    }
  }
  times.sort((a, b) => a - b);
  const p99 = times[Math.floor(times.length * 0.99)];
  console.log('   hard move: 99% under', p99.toFixed(2), 'ms; slowest', times.at(-1).toFixed(2), 'ms');
  assert.ok(p99 < 10); // a rare slow move is a garbage-collection pause, not the AI thinking
});

console.log(`\n${passed} tests passed`);
