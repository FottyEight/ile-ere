// Whot rules (the common Nigerian rules) plus computer players. Plain JS, no DOM.
//
// Deck: 54 cards in five shapes plus five "Whot" (20) cards. Each player gets 5 cards and one card
// is turned up to start the pile; the rest is the market (draw pile).
//  - On your turn play a card matching the top card's shape or number, or a Whot (wild) any time.
//    If you can't or won't, go to market: draw 1 card and your turn ends.
//  - 1 Hold on: play again.  2 Pick two / 5 Pick three: the next player picks 2 / 3 unless they
//    defend with another 2 / 5, which passes the (growing) penalty along.  8 Suspension: the next
//    player misses a turn.  14 General market: everyone else picks 1, then you play again.
//    20 Whot: call a shape; the next player must play that shape or another Whot.
//  - When the market runs out, the pile (except its top card) is shuffled back in.
//  - Play your last card and you win at once. After 400 turns the lowest hand total ("tender") wins.

export const SHAPES = ['circle', 'triangle', 'cross', 'square', 'star'];
export const MAX_TURNS = 400;

const NUMBERS = {
  circle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
  triangle: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
  cross: [1, 2, 3, 5, 7, 10, 11, 13, 14],
  square: [1, 2, 3, 5, 7, 10, 11, 13, 14],
  star: [1, 2, 3, 4, 5, 7, 8],
};
const WHOT = 20;
const SPECIALS = new Set([1, 2, 5, 8, 14, WHOT]);
const DEFENDER = { two: 2, three: 5 }; // the card that answers each pick penalty

export const isSpecial = (card) => SPECIALS.has(card.number);

export function newDeck() {
  const deck = [];
  for (const shape of SHAPES) for (const number of NUMBERS[shape]) deck.push({ id: deck.length, shape, number });
  for (let i = 0; i < 5; i++) deck.push({ id: deck.length, shape: 'whot', number: WHOT });
  return deck;
}

function shuffle(cards, random) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function newGame({ players = 4, handSize = 5, random = Math.random, generalMarketPlaysAgain = true, maxTurns = MAX_TURNS } = {}) {
  if (players < 2 || players > 4) throw new Error('Whot needs 2–4 players');
  const deck = shuffle(newDeck(), random);
  const hands = Array.from({ length: players }, () => []);
  for (let round = 0; round < handSize; round++) for (const hand of hands) hand.push(deck.pop());
  // The starting card must be plain; specials go back into the market at a random spot.
  let start = deck.pop();
  while (isSpecial(start)) {
    deck.splice(Math.floor(random() * (deck.length + 1)), 0, start);
    start = deck.pop();
  }
  return {
    hands, market: deck, pile: [start], called: null, pending: null,
    turn: 0, over: false, winner: null, reason: null, turns: 0,
    options: { players, handSize, generalMarketPlaysAgain, maxTurns },
  };
}

export const topCard = (s) => s.pile[s.pile.length - 1];
const nextPlayer = (s, p, steps = 1) => (p + steps) % s.hands.length;
const handTotal = (hand) => hand.reduce((n, c) => n + c.number, 0);

// Can `card` go on the pile right now (ignoring whose hand it's in)?
export function canPlay(s, card) {
  if (s.pending) return card.number === DEFENDER[s.pending.kind];
  if (card.number === WHOT) return true;
  if (s.called) return card.shape === s.called;
  const top = topCard(s);
  return card.shape === top.shape || card.number === top.number;
}

export function legalPlays(s) {
  if (s.over) return [];
  const actions = [];
  for (const card of s.hands[s.turn]) {
    if (!canPlay(s, card)) continue;
    if (card.number === WHOT) for (const callShape of SHAPES) actions.push({ type: 'play', cardId: card.id, callShape });
    else actions.push({ type: 'play', cardId: card.id });
  }
  actions.push({ type: 'market' });
  return actions;
}

// Copies everything play() changes; card objects themselves are never modified, so they're shared.
function clone(s) {
  return { ...s, hands: s.hands.map((h) => h.slice()), market: s.market.slice(), pile: s.pile.slice(), pending: s.pending && { ...s.pending } };
}

// Draws up to `count` cards into `player`'s hand, reshuffling the pile into the market when needed.
function draw(s, player, count, random, events) {
  const cards = [];
  for (let i = 0; i < count; i++) {
    if (s.market.length === 0) {
      if (s.pile.length <= 1) break; // nothing left anywhere: they simply get fewer
      const top = s.pile.pop();
      s.market = shuffle(s.pile, random);
      s.pile = [top];
      events.push({ type: 'reshuffle' });
    }
    cards.push(s.market.pop());
  }
  s.hands[player].push(...cards);
  events.push({ type: 'draw', player, count: cards.length, cards });
}

