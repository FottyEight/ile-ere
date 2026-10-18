// Ludo rules and computer players. Plain ES module: no DOM, no three.js, no dependencies.
//
// Board: the standard 15×15 cross. The shared track has 52 squares numbered 0–51 clockwise.
// Colours in seat order: red 0, green 1, yellow 2, blue 3. Colour c enters the track at 13c.
//
// Each token is a single number, its progress along its own colour's route:
//   -1       in base (the yard)
//    0       on its start square, track 13c
//    1..50   further round the track: progress p sits on track square (13c + p) % 52.
//            50 is the square at the end of the colour's own arm, just before its home column.
//   51..55   the colour's 5-square home column (home step 0..4)
//   56       finished (the centre triangle)
//
// Rules (common rules, one die):
//  - A 6 brings a token out of base onto its start square.
//  - Tokens move exactly the roll and must land exactly on 56; a roll that would overshoot
//    leaves that token unable to move.
//  - Landing on an opponent outside a safe square sends it back to base and earns a bonus roll.
//    Safe squares are the four start squares and the four stars (8, 21, 34, 47).
//  - With `blocks` on, two or more tokens of one colour on a track square form a block that
//    opponents can neither land on nor pass. With `blocks` off, landing on several opponent
//    tokens of one colour captures them all.
//  - A 6 earns another roll after moving. A third 6 in a row is forfeited and the turn passes.
//  - Finishing a token earns a bonus roll when `bonusOnFinish` is on.
//  - One move earns at most one bonus roll, even if it qualifies for several reasons.
//  - No legal move means the turn passes, even on a 6 (the extra roll needs a move).
//  - The first colour with all four tokens home wins and the game ends there.

export const TRACK = 52;
export const BASE = -1;
export const LAST_TRACK = 50;
export const HOME_START = 51;
export const FINISHED = 56;
export const STARS = [8, 21, 34, 47];
export const SAFE_SQUARES = [0, 13, 26, 39, ...STARS];

const SAFE = new Set(SAFE_SQUARES);

export const startSquare = (colour) => colour * 13;
export const isSafe = (index) => SAFE.has(index);
// Track square for a progress value, or -1 when the token isn't on the shared track.
export const trackIndex = (colour, progress) =>
  progress >= 0 && progress <= LAST_TRACK ? (startSquare(colour) + progress) % TRACK : -1;

export function locate(colour, progress, tokenIndex = 0) {
  if (progress === BASE) return { kind: 'base', slot: tokenIndex };
  if (progress <= LAST_TRACK) return { kind: 'track', index: trackIndex(colour, progress) };
  if (progress < FINISHED) return { kind: 'home', step: progress - HOME_START };
  return { kind: 'finished' };
}

// Dice come from roll(), so a `random` option here is simply ignored.
export function newGame({ colours = [0, 1, 2], blocks = true, bonusOnFinish = true } = {}) {
  // turn order is clockwise, which is seat order
  const seats = [...new Set(colours)].sort((a, b) => a - b);
  if (seats.length < 2 || seats.some((c) => ![0, 1, 2, 3].includes(c))) {
    throw new Error('need 2–4 different colours from 0–3');
  }
  const tokens = {};
  for (const c of seats) tokens[c] = [BASE, BASE, BASE, BASE];
  return {
    colours: seats, tokens, turn: seats[0], phase: 'roll', roll: null, sixes: 0,
    over: false, winner: null, options: { blocks, bonusOnFinish },
  };
}

function clone(s) {
  const tokens = {};
  for (const c of s.colours) tokens[c] = s.tokens[c].slice();
  return { ...s, colours: s.colours.slice(), tokens, options: { ...s.options } };
}

const countOn = (s, colour, index) => s.tokens[colour].filter((p) => trackIndex(colour, p) === index).length;

function opponentsOn(s, colour, index) {
  const found = [];
  for (const c of s.colours) {
    if (c === colour) continue;
    s.tokens[c].forEach((p, token) => { if (trackIndex(c, p) === index) found.push({ colour: c, token }); });
  }
  return found;
}

const isBlocked = (s, colour, index) =>
  s.options.blocks && s.colours.some((c) => c !== colour && countOn(s, c, index) >= 2);

