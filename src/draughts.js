// International draughts (10×10, FMJD rules), the version played in Nigeria.
//
// Board: 100 squares indexed row * 10 + col, row 0 at the top. Only dark squares, where
// (row + col) is odd, are used. Player 0 (white, you) starts on rows 6–9 and moves up the
// board; player 1 (black, the computer) starts on rows 0–3 and moves down. White moves first.
//  - Men step one square diagonally forward, but capture forwards and backwards.
//  - Kings fly: they move any distance along an empty diagonal and capture a piece at any
//    distance, landing on any empty square beyond it.
//  - Capturing is compulsory and you must take the sequence that captures the most pieces.
//    Jumped pieces stay on the board until the move ends, so they block and can't be jumped
//    twice (the "Turkish strike" rule).
//  - A man is crowned only if it ends its move on the far row.
//  - You lose when you have no legal move. 25 king-only moves each without a capture, or the
//    same position three times, is a draw.

export const SIZE = 10;

const EMPTY = 0;
const WHITE_MAN = 1;
const WHITE_KING = 2;
const BLACK_MAN = 3;
const BLACK_KING = 4;
const QUIET_LIMIT = 50; // plies: 25 moves by each side

export const owner = (piece) => (piece === EMPTY ? -1 : piece <= WHITE_KING ? 0 : 1);
export const isKing = (piece) => piece === WHITE_KING || piece === BLACK_KING;

const rowOf = (sq) => Math.floor(sq / SIZE);
const farRow = (player) => (player === 0 ? 0 : SIZE - 1);

const DARK = [];
for (let sq = 0; sq < SIZE * SIZE; sq++) if ((rowOf(sq) + (sq % SIZE)) % 2 === 1) DARK.push(sq);

// RAYS[sq][dir] lists the squares from sq to the edge in each diagonal direction.
// Directions 0 and 1 point up the board (white's forward), 2 and 3 point down (black's).
const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const FORWARD = [[0, 1], [2, 3]];
const ALL_DIRS = [0, 1, 2, 3];
const RAYS = [];
for (let sq = 0; sq < SIZE * SIZE; sq++) {
  RAYS.push(DIRS.map(([dr, dc]) => {
    const ray = [];
    for (let r = rowOf(sq) + dr, c = (sq % SIZE) + dc; r >= 0 && r < SIZE && c >= 0 && c < SIZE; r += dr, c += dc) {
      ray.push(r * SIZE + c);
    }
    return ray;
  }));
}

export function newGame() {
  const board = Array(SIZE * SIZE).fill(EMPTY);
  for (const sq of DARK) {
    if (rowOf(sq) <= 3) board[sq] = BLACK_MAN;
    else if (rowOf(sq) >= 6) board[sq] = WHITE_MAN;
  }
  return { board, turn: 0, over: false, winner: null, result: null, reason: null, quiet: 0, history: {} };
}

// ── Move generation ──

function makeMove(from, path, captures, piece) {
  const to = path[path.length - 1];
  const crowned = !isKing(piece) && rowOf(to) === farRow(owner(piece));
  return { from, to, path: path.slice(), captures: captures.slice(), crowned };
}

// Along `ray`, the index of the piece a capture would jump (or -1). A man only looks at the
// adjacent square; a king looks past empty squares. There must be an empty square beyond.
function victimIndex(board, ray, king, enemy, captured) {
  let i = 0;
  if (king) while (i < ray.length && board[ray[i]] === EMPTY) i++;
  if (i >= ray.length - 1 || board[ray[i + 1]] !== EMPTY) return -1;
  // Jumped pieces stay on the board until the move ends: they block, and can't be taken twice.
  if (owner(board[ray[i]]) !== enemy || captured.includes(ray[i])) return -1;
  return i;
}

const NONE = []; // nothing captured yet

