// Ayò Olópón rules (the Oware "abapa" rules most Ayo players in Nigeria use).
//
// Board: 12 pits, 4 seeds each. Pits 0–5 are yours (left to right as you face the board),
// pits 6–11 are the opponent's, continuing anticlockwise, so sowing always goes i → i + 1.
//  - A turn: pick up every seed in one of your pits and sow one per pit anticlockwise.
//    If a pit holds 12 or more seeds, the pit you started from is skipped on later laps.
//  - Capture: if the last seed lands in an opponent pit and makes it 2 or 3, take them, then
//    keep taking from the pits just before it while they're also opponent pits holding 2 or 3.
//  - A move that would take every seed the opponent has captures nothing (no grand slam).
//  - If the opponent's row is empty you must make a move that gives them seeds. If you can't,
//    the game ends and you keep the seeds left on the board.
//  - First to 25 seeds wins; 24–24 is a draw. If 60 moves pass without a capture, each player
//    keeps the seeds on their own side and the game ends.

export const PITS = 12;
export const START_SEEDS = 4;
export const NO_CAPTURE_LIMIT = 60;

export const side = (pit) => (pit < 6 ? 0 : 1);
const own = (player) => (player === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11]);
const seedsOnSide = (pits, player) => own(player).reduce((n, i) => n + pits[i], 0);

export function newGame(first = 0) {
  return { pits: Array(PITS).fill(START_SEEDS), stores: [0, 0], turn: first, quiet: 0, over: false, winner: null, endReason: null };
}

export function clone(s) {
  return { ...s, pits: s.pits.slice(), stores: s.stores.slice() };
}

// Sows from `pit` on a copy of the pits; returns the pits after sowing and the path taken.
function sow(pits, pit) {
  const p = pits.slice();
  let seeds = p[pit];
  p[pit] = 0;
  const path = [];
  let i = pit;
  while (seeds > 0) {
    i = (i + 1) % PITS;
    if (i === pit) continue; // skip the starting pit on later laps
    p[i]++;
    path.push(i);
    seeds--;
  }
  return { pits: p, path, last: i };
}

export function legalMoves(s) {
  if (s.over) return [];
  const mine = own(s.turn).filter((i) => s.pits[i] > 0);
  const opp = 1 - s.turn;
  if (seedsOnSide(s.pits, opp) > 0) return mine;
  // opponent has nothing: only moves that reach their side
  return mine.filter((i) => sow(s.pits, i).path.some((j) => side(j) === opp));
}

// Plays `pit` for whoever's turn it is. Returns the new state plus what happened, for animation:
// { state, path: [pits sown in order], captures: [{ pit, count }], from: pit }
export function play(s, pit) {
  if (!legalMoves(s).includes(pit)) throw new Error(`illegal move ${pit}`);
  const me = s.turn;
  const opp = 1 - me;
  const { pits, path, last } = sow(s.pits, pit);
  const captures = [];
  if (side(last) === opp) {
    for (let i = last; side(i) === opp && (pits[i] === 2 || pits[i] === 3); i = (i + PITS - 1) % PITS) {
      captures.push({ pit: i, count: pits[i] });
    }
  }
  const taken = captures.reduce((n, c) => n + c.count, 0);
  const grandSlam = taken > 0 && taken === seedsOnSide(pits, opp);
  if (grandSlam) captures.length = 0;
  for (const c of captures) pits[c.pit] = 0;

  const next = { ...s, pits, stores: s.stores.slice(), turn: opp };
  const gained = grandSlam ? 0 : taken;
  next.stores[me] += gained;
  next.quiet = gained ? 0 : s.quiet + 1;
  finishIfOver(next);
  return { state: next, path, captures, from: pit, grandSlam };
}

function finishIfOver(s) {
  const end = (reason) => {
    s.over = true;
    s.endReason = reason;
    s.winner = s.stores[0] === s.stores[1] ? null : s.stores[0] > s.stores[1] ? 0 : 1;
  };
  if (s.stores[0] > 24 || s.stores[1] > 24) return end('majority');
  if (s.stores[0] === 24 && s.stores[1] === 24) return end('draw');
  if (legalMoves(s).length === 0) {
    // The player to move can't move: either their row is empty (the other player couldn't feed
    // them) or they can't feed the other player. Whoever still has seeds keeps them.
    for (const p of [0, 1]) {
      s.stores[p] += seedsOnSide(s.pits, p);
      for (const i of own(p)) s.pits[i] = 0;
    }
    return end('no-moves');
  }
  if (s.quiet >= NO_CAPTURE_LIMIT) {
    for (const p of [0, 1]) {
      s.stores[p] += seedsOnSide(s.pits, p);
      for (const i of own(p)) s.pits[i] = 0;
    }
    return end('stalemate');
  }
}

// ── Computer player ──
// Alpha-beta search on the store difference. `level` 0 = easy, 1 = normal, 2 = hard.
const DEPTH = [1, 4, 7];

function evaluate(s, me) {
  if (s.over) {
    if (s.winner === me) return 1000 + s.stores[me];
    if (s.winner === 1 - me) return -1000 - s.stores[1 - me];
    return 0;
  }
  // seeds in hand count most; seeds on your own side are a small plus (more options later)
  return (s.stores[me] - s.stores[1 - me]) * 10 + (seedsOnSide(s.pits, me) - seedsOnSide(s.pits, 1 - me)) * 0.5;
}

function search(s, depth, alpha, beta, me) {
  if (depth === 0 || s.over) return evaluate(s, me);
  const moves = legalMoves(s);
  const maximizing = s.turn === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of moves) {
    const v = search(play(s, m).state, depth - 1, alpha, beta, me);
    if (maximizing) { best = Math.max(best, v); alpha = Math.max(alpha, v); }
    else { best = Math.min(best, v); beta = Math.min(beta, v); }
    if (beta <= alpha) break;
  }
  return best;
}

export function chooseMove(s, level = 1, random = Math.random) {
  const moves = legalMoves(s);
  if (moves.length === 1) return moves[0];
  if (level === 0 && random() < 0.35) return moves[Math.floor(random() * moves.length)];
  const me = s.turn;
  let best = -Infinity;
  let picks = [];
  for (const m of moves) {
    const v = search(play(s, m).state, DEPTH[level] - 1, -Infinity, Infinity, me);
    if (v > best + 1e-9) { best = v; picks = [m]; }
    else if (Math.abs(v - best) <= 1e-9) picks.push(m);
  }
  return picks[Math.floor(random() * picks.length)];
}