function moveFor(s, colour, token, value) {
  const from = s.tokens[colour][token];
  if (from === FINISHED) return null;
  if (from === BASE) {
    if (value !== 6 || isBlocked(s, colour, startSquare(colour))) return null;
    // start squares are safe, so entering never captures
    return { token, from, to: 0, captures: [], enters: true, finishes: false };
  }
  const to = from + value;
  if (to > FINISHED) return null;
  // every track square passed or landed on must be free of opposing blocks
  for (let p = from + 1; p <= Math.min(to, LAST_TRACK); p++) {
    if (isBlocked(s, colour, trackIndex(colour, p))) return null;
  }
  const landing = trackIndex(colour, to);
  const captures = landing >= 0 && !isSafe(landing) ? opponentsOn(s, colour, landing) : [];
  return { token, from, to, captures, enters: false, finishes: to === FINISHED };
}

export function legalMoves(s) {
  if (s.over || s.phase !== 'move') return [];
  const moves = [];
  for (let t = 0; t < 4; t++) {
    const m = moveFor(s, s.turn, t, s.roll);
    if (m) moves.push(m);
  }
  return moves;
}

function passTurn(s, events) {
  s.turn = s.colours[(s.colours.indexOf(s.turn) + 1) % s.colours.length];
  s.phase = 'roll';
  s.roll = null;
  s.sixes = 0;
  events.push({ type: 'turn', colour: s.turn });
  return { state: s, events };
}

export function roll(state, random = Math.random, forcedValue) {
  if (state.over || state.phase !== 'roll') throw new Error('not time to roll');
  const value = forcedValue ?? 1 + Math.floor(random() * 6);
  if (!Number.isInteger(value) || value < 1 || value > 6) throw new Error(`bad die value ${value}`);
  const s = clone(state);
  const colour = s.turn;
  const events = [{ type: 'roll', colour, value }];
  // sixes counts consecutive sixes this turn; a bonus roll that isn't a 6 breaks the run
  s.sixes = value === 6 ? s.sixes + 1 : 0;
  if (s.sixes === 3) {
    events.push({ type: 'forfeit', colour });
    return passTurn(s, events);
  }
  s.roll = value;
  s.phase = 'move';
  if (legalMoves(s).length === 0) {
    events.push({ type: 'noMove', colour });
    return passTurn(s, events);
  }
  return { state: s, events };
}

export function move(state, choice) {
  const token = typeof choice === 'object' && choice !== null ? choice.token : choice;
  const m = legalMoves(state).find((x) => x.token === token);
  if (!m) throw new Error(`illegal move ${token}`);
  const s = clone(state);
  const colour = s.turn;
  const path = [];
  if (m.enters) path.push(0);
  else for (let p = m.from + 1; p <= m.to; p++) path.push(p);

  s.tokens[colour][m.token] = m.to;
  const events = [{ type: 'move', colour, token: m.token, from: m.from, to: m.to, path }];
  for (const c of m.captures) {
    s.tokens[c.colour][c.token] = BASE;
    events.push({ type: 'capture', colour: c.colour, token: c.token, by: colour });
  }
  if (m.finishes) {
    events.push({ type: 'finish', colour, token: m.token });
    if (s.tokens[colour].every((p) => p === FINISHED)) {
      s.over = true;
      s.winner = colour;
      s.phase = 'roll';
      s.roll = null;
      events.push({ type: 'win', colour });
      return { state: s, events };
    }
  }

  const reason = m.captures.length ? 'capture'
    : m.finishes && s.options.bonusOnFinish ? 'finish'
      : s.roll === 6 ? 'six' : null;
  if (!reason) return passTurn(s, events);
  events.push({ type: 'bonus', colour, reason });
  s.phase = 'roll';
  s.roll = null;
  return { state: s, events };
}

// ── Computer players ──
// level 0 easy: any legal move. 1 normal: a short list of rules of thumb.
// 2 hard: scores every move on progress, captures, risk to all own tokens, chances to capture
// next turn, blocks and reaching the home column.