// Extends a capture sequence from `sq`, pushing every complete sequence onto `out`.
function extendCapture(board, sq, seq, out) {
  let extended = false;
  for (const ray of RAYS[sq]) {
    const i = victimIndex(board, ray, seq.king, seq.enemy, seq.captured);
    if (i < 0) continue;
    // A man lands right behind the piece it takes; a king may land on any empty square beyond.
    for (let j = i + 1; j < ray.length && board[ray[j]] === EMPTY; j++) {
      extended = true;
      seq.path.push(ray[j]);
      seq.captured.push(ray[i]);
      extendCapture(board, ray[j], seq, out);
      seq.path.pop();
      seq.captured.pop();
      if (!seq.king) break;
    }
  }
  if (!extended && seq.captured.length > 0) out.push(makeMove(seq.from, seq.path, seq.captured, seq.piece));
}

// Every complete capture sequence for the piece on `from`, pushed onto `out`.
// The board is restored before returning.
function captureSequences(board, from, out) {
  const piece = board[from];
  const king = isKing(piece);
  const enemy = 1 - owner(piece);
  let any = false; // cheap check first: most pieces have nothing to take
  for (const ray of RAYS[from]) if (victimIndex(board, ray, king, enemy, NONE) >= 0) any = true;
  if (!any) return;
  const seq = { from, piece, king, enemy, path: [], captured: [] };
  board[from] = EMPTY; // lifted, so a king may cross or land on its own start square
  extendCapture(board, from, seq, out);
  board[from] = piece;
}

function quietMoves(board, from, out) {
  const piece = board[from];
  const dirs = isKing(piece) ? ALL_DIRS : FORWARD[owner(piece)];
  for (const d of dirs) {
    for (const sq of RAYS[from][d]) {
      if (board[sq] !== EMPTY) break;
      out.push(makeMove(from, [sq], [], piece));
      if (!isKing(piece)) break;
    }
  }
}