// Applies `action` for whoever's turn it is. Returns the new state and what happened, in order:
// play, draw, reshuffle, holdOn, pickPenalty (who now faces it), suspended, generalMarket, call,
// win, turn (who plays next).
export function play(state, action, random = Math.random) {
  if (state.over) throw new Error('the game is over');
  const s = clone(state);
  const me = s.turn;
  const events = [];
  let next = nextPlayer(s, me);

  if (action?.type === 'market') {
    // Going to market under a penalty means accepting it.
    draw(s, me, s.pending ? s.pending.amount : 1, random, events);
    s.pending = null;
  } else if (action?.type === 'play') {
    const hand = s.hands[me];
    const index = hand.findIndex((c) => c.id === action.cardId);
    const card = hand[index];
    if (!card || !canPlay(s, card)) throw new Error(`illegal play ${action.cardId}`);
    if (card.number === WHOT && !SHAPES.includes(action.callShape)) throw new Error('a Whot needs a shape to call');
    hand.splice(index, 1);
    s.pile.push(card);
    s.called = null;
    events.push(card.number === WHOT ? { type: 'play', player: me, card, callShape: action.callShape } : { type: 'play', player: me, card });

    if (hand.length === 0) {
      // Going out ends the game at once, whatever the card would have done.
      s.pending = null;
      s.turns++;
      return { state: finish(s, me, 'out', events), events };
    }

    switch (card.number) {
      case 1:
        next = me;
        events.push({ type: 'holdOn', player: me });
        break;
      case 2:
      case 5: {
        const kind = card.number === 2 ? 'two' : 'three';
        const amount = (s.pending ? s.pending.amount : 0) + (kind === 'two' ? 2 : 3);
        s.pending = { kind, amount };
        events.push({ type: 'pickPenalty', player: next, amount });
        break;
      }
      case 8:
        events.push({ type: 'suspended', player: next });
        next = nextPlayer(s, me, 2);
        break;
      case 14: {
        const others = s.hands.map((_, p) => p).filter((p) => p !== me);
        events.push({ type: 'generalMarket', player: me, players: others });
        for (const p of others) draw(s, p, 1, random, events);
        if (s.options.generalMarketPlaysAgain) next = me;
        break;
      }
      case WHOT:
        s.called = action.callShape;
        events.push({ type: 'call', shape: action.callShape });
        break;
    }
  } else {
    throw new Error('unknown action');
  }

  s.turns++;
  if (s.turns >= s.options.maxTurns) {
    // Safety valve: lowest tender (sum of card numbers in hand) wins.
    const totals = s.hands.map(handTotal);
    return { state: finish(s, totals.indexOf(Math.min(...totals)), 'tender', events), events };
  }
  s.turn = next;
  events.push({ type: 'turn', player: next });
  return { state: s, events };
}

function finish(s, winner, reason, events) {
  s.over = true;
  s.winner = winner;
  s.reason = reason;
  events.push({ type: 'win', player: winner, reason });
  return s;
}

// ── Computer players ──
// level 0 easy: random, often goes to market for no reason.
// level 1 normal: heuristics (defend penalties, attack a player close to finishing, save Whots,
//   dump high cards, call the shape it holds most of).
// level 2 hard: normal, plus card counting (what's still unseen) to guess whether the next player
//   can follow, and a search for a Hold on / General market chain that empties the hand this turn.

const pick = (list, random) => list[Math.floor(random() * list.length)];