// Rough chance that an opponent lands on track square `index` (holding `colour`) next turn.
// A token d squares behind hits with a single roll for d ≤ 6, or a 6 then d − 6 for d ≤ 12;
// a token in base can come out on a 6 and then reach the six squares after its start.
function danger(s, colour, index) {
  if (index < 0 || isSafe(index)) return 0;
  if (s.options.blocks && countOn(s, colour, index) >= 2) return 0;
  let miss = 1;
  for (const c of s.colours) {
    if (c === colour) continue;
    let inBase = false;
    for (const p of s.tokens[c]) {
      if (p === BASE) { inBase = true; continue; }
      if (p > LAST_TRACK) continue;
      const d = (index - trackIndex(c, p) + TRACK) % TRACK;
      if (d === 0 || p + d > LAST_TRACK) continue; // it turns into its home column first
      miss *= 1 - (d <= 6 ? 1 / 6 : d <= 12 ? 1 / 36 : 0);
    }
    const d = (index - startSquare(c) + TRACK) % TRACK;
    if (inBase && d >= 1 && d <= 6) miss *= 1 - 1 / 36;
  }
  return 1 - miss;
}

// What losing a token at this progress costs: the squares it would have to cover again,
// plus the turns spent waiting for a 6 to get out of base.
const worth = (p) => 20 + p;

function riskOf(s, colour) {
  let total = 0;
  for (const p of s.tokens[colour]) total += danger(s, colour, trackIndex(colour, p)) * worth(p);
  return total;
}

function after(s, m) {
  const next = clone(s);
  next.tokens[s.turn][m.token] = m.to;
  for (const c of m.captures) next.tokens[c.colour][c.token] = BASE;
  return next;
}

// Chance-weighted value of opponents left within one roll in front of a track square.
function threatValue(s, colour, progress) {
  const here = trackIndex(colour, progress);
  if (here < 0) return 0;
  let total = 0;
  for (const c of s.colours) {
    if (c === colour) continue;
    for (const p of s.tokens[c]) {
      const there = trackIndex(c, p);
      const d = (there - here + TRACK) % TRACK;
      if (there >= 0 && d >= 1 && d <= 6 && progress + d <= LAST_TRACK && !isSafe(there)) total += worth(p) / 6;
    }
  }
  return total;
}

// Weights tuned by self-play against the normal player.
function hardScore(s, m) {
  const colour = s.turn;
  const next = after(s, m);
  let v = m.enters ? 20 : m.to - m.from + 0.05 * m.from; // slight lean towards the leading token
  for (const c of m.captures) v += 12 + worth(s.tokens[c.colour][c.token]);
  if (m.finishes) v += 12;
  else if (m.from <= LAST_TRACK && m.to >= HOME_START) v += 8; // out of reach for good
  if (s.options.blocks && m.to <= LAST_TRACK && countOn(next, colour, trackIndex(colour, m.to)) >= 2) v += 3;
  v += 0.5 * threatValue(next, colour, m.to);
  // risk to every own token, so leaving a partner exposed or stepping out of danger both count
  v += 1.6 * (riskOf(s, colour) - riskOf(next, colour));
  return v;
}

const THREAT = 0.16; // about one opponent within a single roll

function normalChoice(s, moves) {
  const colour = s.turn;
  const risk = (state, p) => danger(state, colour, trackIndex(colour, p));
  const byFrom = (a, b) => b.from - a.from;
  const capture = moves.filter((m) => m.captures.length)
    .sort((a, b) => s.tokens[b.captures[0].colour][b.captures[0].token] - s.tokens[a.captures[0].colour][a.captures[0].token]);
  if (capture.length) return capture[0];
  const rescue = moves.filter((m) => m.from >= 0 && risk(s, m.from) >= THREAT && risk(after(s, m), m.to) < THREAT);
  if (rescue.length) return rescue.sort(byFrom)[0];
  const enter = moves.find((m) => m.enters);
  if (enter) return enter;
  const calm = moves.filter((m) => risk(after(s, m), m.to) < THREAT);
  return (calm.length ? calm : moves).sort(byFrom)[0];
}

export function chooseMove(state, level = 1, random = Math.random) {
  const moves = legalMoves(state);
  if (!moves.length) throw new Error('no legal move');
  if (moves.length === 1 || level <= 0) return moves[Math.floor(random() * moves.length)].token;
  if (level === 1) return normalChoice(state, moves).token;
  let best = -Infinity;
  let picks = [];
  for (const m of moves) {
    const v = hardScore(state, m);
    if (v > best + 1e-9) { best = v; picks = [m]; }
    else if (Math.abs(v - best) <= 1e-9) picks.push(m);
  }
  return picks[Math.floor(random() * picks.length)].token;
}