// All legal moves for `player` on a raw board (may touch the board but always restores it).
function generate(board, player) {
  let moves = [];
  for (const sq of DARK) if (owner(board[sq]) === player) captureSequences(board, sq, moves);
  if (moves.length > 0) {
    const most = Math.max(...moves.map((m) => m.captures.length));
    const seen = new Set();
    moves = moves.filter((m) => {
      const key = m.from + ':' + m.path.join(',');
      if (m.captures.length !== most || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return moves;
  }
  for (const sq of DARK) if (owner(board[sq]) === player) quietMoves(board, sq, moves);
  return moves;
}

export function legalMoves(state) {
  if (state.over) return [];
  return generate(state.board.slice(), state.turn);
}

// Applies a move to a board in place and returns what it needs to be undone.
function applyMove(board, move) {
  const piece = board[move.from];
  const taken = move.captures.map((sq) => board[sq]);
  board[move.from] = EMPTY; // clear first: a king's capture can end where it started
  for (const sq of move.captures) board[sq] = EMPTY;
  board[move.to] = move.crowned ? piece + 1 : piece; // man + 1 is the same colour's king
  return { piece, taken };
}

function undoMove(board, move, { piece, taken }) {
  board[move.to] = EMPTY;
  board[move.from] = piece;
  move.captures.forEach((sq, i) => { board[sq] = taken[i]; });
}

const samePath = (a, b) => a.length === b.length && a.every((sq, i) => sq === b[i]);

export function play(state, move) {
  const legal = legalMoves(state).find((m) => m.from === move.from && samePath(m.path, move.path));
  if (!legal) throw new Error(`illegal move ${move.from} → ${move.path.join(' → ')}`);
  const board = state.board.slice();
  const { piece } = applyMove(board, legal);

  // A capture or a man moving can never be undone, so earlier positions can't come back.
  const reversible = legal.captures.length === 0 && isKing(piece);
  const next = {
    ...state,
    board,
    turn: 1 - state.turn,
    quiet: reversible ? state.quiet + 1 : 0,
    history: reversible ? { ...state.history } : {},
  };
  let key = String(next.turn);
  for (const sq of DARK) key += board[sq];
  next.history[key] = (next.history[key] || 0) + 1;

  const end = (result, winner, reason) => Object.assign(next, { over: true, result, winner, reason });
  if (generate(board, next.turn).length === 0) end('win', state.turn, 'no-moves');
  else if (next.history[key] >= 3) end('draw', null, 'repetition');
  else if (next.quiet >= QUIET_LIMIT) end('draw', null, 'quiet');
  return next;
}

// ── Computer player ──
// Iterative-deepening negamax with alpha-beta. Captures are never cut off at the horizon
// (they're compulsory, so the search keeps going until the position is quiet).

const MAN = 100;
const KING = 320;
const WIN = 100000;
const MAX_PLY = 64;
const TIMEOUT = Symbol('timeout');

// VALUE[piece][sq]: what a piece is worth on a square, from white's point of view.
const VALUE = Array.from({ length: 5 }, () => Array(SIZE * SIZE).fill(0));
for (const sq of DARK) {
  const r = rowOf(sq);
  const c = sq % SIZE;
  const centre = r >= 3 && r <= 6 && c >= 2 && c <= 7 ? 6 : 0;
  const man = MAN + (SIZE - 1 - r) * 3 + centre + (r === SIZE - 1 ? 8 : 0); // advance, but guard the back row
  const king = KING + centre;
  const mirror = SIZE * SIZE - 1 - sq; // black's view is the board turned round
  VALUE[WHITE_MAN][sq] = man;
  VALUE[WHITE_KING][sq] = king;
  VALUE[BLACK_MAN][mirror] = -man;
  VALUE[BLACK_KING][mirror] = -king;
}

function evaluate(board, player) {
  let score = 0;
  for (const sq of DARK) if (board[sq] !== EMPTY) score += VALUE[board[sq]][sq];
  return player === 0 ? score : -score;
}

const moveKey = (m) => m.from * 100 + m.to;

// Crowning moves and the last move that caused a cutoff at this depth are tried first.
function order(moves, killer) {
  const rank = (m) => (moveKey(m) === killer ? 2 : 0) + (m.crowned ? 1 : 0);
  return moves.sort((a, b) => rank(b) - rank(a));
}

function search(board, player, depth, alpha, beta, ply, ctx) {
  if ((++ctx.nodes & 255) === 0 && Date.now() > ctx.deadline) throw TIMEOUT;
  const moves = generate(board, player);
  if (moves.length === 0) return -WIN + ply; // can't move: lost (sooner is worse)
  if (depth <= 0 && (moves[0].captures.length === 0 || ply >= MAX_PLY)) return evaluate(board, player);
  if (ctx.ordered) order(moves, ctx.killers[ply]);
  let best = -Infinity;
  for (const m of moves) {
    const undo = applyMove(board, m);
    const score = -search(board, 1 - player, depth - 1, -beta, -alpha, ply + 1, ctx);
    undoMove(board, m, undo);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      ctx.killers[ply] = moveKey(m);
      break;
    }
  }
  return best;
}

// level 0 = easy, 1 = normal, 2 = hard. Returns one of legalMoves(state), or null if none.
export function chooseMove(state, level = 1, random = Math.random, timeLimitMs = 900) {
  const start = Date.now();
  const moves = legalMoves(state);
  if (moves.length <= 1) return moves[0] || null;
  if (level <= 0 && random() < 0.3) return moves[Math.floor(random() * moves.length)];
  const maxDepth = level <= 0 ? (random() < 0.5 ? 1 : 2) : level === 1 ? 4 : 8;

  // Shuffle so equally good moves vary from game to game.
  for (let i = moves.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [moves[i], moves[j]] = [moves[j], moves[i]];
  }

  const ctx = { nodes: 0, deadline: Infinity, ordered: level >= 2, killers: [] };
  let best = moves[0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    // Depth 1 always finishes so there's a sensible move even with a tiny time budget.
    ctx.deadline = depth === 1 ? Infinity : start + timeLimitMs;
    const board = state.board.slice(); // a timeout can leave it mid-move, so use a fresh copy
    const tried = [best, ...moves.filter((m) => m !== best)]; // last iteration's best first
    let alpha = -Infinity;
    let bestHere = best;
    try {
      for (const m of tried) {
        const undo = applyMove(board, m);
        const score = -search(board, 1 - state.turn, depth - 1, -Infinity, -alpha, 1, ctx);
        undoMove(board, m, undo);
        if (score > alpha) {
          alpha = score;
          bestHere = m;
        }
      }
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      // The old best was searched first, so anything that beat it before time ran out is better.
      best = bestHere;
      break;
    }
    best = bestHere;
    if (Math.abs(alpha) > WIN / 2) break; // a forced result: searching deeper won't change it
  }
  return best;
}