export function chooseAction(s, level = 1, random = Math.random) {
  const actions = legalPlays(s);
  const plays = actions.filter((a) => a.type === 'play');
  if (plays.length === 0) return { type: 'market' };
  if (level <= 0) {
    // Easy players often draw when they could play, but not when nearly out, so that a table
    // of easy players still finishes.
    const lazy = s.hands[s.turn].length > 2 ? 0.2 : 0;
    if (random() < lazy) return { type: 'market' };
    const cardId = pick([...new Set(plays.map((a) => a.cardId))], random); // each card equally, not each call
    return pick(plays.filter((a) => a.cardId === cardId), random);
  }

  const me = s.turn;
  const hand = s.hands[me];
  const byId = new Map(hand.map((c) => [c.id, c]));
  if (s.pending) return plays[0]; // always defend: passing the penalty on beats picking it up

  if (level >= 2) {
    const out = goingOutPlay(s, hand);
    if (out) return out;
  }

  const next = nextPlayer(s, me);
  const nextCards = s.hands[next].length;
  const nextLow = nextCards <= 2;
  const anyLow = s.hands.some((h, p) => p !== me && h.length <= 2); // General market reaches everyone
  const unseen = level >= 2 ? unseenCards(s, hand) : null;
  const calls = new Map(); // Whot card id → the shape it would call (worked out once per card)
  const bestCall = (whot) => {
    if (!calls.has(whot.id)) calls.set(whot.id, bestCallShape(hand.filter((c) => c !== whot), unseen, nextLow, random));
    return calls.get(whot.id);
  };

  let best = -Infinity;
  let choice = null;
  for (const action of plays) {
    const card = byId.get(action.cardId);
    if (card.number === WHOT && action.callShape !== bestCall(card)) continue;
    const rest = hand.filter((c) => c !== card);
    let score = card.number === WHOT ? 0 : card.number * 0.1; // shed high cards (tender)
    if (rest.length === 0) score += 1000;

    switch (card.number) {
      case WHOT:
        score += rest.length <= 1 ? 2 : -10; // keep it for when nothing else plays
        break;
      case 1:
      case 14: {
        // Only worth it if we can follow up on our extra turn.
        const followUp = rest.some((c) => c.number === WHOT || c.shape === card.shape || c.number === card.number);
        score += followUp ? 3 : -1;
        if (card.number === 14) score += nextLow || (unseen && anyLow) ? 4 : 1;
        break;
      }
      case 2:
      case 5:
        score += nextLow ? 6 : -0.5; // otherwise hold it to defend with later
        break;
      case 8:
        score += nextLow ? 6 : 0.5;
        break;
    }
    // Keep shapes we hold several of in play, so we can follow later.
    score += 0.3 * rest.filter((c) => c.shape === card.shape).length;

    if (unseen) score -= (nextLow ? 8 : 2) * followChance(card, action.callShape, unseen, nextCards);
    score += random() * 0.01; // break ties without always picking the same card
    if (score > best) { best = score; choice = action; }
  }
  return choice;
}

// The shape to call with a Whot: the one we hold most of, and (when counting cards) the one the
// next player is least likely to have when they're close to finishing.
function bestCallShape(rest, unseen, nextLow, random) {
  let best = -Infinity;
  let shape = null;
  for (const sh of SHAPES) {
    let score = rest.filter((c) => c.shape === sh).length * 2 + random() * 0.1;
    if (unseen) score -= unseen.filter((c) => c.shape === sh).length / (nextLow ? 3 : 10);
    if (score > best) { best = score; shape = sh; }
  }
  return shape;
}

// Cards we haven't seen: not in our hand and not on the pile (opponents' hands + market).
const FULL_DECK = newDeck();
function unseenCards(s, hand) {
  const seen = new Set([...hand, ...s.pile].map((c) => c.id));
  return FULL_DECK.filter((c) => !seen.has(c.id));
}

// Rough chance the next player can answer `card`, assuming their hand is a random draw from unseen.
function followChance(card, callShape, unseen, nextCards) {
  let matches;
  if (card.number === 8) return 0; // they're suspended
  if (card.number === 2 || card.number === 5) matches = (c) => c.number === card.number;
  else if (card.number === WHOT) matches = (c) => c.number === WHOT || c.shape === callShape;
  else matches = (c) => c.number === WHOT || c.shape === card.shape || c.number === card.number;
  const f = unseen.filter(matches).length / Math.max(1, unseen.length);
  return 1 - (1 - f) ** nextCards;
}

// Looks for a run of Hold on / General market cards ending in our last card, i.e. a way to empty
// the hand this turn. Returns the first action of that run, or null.
function goingOutPlay(s, hand) {
  const playsAgain = (c) => c.number === 1 || (c.number === 14 && s.options.generalMarketPlaysAgain);
  if (hand.filter((c) => !playsAgain(c)).length > 1) return null;
  const fits = (card, top, called) => {
    if (card.number === WHOT) return true;
    if (called) return card.shape === called;
    return card.shape === top.shape || card.number === top.number;
  };
  const search = (left, top, called) => {
    if (left.length === 1) {
      const c = left[0];
      return fits(c, top, called) ? { type: 'play', cardId: c.id, ...(c.number === WHOT && { callShape: SHAPES[0] }) } : null;
    }
    for (const c of left) {
      if (!playsAgain(c) || !fits(c, top, called)) continue;
      if (search(left.filter((x) => x !== c), c, null)) return { type: 'play', cardId: c.id };
    }
    return null;
  };
  return search(hand, topCard(s), s.called);
}
