// "How to play" guides for Baba's Joint: the joint itself and each of the six tables.
// Plain data plus small inline SVG diagrams (built once, below). No DOM, no dependencies.
//
//   GUIDES[id]   = { title, intro, sections: [{ heading, html, diagram? }] }
//   CONTROLS[id] = short lines for an on-screen controls strip
//   LESSONS[id]  = what each host says while teaching your first game, keyed by step
//
// Everything here follows the rules engines (ayo.js, draughts.js, whot.js, ludo.js, snooker.js,
// foosball.js) and the table controls; change them together.

// ── Colours ──
const GOLD = '#ffd76a';
const CREAM = '#fffaf2';
const MAROON = '#7a1f2b';
const CARD = '#fbf6ec';
const HOT = '#ff7a59'; // captures
const COOL = '#7fc8ff'; // moves
const LUDO = ['#d63031', '#00a65a', '#f5b700', '#1e6fd9'];
const FELT = '#1f7a4a';

// ── SVG helpers ──
const FONT = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
// Text defaults (12px, cream, centred) sit on the root so each <text> stays short.
const svg = (w, h, label, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${label}" font-family="${FONT}" font-size="12" text-anchor="middle" fill="${CREAM}">${body}</svg>`;
const r1 = (n) => Math.round(n * 10) / 10;
const text = (x, y, s, { size = 12, fill = CREAM, anchor = 'middle', weight = '' } = {}) =>
  `<text x="${r1(x)}" y="${r1(y)}"${size !== 12 ? ` font-size="${size}"` : ''}${fill !== CREAM ? ` fill="${fill}"` : ''}${anchor !== 'middle' ? ` text-anchor="${anchor}"` : ''}${weight ? ` font-weight="${weight}"` : ''}>${s}</text>`;

// A line through `pts` with an arrowhead at the end (no <marker>, so many diagrams can share a page).
function arrow(pts, { color = GOLD, width = 2.5, head = 7, dash = '' } = {}) {
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join('');
  const [x1, y1] = pts[pts.length - 2];
  const [x2, y2] = pts[pts.length - 1];
  const a = Math.atan2(y2 - y1, x2 - x1);
  const p = (ang, len) => `${r1(x2 - Math.cos(ang) * len)},${r1(y2 - Math.sin(ang) * len)}`;
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
    + `<polygon points="${r1(x2)},${r1(y2)} ${p(a - 0.45, head)} ${p(a + 0.45, head)}" fill="${color}"/>`;
}

function starPoints(cx, cy, R, inner = 0.45) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? R * inner : R;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${r1(cx + Math.cos(a) * r)},${r1(cy + Math.sin(a) * r)}`);
  }
  return pts.join(' ');
}

// ── Ayo ──
// Your row is pits 0–5 left to right; Baba's row is 6–11 from right to left (sowing goes i → i+1).
const AYO_X = (col) => 46 + col * 46;
const AYO_TOP = 70;
const AYO_BOT = 126;
const AYO_MID = (AYO_TOP + AYO_BOT) / 2;
const ayoPos = (pit) => (pit < 6 ? [AYO_X(pit), AYO_BOT] : [AYO_X(11 - pit), AYO_TOP]);

function ayoBoard(counts, extra = '', rings = {}) {
  let b = `<rect x="8" y="24" width="304" height="140" rx="22" fill="#8a5a32" stroke="#5c3a1e" stroke-width="3"/>`;
  b += text(160, 15, 'Baba’s row', { fill: GOLD });
  b += text(160, 182, 'Your row: keys 1–6', { fill: GOLD });
  b += extra;
  let pits = '';
  let nums = '';
  let keys = '';
  counts.forEach((n, pit) => {
    const [x, y] = ayoPos(pit);
    const ring = rings[pit];
    pits += `<circle cx="${x}" cy="${y}" r="19"${ring ? ` stroke="${ring}" stroke-width="3"` : ''}/>`;
    nums += `<text x="${x}" y="${y + 5}">${n}</text>`;
    if (pit < 6) keys += `<text x="${x}" y="158">${pit + 1}</text>`;
  });
  return `${b}<g fill="#3d2513">${pits}</g><g font-size="14" font-weight="bold">${nums}</g><g font-size="11" fill="#f1d9a8">${keys}</g>`;
}

const AYO_SOW = svg(320, 190, 'Seeds go anticlockwise: right along your row, then left along Baba’s row',
  ayoBoard(Array(12).fill(4),
    `<path d="M46 ${AYO_BOT}H276Q298 ${AYO_BOT} 298 ${AYO_MID}Q298 ${AYO_TOP} 276 ${AYO_TOP}H46Q22 ${AYO_TOP} 22 ${AYO_MID}Q22 ${AYO_BOT} 46 ${AYO_BOT}" fill="none" stroke="${GOLD}" stroke-width="2.5" stroke-dasharray="5 4"/>`
    + `<polygon points="298,${AYO_MID - 8} 292,${AYO_MID + 4} 304,${AYO_MID + 4}" fill="${GOLD}"/><polygon points="22,${AYO_MID + 8} 16,${AYO_MID - 4} 28,${AYO_MID - 4}" fill="${GOLD}"/>`));

// Your 5th pit (index 4) held 3 seeds: they went into pits 5, 6 and 7. Pit 7 now has 3 and pit 6 has 2: both taken.
const AYO_CAPTURE = (() => {
  const counts = [4, 4, 4, 4, 0, 5, 2, 3, 4, 4, 4, 4];
  const [x4, y4] = ayoPos(4);
  const [x5, y5] = ayoPos(5);
  const [x6, y6] = ayoPos(6);
  const [x7, y7] = ayoPos(7);
  const hop = { color: COOL, width: 3, head: 8 };
  // hops drawn in the gap between the rows
  const extra = arrow([[x4 + 6, y4 - 20], [x4 + 23, AYO_MID + 3], [x5 - 8, y5 - 22]], hop)
    + arrow([[x5 + 18, y5 - 10], [x5 + 24, AYO_MID], [x6 + 19, y6 + 12]], hop)
    + arrow([[x6 - 6, y6 + 20], [x6 - 23, AYO_MID - 3], [x7 + 8, y7 + 22]], hop)
    + text(x7, 46, '+3', { size: 14, fill: HOT, weight: 'bold' })
    + text(x6, 46, '+2', { size: 14, fill: HOT, weight: 'bold' });
  return svg(320, 190, 'Sowing 3 seeds from your 5th pit: the last seed makes 3 in Baba’s pit, and the pit before it holds 2, so you take 5',
    ayoBoard(counts, extra, { 4: GOLD, 6: HOT, 7: HOT }));
})();

// ── Draughts ──
// A corner of the 10×10 board. Rows count from the top (Tunde's side); you play white, upwards.
function dBoard(rows, cols, pieces, overlay = () => '', label = 'Draughts') {
  const S = 34;
  const ox = (320 - cols * S) / 2;
  const at = (r, c) => [ox + c * S + S / 2, 6 + r * S + S / 2];
  // light background, then every dark square in one path
  let dark = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) if ((r + c) % 2) dark += `M${ox + c * S} ${6 + r * S}h${S}v${S}h-${S}z`;
  }
  let b = `<rect x="${ox}" y="6" width="${cols * S}" height="${rows * S}" fill="#e8d4ab" stroke="#5c3a1e" stroke-width="2"/><path d="${dark}" fill="#8b5a36"/>`;
  for (const p of pieces) {
    const [x, y] = at(p.r, p.c);
    const white = p.side === 'w';
    b += `<circle cx="${x}" cy="${y}" r="12" fill="${white ? '#f1ead9' : '#221a16'}" stroke="${white ? '#7d6a48' : '#c9b892'}" stroke-width="2"${p.taken ? ' opacity=".55"' : ''}/>`;
    if (p.king) b += `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="#e8b84a" stroke-width="3"/>`;
    if (p.taken) b += `<path d="M${x - 8} ${y - 8}l16 16m0 -16l-16 16" stroke="${HOT}" stroke-width="3" stroke-linecap="round"/>`;
  }
  return svg(320, rows * S + 12, label, b + overlay(at));
}
const ring = ([x, y], color = COOL, dash = '') =>
  `<circle cx="${x}" cy="${y}" r="12" fill="none" stroke="${color}" stroke-width="2.5"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
const cross = ([x, y]) => `<path d="M${x - 6} ${y - 6}l12 12m0 -12l-12 12" stroke="#ffb3a3" stroke-width="2.5" stroke-linecap="round"/>`;
const toward = ([x1, y1], [x2, y2], cut = 14) => {
  const d = Math.hypot(x2 - x1, y2 - y1);
  return [x2 - ((x2 - x1) / d) * cut, y2 - ((y2 - y1) / d) * cut];
};

const DRAUGHTS_MOVE = dBoard(4, 5, [{ r: 2, c: 3, side: 'w' }], (at) => {
  const from = at(2, 3);
  return arrow([from, toward(from, at(1, 2))]) + arrow([from, toward(from, at(1, 4))])
    + ring(at(1, 2)) + ring(at(1, 4)) + cross(at(3, 2)) + cross(at(3, 4));
}, 'A man steps one square diagonally forward, never backwards');

const DRAUGHTS_BACK = dBoard(4, 5, [{ r: 1, c: 2, side: 'w' }, { r: 2, c: 3, side: 'b', taken: true }], (at) => {
  const from = at(1, 2);
  return arrow([from, toward(from, at(3, 4))], { color: HOT }) + ring(at(3, 4), HOT);
}, 'A man may capture backwards: white jumps a black man behind it');

const DRAUGHTS_MULTI = dBoard(6, 6, [
  { r: 5, c: 2, side: 'w' },
  { r: 4, c: 3, side: 'b', taken: true },
  { r: 2, c: 3, side: 'b', taken: true },
  { r: 2, c: 1, side: 'b', taken: true },
  { r: 0, c: 5, side: 'b' },
], (at) => arrow([at(5, 2), at(3, 4), at(1, 2), toward(at(1, 2), at(3, 0))], { color: HOT })
  + ring(at(3, 0), HOT)
  + [[3, 4, 1], [1, 2, 2], [3, 0, 3]].map(([r, c, n]) => `<circle cx="${at(r, c)[0]}" cy="${at(r, c)[1]}" r="8" fill="${GOLD}"/>${text(at(r, c)[0], at(r, c)[1] + 4, n, { fill: '#2b1f16', weight: 'bold' })}`).join(''),
'One move, three captures: jump, jump again, even backwards. You must take the most you can');

const DRAUGHTS_KING = dBoard(6, 6, [{ r: 5, c: 0, side: 'w', king: true }, { r: 2, c: 3, side: 'b', taken: true }], (at) => {
  const from = at(5, 0);
  return arrow([from, toward(from, at(1, 4))], { color: HOT }) + ring(at(1, 4), HOT) + ring(at(0, 5), HOT, '3 3');
}, 'A king flies along an empty diagonal, captures from a distance and lands on any empty square beyond (either ringed square)');

// ── Whot ──
function shape(kind, x, y, s, fill = MAROON) {
  if (kind === 'circle') return `<circle cx="${x}" cy="${y}" r="${s}" fill="${fill}"/>`;
  if (kind === 'triangle') return `<polygon points="${x},${r1(y - s)} ${r1(x + s)},${r1(y + s * 0.8)} ${r1(x - s)},${r1(y + s * 0.8)}" fill="${fill}"/>`;
  if (kind === 'square') return `<rect x="${r1(x - s * 0.85)}" y="${r1(y - s * 0.85)}" width="${r1(s * 1.7)}" height="${r1(s * 1.7)}" fill="${fill}"/>`;
  if (kind === 'cross') {
    const t = r1(s * 0.38);
    return `<path d="M${r1(x - t)} ${r1(y - s)}h${r1(2 * t)}v${r1(s - t)}h${r1(s - t)}v${r1(2 * t)}h${r1(t - s)}v${r1(s - t)}h${r1(-2 * t)}v${r1(t - s)}h${r1(t - s)}v${r1(-2 * t)}h${r1(s - t)}z" fill="${fill}"/>`;
  }
  return `<polygon points="${starPoints(x, y, s)}" fill="${fill}"/>`;
}
// a mini Whot card, top-left corner at (x, y)
function card(x, y, number, kind, { dim = false, edge = MAROON } = {}) {
  const w = 40;
  const h = 58;
  let b = `<g${dim ? ' opacity="0.45"' : ''}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${CARD}" stroke="${edge}" stroke-width="${edge === MAROON ? 1.5 : 3}"/>`;
  b += text(x + 8, y + 15, number, { size: 12, fill: MAROON, weight: 'bold', anchor: 'start' });
  b += kind === 'whot'
    ? text(x + w / 2, y + 38, 'WHOT', { size: 11, fill: MAROON, weight: 'bold' })
    : shape(kind, x + w / 2, y + 34, 10);
  return `${b}</g>`;
}

const WHOT_SPECIALS = (() => {
  const list = [
    [1, 'circle', 'Hold on', 'play again'],
    [2, 'triangle', 'Pick two', 'next picks 2'],
    [5, 'star', 'Pick three', 'next picks 3'],
    [8, 'square', 'Suspension', 'next misses a turn'],
    [14, 'cross', 'General market', 'others pick 1'],
    [20, 'whot', 'Whot', 'call a shape'],
  ];
  let b = '';
  list.forEach(([n, k, name, what], i) => {
    const cx = 54 + (i % 3) * 106;
    const y = 6 + Math.floor(i / 3) * 104;
    b += card(cx - 20, y, n, k);
    b += text(cx, y + 76, name, { size: 12, fill: GOLD, weight: 'bold' });
    b += text(cx, y + 92, what, { size: 11 });
  });
  return svg(320, 206, 'The special cards: 1 Hold on, 2 Pick two, 5 Pick three, 8 Suspension, 14 General market, 20 Whot', b);
})();

const WHOT_MATCH = (() => {
  let b = text(40, 14, 'On top', { size: 12, fill: GOLD });
  b += card(20, 22, 7, 'circle');
  b += `<line x1="84" y1="12" x2="84" y2="128" stroke="#6b5440" stroke-width="1.5"/>`;
  b += text(206, 14, 'Your hand', { size: 12, fill: GOLD });
  const hand = [[7, 'triangle', 'number', true], [3, 'circle', 'shape', true], [20, 'whot', 'any time', true], [10, 'square', 'no', false]];
  hand.forEach(([n, k, why, ok], i) => {
    const x = 100 + i * 54;
    b += card(x, 22, n, k, { dim: !ok, edge: ok ? GOLD : MAROON });
    b += text(x + 20, 98, ok ? '✓' : '✗', { size: 14, fill: ok ? '#9be38a' : '#ff9b8a', weight: 'bold' });
    b += text(x + 20, 116, why, { size: 11 });
  });
  return svg(320, 128, 'On a 7 circle you can play any 7, any circle, or a Whot. A 10 square does not match', b);
})();

// ── Ludo ──
// Red's corner of the board: its yard, the left arm and the top arm, and the centre.
const LUDO_CORNER = (() => {
  const S = 18;
  const O = 6;
  const px = (c) => O + c * S;
  const mid = (c) => O + c * S + S / 2;
  let b = `<rect x="${O}" y="${O}" width="${6 * S}" height="${6 * S}" fill="${LUDO[0]}"/>`;
  b += `<rect x="${px(1)}" y="${px(1)}" width="${4 * S}" height="${4 * S}" fill="${CARD}"/>`;
  b += `<g fill="${LUDO[0]}" stroke="#7d1414" stroke-width="1.5">`;
  for (const [u, v] of [[2, 2], [4, 2], [2, 4], [4, 4]]) b += `<circle cx="${px(u)}" cy="${px(v)}" r="${S * 0.55}"/>`;
  b += '</g>';
  // the two arms: cream, then the coloured cells, then one path for the grid lines
  b += `<rect x="${px(0)}" y="${px(6)}" width="${6 * S}" height="${3 * S}" fill="${CARD}"/><rect x="${px(6)}" y="${px(0)}" width="${3 * S}" height="${6 * S}" fill="${CARD}"/>`;
  b += `<path d="M${px(1)} ${px(6)}h${S}v${S}h-${S}zM${px(1)} ${px(7)}h${5 * S}v${S}h-${5 * S}z" fill="${LUDO[0]}"/>`;
  b += `<path d="M${px(8)} ${px(1)}h${S}v${S}h-${S}zM${px(7)} ${px(1)}h${S}v${5 * S}h-${S}z" fill="${LUDO[1]}"/>`;
  let grid = '';
  for (let i = 0; i <= 6; i++) grid += `M${px(i)} ${px(6)}v${3 * S}M${px(6)} ${px(i)}h${3 * S}`;
  for (let i = 6; i <= 9; i++) grid += `M${px(0)} ${px(i)}h${6 * S}M${px(i)} ${px(0)}v${6 * S}`;
  b += `<path d="${grid}" stroke="#3a3a3a" fill="none"/>`;
  for (const [c, r] of [[2, 8], [6, 2]]) b += `<polygon points="${starPoints(mid(c), mid(r), 7.5)}" fill="#8a8a8a"/>`;
  // the centre triangles: red (left), green (top), yellow (right), blue (bottom)
  const C = [px(7.5), px(7.5)];
  const corners = [[px(6), px(6)], [px(9), px(6)], [px(9), px(9)], [px(6), px(9)]];
  [[3, 0, 0], [0, 1, 1], [1, 2, 2], [2, 3, 3]].forEach(([a, z, k]) => {
    b += `<polygon points="${C.join(',')} ${corners[a].join(',')} ${corners[z].join(',')}" fill="${LUDO[k]}"/>`;
  });
  // out of the yard on a 6, round the track, and home up the red column
  b += arrow([[px(3), px(3) + 10], [mid(1) + 2, mid(6) - 4]], { color: '#2b1f16', width: 3, head: 7 });
  b += `<rect x="${px(3) - 10}" y="${px(3) - 10}" width="20" height="20" rx="3" fill="${CREAM}" stroke="#333"/>`;
  b += text(px(3), px(3) + 5, '6', { size: 14, fill: '#111', weight: 'bold' });
  b += arrow([[mid(2), mid(6)], [mid(5), mid(6)], [mid(6), mid(5)], [mid(6), mid(3.2)]], { color: '#1d4fa0', width: 2, head: 6 });
  b += arrow([[mid(0), mid(7)], [px(6.7), mid(7)]], { color: CREAM, width: 2.5, head: 6 });
  // the key
  const k = (y, sw, label) => `${sw}${text(196, y + 4, label, { size: 12, anchor: 'start' })}`;
  b += k(18, `<rect x="176" y="8" width="16" height="16" fill="${CREAM}" stroke="#333"/>${text(184, 21, '6', { size: 12, fill: '#111', weight: 'bold' })}`, 'roll 6 to come out');
  b += k(48, `<rect x="176" y="38" width="16" height="16" fill="${LUDO[0]}" stroke="#333"/>`, 'start square: safe');
  b += k(78, `<polygon points="${starPoints(184, 78, 8)}" fill="#bdbdbd"/>`, 'star: safe');
  b += k(108, `<rect x="168" y="100" width="24" height="16" fill="${LUDO[0]}"/><line x1="172" y1="108" x2="188" y2="108" stroke="${CREAM}" stroke-width="2"/>`, '5-square home');
  b += text(196, 128, 'column, then centre', { size: 12, anchor: 'start' });
  b += k(152, `<line x1="174" y1="152" x2="192" y2="152" stroke="#1d4fa0" stroke-width="3"/>`, 'way round: clockwise');
  return svg(320, 174, 'Red’s corner of the board: a 6 brings a token out to the start square; it goes round clockwise, then up the 5-square red column', b);
})();

// ── Snooker ──
const BALL = {
  red: ['#c62828', 1, CREAM], yellow: ['#f2c40f', 2, '#111'], green: ['#1f9a4c', 3, CREAM], brown: ['#7b4a26', 4, CREAM],
  blue: ['#2e6fd8', 5, CREAM], pink: ['#f49ac1', 6, '#111'], black: ['#141414', 7, CREAM],
};
// (wrap balls in BALL_G so they share the outline)
const BALL_G = (inner) => `<g stroke="#e8dcc8" stroke-width="1.2">${inner}</g>`;
const ball = (x, y, id, r = 11, num = true) => {
  const [fill, v, ink] = BALL[id];
  return `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="${fill}"/>${num ? text(x, y + 4, v, { size: 11, fill: ink, weight: 'bold' }).replace('<text', '<text stroke="none"') : ''}`;
};

const SNOOKER_TABLE = (() => {
  // metres → px: x along the table (baulk on the left), z across it
  const K = 110;
  const X = (m) => 160 + m * K;
  const Z = (m) => 88 + m * K;
  const HL = 1.3;
  const HW = 0.7;
  const baulk = -HL + 0.55;
  let b = `<rect x="${X(-HL) - 10}" y="${Z(-HW) - 10}" width="${2.6 * K + 20}" height="${1.4 * K + 20}" rx="8" fill="#5a3a22"/>`;
  b += `<rect x="${X(-HL)}" y="${Z(-HW)}" width="${2.6 * K}" height="${1.4 * K}" fill="${FELT}"/>`;
  for (const [x, z] of [[-HL, -HW], [0, -HW], [HL, -HW], [-HL, HW], [0, HW], [HL, HW]]) b += `<circle cx="${r1(X(x))}" cy="${r1(Z(z))}" r="7" fill="#111"/>`;
  b += `<line x1="${r1(X(baulk))}" y1="${Z(-HW)}" x2="${r1(X(baulk))}" y2="${Z(HW)}" stroke="#d9f0e0" stroke-width="1.2"/>`;
  const dr = 0.22 * K;
  b += `<path d="M${r1(X(baulk))} ${r1(Z(-0.22))}A${r1(dr)} ${r1(dr)} 0 0 0 ${r1(X(baulk))} ${r1(Z(0.22))}" fill="none" stroke="#d9f0e0" stroke-width="1.2"/>`;
  b += text(X(baulk) - 36, Z(0) + 5, 'D', { size: 14, fill: GOLD, weight: 'bold' });
  // reds: the triangle behind the pink, pointing at it
  const d = 0.054;
  const apex = 0.62 + 0.054;
  let reds = '';
  for (let row = 0; row < 5; row++) for (let k = 0; k <= row; k++) reds += `<circle cx="${r1(X(apex + row * d * 0.87))}" cy="${r1(Z((k - row / 2) * d))}" r="2.9"/>`;
  b += `<g fill="${BALL.red[0]}">${reds}</g>`;
  const spots = { yellow: [baulk, 0.22], green: [baulk, -0.22], brown: [baulk, 0], blue: [0, 0], pink: [0.62, 0], black: [1.05, 0] };
  b += BALL_G(Object.entries(spots).map(([id, [x, z]]) => ball(X(x), Z(z), id, 6, false)).join(''));
  b += `<circle cx="${r1(X(-0.85))}" cy="${r1(Z(0.08))}" r="6" fill="#fdfdf8" stroke="#999"/>`;
  // values key
  const order = ['red', 'yellow', 'green', 'brown', 'blue', 'pink', 'black'];
  b += BALL_G(order.map((id, i) => ball(34 + i * 42, 204, id)).join(''));
  b += text(160, 228, 'points per ball', { size: 11, fill: GOLD });
  return svg(320, 234, 'The snooker table: 15 reds in a triangle, the six colours on their spots, the cue ball in the D; reds 1, yellow 2 to black 7', b);
})();

const SNOOKER_ORDER = (() => {
  let b = text(10, 16, 'While reds are left:', { size: 12, fill: GOLD, anchor: 'start' });
  const x = 22;
  const go = (x1, x2, y) => {
    const head = `<polygon points="${x2},${y} ${x2 - 6},${y - 3} ${x2 - 6},${y + 3}"/>`;
    return `<path d="M${x1} ${y}H${x2 - 4}"/>${head}`;
  };
  const colours = ['yellow', 'green', 'brown', 'blue', 'pink', 'black'];
  // "any colour": a little fan of colours
  b += BALL_G(ball(x, 42, 'red') + colours.map((id, i) => ball(x + 54 + i * 9, 42, id, 9, false)).join('') + ball(x + 155, 42, 'red'));
  let arrows = go(x + 15, x + 38, 42) + go(x + 116, x + 139, 42) + go(x + 170, x + 193, 42);
  b += text(x + 76, 68, 'any colour', { size: 11 });
  b += text(x + 212, 47, 'colour…', { anchor: 'start' });
  b += text(10, 96, 'Reds all gone? Colours in order:', { fill: GOLD, anchor: 'start' });
  b += BALL_G(colours.map((id, i) => ball(22 + i * 52, 122, id)).join(''));
  for (let i = 0; i < 5; i++) arrows += go(36 + i * 52, 59 + i * 52, 122);
  b += `<g stroke="${GOLD}" stroke-width="2" fill="${GOLD}">${arrows}</g>`;
  return svg(320, 140, 'Pot a red, then any colour, then a red again. When the reds are gone, pot the colours from yellow to black', b);
})();

// ── Table football ──
const FOOS_LAYOUT = [[0, 1, 0], [0, 2, 0.24], [1, 3, 0.2], [0, 5, 0.12], [1, 5, 0.12], [0, 3, 0.2], [1, 2, 0.24], [1, 1, 0]];
const FOOSBALL_RODS = (() => {
  const L = 1.12;
  const Wd = 0.62;
  const K = 250;
  const x0 = 20;
  const y0 = 30;
  const X = (m) => x0 + (m + L / 2) * K;
  const Z = (m) => y0 + (m + Wd / 2) * K;
  let b = `<rect x="${x0}" y="${y0}" width="${L * K}" height="${Wd * K}" fill="#2f8a46" stroke="#e8e8e8" stroke-width="2"/>`;
  b += `<line x1="${X(0)}" y1="${y0}" x2="${X(0)}" y2="${y0 + Wd * K}" stroke="#e8e8e8" stroke-width="1.2"/><circle cx="${X(0)}" cy="${Z(0)}" r="18" fill="none" stroke="#e8e8e8" stroke-width="1.2"/>`;
  b += `<rect x="${x0 - 8}" y="${Z(-0.1)}" width="8" height="${0.2 * K}" fill="${LUDO[0]}"/><rect x="${x0 + L * K}" y="${Z(-0.1)}" width="8" height="${0.2 * K}" fill="#f2f2f2"/>`;
  const step = L / 8;
  let rods = '';
  const men = ['', ''];
  FOOS_LAYOUT.forEach(([team, count, gap], i) => {
    const x = r1(X(-L / 2 + step * (i + 0.5)));
    rods += `M${x} ${y0 - 6}v${Wd * K + 12}`;
    for (let m = 0; m < count; m++) men[team] += `M${r1(x - 5)} ${r1(Z((m - (count - 1) / 2) * gap) - 6)}h10v12h-10z`;
    b += text(x, y0 - 12, count, { fill: team === 0 ? '#ff8a80' : CREAM, weight: 'bold' });
  });
  b += `<path d="${rods}" stroke="#c9ccd0" stroke-width="2"/>`;
  b += `<path d="${men[0]}" fill="${LUDO[0]}" stroke="#fff"/><path d="${men[1]}" fill="#f2f2f2" stroke="#1e3a6b" stroke-width="2"/>`;
  b += text(x0, y0 + Wd * K + 24, 'your goal', { size: 11, fill: '#ff8a80', anchor: 'start' });
  b += text(x0 + L * K, y0 + Wd * K + 24, 'Chidi’s goal', { size: 11, anchor: 'end' });
  b += arrow([[X(-0.2), y0 + Wd * K + 20], [X(0.2), y0 + Wd * K + 20]], { width: 2.5, head: 7 });
  b += text(X(0), y0 + Wd * K + 36, 'you attack', { size: 11, fill: GOLD });
  return svg(320, 230, 'The rods from your goal to Chidi’s: your 1, 2, 5 and 3 men in red; Chidi’s 3, 5, 2 and 1 in white. You attack to the right', b);
})();

// ── The joint: keys ──
const JOINT_KEYS = (() => {
  const key = (x, y, w, label, sub = '') => `<rect x="${x}" y="${y}" width="${w}" height="30" rx="5" fill="#3d2d20" stroke="${GOLD}" stroke-width="1.5"/>${text(x + w / 2, y + 20, label, { size: 13, weight: 'bold' })}${sub ? text(x + w / 2, y + 48, sub, { size: 11, fill: GOLD }) : ''}`;
  let b = key(52, 6, 30, 'W') + key(18, 40, 30, 'A') + key(52, 40, 30, 'S') + key(86, 40, 30, 'D');
  b += text(67, 92, 'walk', { size: 11, fill: GOLD });
  b += key(130, 40, 54, 'Shift', 'hurry');
  b += key(198, 40, 30, 'E', 'sit');
  b += key(242, 40, 30, 'M', 'sound');
  return svg(290, 98, 'Keys: W A S D or arrows to walk, Shift to hurry, E to sit, M for sound', b);
})();

// ── Guides ──
export const GUIDES = {
  joint: {
    title: 'Getting around Baba’s Joint',
    intro: 'Welcome to Baba’s Joint, a Lagos game house. Walk around as your own character, sit at any of the six tables and play the regulars.',
    sections: [
      {
        heading: 'Walking',
        html: '<ul><li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or the arrow keys to walk. Hold <kbd>Shift</kbd> to hurry.</li><li>Drag to look around; scroll to zoom.</li><li>On a phone, tap the floor to walk there, or tap a table to walk up to it.</li></ul>',
        diagram: JOINT_KEYS,
      },
      {
        heading: 'Sitting down at a table',
        html: '<p>Walk up to a table and a <b>Sit down</b> button appears. Tap it or press <kbd>E</kbd>. At Snooker and Table football you stand, but it works the same way.</p><p>The host greets you and shows the table’s menu: the rules, your record there and the level. Tap <b>Play</b> to start.</p>',
      },
      {
        heading: 'Finding a table quickly',
        html: '<ul><li>Tap the <b>☰</b> button (top right) for a list of all six tables. Tap one and you walk straight there and sit down.</li><li>The <b>mini-map</b> in the bottom corner shows the whole joint (tap <b>Map</b> to open it). Tap a table on it to go there, or anywhere else to walk there.</li><li>New here? Tap <b>☰</b>, then <b>Show me around</b>, and Baba sends you round every table.</li></ul>',
      },
      {
        heading: 'Who plays where',
        html: '<ul><li><b>Ayo</b> with Baba, the elder of the joint</li><li><b>Draughts</b> with Tunde the barber</li><li><b>Whot</b> with Iya Bisi, Uncle Femi and Mama Ngozi</li><li><b>Ludo</b> with the kids, Kemi and Tobi</li><li><b>Snooker</b> with Emeka</li><li><b>Table football</b> with Chidi</li></ul>',
      },
      {
        heading: 'Leaving a table',
        html: '<p>From a table’s menu, tap <b>Stand up and look around</b> (or press <kbd>Esc</kbd>). When a game ends, tap <b>Play again</b> or <b>Leave the table</b>.</p>',
      },
      {
        heading: 'Levels',
        html: '<ul><li><b>Easy</b>: for practice. The hosts make mistakes, and Easy games don’t count on the leaderboard.</li><li><b>Normal</b>: a fair game.</li><li><b>Hard</b>: they play their best. At Ayo, Hard also turns off the move preview, and at Snooker the guide line is shorter.</li></ul><p>Each table remembers the level you chose and keeps your win–loss record for each level.</p>',
      },
      {
        heading: 'The leaderboard',
        html: '<p>Every win on <b>Normal</b> or <b>Hard</b>, at any table, counts towards your total wins at the joint. <b>Sign in with start.ng</b> to put your wins on the leaderboard and play as your own character. Guests can play everything, but their wins stay on this device.</p>',
      },
      {
        heading: 'Day, evening and night',
        html: '<p>The joint follows your clock. It’s daytime until 4 pm, evening until 7 pm, then night: NEPA has taken light, so the lanterns are lit and the chickens have gone to roost.</p>',
      },
      {
        heading: 'Music and sound',
        html: '<ul><li>Click or tap <b>Baba’s radio</b> to switch the music on or off.</li><li>The 🔊 button, or <kbd>M</kbd>, turns all sound on or off.</li><li>The <b>?</b> button opens this guide.</li></ul>',
      },
      {
        heading: 'Credits',
        html: '<p>Music on Baba’s radio: <b>“Imela”</b> (album <i>Ekene</i>) and <b>“Egwu Nwa”</b> (album <i>Egwu Nwa</i>) by <b>Ugo Mbaise</b>, from the <a href="https://freemusicarchive.org/music/ugo-mbaise/" target="_blank" rel="noopener">Free Music Archive</a>, licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. Excerpted and level-adjusted.</p><p>Ayo seed sounds: “singledrop1–3” and “clatter1” by <b>jaybatzner</b> on <a href="https://freesound.org/people/jaybatzner/" target="_blank" rel="noopener">Freesound</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>, trimmed and re-encoded.</p><p>Other sounds are CC0, with thanks to Kenney and the Freesound recordists (including jehoshaphatia and jilla2021 for the Lagos street recordings). Full list: <code>assets/audio/CREDITS.md</code>. Pictures: Poly Haven (CC0). Made with three.js.</p>',
      },
    ],
  },

  ayo: {
    title: 'How to play Ayo',
    intro: 'Ayo Olopon is the Yoruba seed game. You and Baba each have a row of six pits with 4 seeds in each. Capture more seeds than Baba: 25 wins.',
    sections: [
      {
        heading: 'Your turn: sowing',
        html: '<p>The near row of six pits is yours. Pick one of your pits that has seeds: all its seeds are sown one by one into the pits after it, going <b>anticlockwise</b>: right along your row, then left along Baba’s row.</p><p>A pit with <b>12 or more</b> seeds goes all the way round, and skips the pit it started from.</p>',
        diagram: AYO_SOW,
      },
      {
        heading: 'Capturing',
        html: '<p>If your <b>last seed</b> lands in one of Baba’s pits and makes it <b>2 or 3</b>, you take those seeds. Then look at the pit just before it: if it is also Baba’s and holds 2 or 3, take those too, and keep going back like that.</p>',
        diagram: AYO_CAPTURE,
      },
      {
        heading: 'Fair play',
        html: '<ul><li>You can’t take <b>every</b> seed Baba has in one move. If a move would, you sow but capture nothing.</li><li>If Baba’s row is empty, you must play a pit that gives him seeds. If you can’t, the game ends and each player keeps the seeds on their own side.</li></ul>',
      },
      {
        heading: 'Winning',
        html: '<p>The first to <b>25 seeds</b> wins; 24–24 is a draw. If 60 moves pass with no capture, the game ends and each player keeps the seeds on their own side.</p>',
      },
      {
        heading: 'Controls',
        html: '<ul><li>Click or tap a pit, or press <kbd>1</kbd>–<kbd>6</kbd> (your pits, left to right).</li><li>On <b>Easy</b> and <b>Normal</b>, point at a pit (or tap it once) to see where its last seed lands and what it would capture. Tap again to play.</li><li>Choose how fast the seeds move in the menu: Normal, Fast or Very fast.</li></ul><p>Your first game comes with a lesson from Baba. You can skip it, or replay it from the rules sheet.</p>',
      },
    ],
  },

  draughts: {
    title: 'How to play Draughts',
    intro: 'International draughts on a 10×10 board, the way it’s played in Nigeria. You’re white, Tunde is black, and white moves first. Only the dark squares are used.',
    sections: [
      {
        heading: 'Moving',
        html: '<p>A man moves <b>one square diagonally forward</b> onto an empty dark square. Men never step backwards.</p>',
        diagram: DRAUGHTS_MOVE,
      },
      {
        heading: 'Capturing',
        html: '<p>Jump diagonally over an enemy piece next to you onto the empty square right behind it. Men can capture <b>forwards or backwards</b>.</p>',
        diagram: DRAUGHTS_BACK,
      },
      {
        heading: 'You must capture, and take the most',
        html: '<p>Capturing is <b>compulsory</b>. If you can keep jumping, the move goes on, and you must choose the sequence that takes the <b>most pieces</b>. Jumped pieces come off at the end of the move, and no piece can be jumped twice.</p><p>When you have to capture, the pieces that must do it glow orange.</p>',
        diagram: DRAUGHTS_MULTI,
      },
      {
        heading: 'Kings fly',
        html: '<p>A man that <b>ends its move</b> on Tunde’s back row becomes a <b>king</b> (a double piece). Kings move any distance along an empty diagonal, forwards or backwards, and can capture a piece far away, landing on any empty square beyond it.</p>',
        diagram: DRAUGHTS_KING,
      },
      {
        heading: 'Winning',
        html: '<p>Take all of Tunde’s pieces, or leave him with no legal move. It’s a draw if the same position comes up three times, or after 25 moves each with only kings moving and nothing captured.</p>',
      },
      {
        heading: 'Controls',
        html: '<p>Tap one of your pieces (it glows gold), then tap the square to move to: blue squares are moves, orange ones are captures. For a multiple capture, tap where the piece finishes.</p>',
      },
    ],
  },

  whot: {
    title: 'How to play Whot',
    intro: 'Whot with Iya Bisi, Uncle Femi and Mama Ngozi. Everyone gets 5 cards. Be the first to play your last card.',
    sections: [
      {
        heading: 'Matching',
        html: '<p>On your turn, play one card that matches the top card’s <b>shape</b> or its <b>number</b>. A <b>Whot</b> can be played on anything.</p><p>Can’t play, or don’t want to? <b>Go to market</b>: pick one card and your turn ends.</p>',
        diagram: WHOT_MATCH,
      },
      {
        heading: 'The special cards',
        html: '<ul><li><b>1 Hold on</b>: play again.</li><li><b>2 Pick two</b>: the next player picks 2.</li><li><b>5 Pick three</b>: the next player picks 3.</li><li><b>8 Suspension</b>: the next player misses a turn.</li><li><b>14 General market</b>: everyone else picks 1, then you play again.</li><li><b>20 Whot</b>: call a shape. The next player must play that shape or a Whot.</li></ul>',
        diagram: WHOT_SPECIALS,
      },
      {
        heading: 'Defending a pick',
        html: '<p>Facing Pick two? Put down your own <b>2</b> and the penalty passes on, bigger: the next player now faces 4. Pick three works the same with a <b>5</b>. No other card defends, not even a Whot. Otherwise tap <b>Pick 2</b> (or however many) to take them.</p>',
      },
      {
        heading: 'Winning',
        html: '<p>Play your <b>last card</b> and you win at once, whatever card it is. When the market runs out, the pile (all but its top card) is shuffled back in.</p>',
      },
      {
        heading: 'Controls',
        html: '<p>Cards you can play sit slightly forward. Tap one to play it. For a Whot, tap the shape you want to call. To draw, tap <b>Go to market</b>. You play first; Uncle Femi, Iya Bisi and Mama Ngozi follow.</p>',
      },
    ],
  },

  ludo: {
    title: 'How to play Ludo',
    intro: 'Ludo with Kemi (green) and Tobi (yellow). You’re red. Get all four of your tokens round the board and into the centre first.',
    sections: [
      {
        heading: 'Coming out',
        html: '<p>Your tokens start in your yard. Roll a <b>6</b> to bring one out onto your red start square. A 6 also gives you another roll, but three 6s in a row and your turn is lost.</p>',
        diagram: LUDO_CORNER,
      },
      {
        heading: 'Moving and capturing',
        html: '<ul><li>Move one token forward by the number you rolled, clockwise round the board.</li><li>Land on a single enemy token to send it back to its yard, and roll again.</li><li>Two tokens of one colour on a square make a <b>block</b>: nobody can land on it or pass it.</li></ul>',
      },
      {
        heading: 'Safe squares',
        html: '<p>The four <b>stars</b> and the four coloured <b>start squares</b> are safe: nobody can be captured there.</p>',
      },
      {
        heading: 'Going home',
        html: '<p>After going round the board, your token turns up the <b>red home column</b>: 5 squares, then the centre. You need the <b>exact</b> number to reach the centre. Getting a token home earns another roll. First with all four home wins.</p>',
      },
      {
        heading: 'Controls',
        html: '<p>Tap <b>Roll</b>, tap the die, or press <kbd>Space</kbd>. Then tap one of your glowing tokens. If only one token can move, it moves by itself; if none can, the turn passes.</p>',
      },
    ],
  },

  snooker: {
    title: 'How to play Snooker',
    intro: 'One frame against Emeka on the bar table: 15 reds and six colours. Pot a red, then a colour, and keep your break going. Most points when the black goes down wins.',
    sections: [
      {
        heading: 'The table and the balls',
        html: '<p>Each red is worth <b>1</b>. The colours: yellow <b>2</b>, green <b>3</b>, brown <b>4</b>, blue <b>5</b>, pink <b>6</b>, black <b>7</b>. The cue ball starts in the <b>D</b>, the half circle at the baulk end.</p>',
        diagram: SNOOKER_TABLE,
      },
      {
        heading: 'Red, colour, red',
        html: '<p>While reds are on the table, hit and pot a <b>red</b> first. Then you’re on <b>any colour</b>: the first colour you hit is the one you’re playing, so pot that same one. Potted colours go back on their spots, and you’re back on reds.</p><p>Once the reds are gone (after the colour that follows the last red), pot the colours <b>in order</b>, yellow to black. They stay down.</p><p>Keep potting and you keep playing. Miss and it’s Emeka’s shot.</p>',
        diagram: SNOOKER_ORDER,
      },
      {
        heading: 'Fouls',
        html: '<p>It’s a foul to miss every ball, hit the wrong ball first, pot the cue ball, or pot a ball you weren’t on. Your opponent gets <b>4 points</b>, or the value of the ball involved if that’s higher, and the turn passes. After the cue ball goes in, the next player places it anywhere in the D.</p>',
      },
      {
        heading: 'End of the frame',
        html: '<p>The frame ends when the last black goes down (or there’s a foul on it). Most points wins. If the scores are level, the black is put back and the other player gets the first shot at it.</p>',
      },
      {
        heading: 'Controls',
        html: '<ul><li>Point at the table to aim (on touch, drag on the table). <kbd>←</kbd> <kbd>→</kbd> fine-tune; hold <kbd>Shift</kbd> for finer.</li><li>Hold <b>Shoot</b> or <kbd>Space</kbd>: the power swings up and down. Let go to strike.</li><li>Ball in hand: move the white inside the D, then tap (or press <kbd>Enter</kbd>) to put it down.</li></ul><p>The guide line is long on Easy and short on Hard.</p>',
      },
    ],
  },

  foosball: {
    title: 'How to play Table football',
    intro: 'Chidi says nobody beats him at this table. You’re red, shooting to the right into Chidi’s goal. First to 5 goals wins.',
    sections: [
      {
        heading: 'Your rods',
        html: '<p>Each team has four rods: a goalkeeper (1 man), defence (2), midfield (5) and attack (3). All four of your rods slide together, and all your men kick together.</p>',
        diagram: FOOSBALL_RODS,
      },
      {
        heading: 'Sliding and kicking',
        html: '<ul><li>Move your mouse, or drag your finger, up and down the table to slide your rods. <kbd>W</kbd>/<kbd>S</kbd> or <kbd>↑</kbd>/<kbd>↓</kbd> work too.</li><li>Click, tap, press <kbd>Space</kbd> or <kbd>Enter</kbd>, or tap <b>Kick</b> to swing. A man kicks the ball only if it’s right by his feet.</li></ul>',
      },
      {
        heading: 'Goals',
        html: '<p>Get the ball into Chidi’s goal on the right. After a goal, the ball is dropped in the middle, rolling towards the side that let it in. If the ball stops where nobody can reach it, it gets a nudge back into play.</p>',
      },
    ],
  },
};

// ── On-screen controls strip ──
export const CONTROLS = {
  walk: ['WASD / arrows to walk · Shift to hurry', 'Drag to look · tap the floor or a table to go there', 'E or the Sit button to sit · M for sound'],
  ayo: ['Click or tap a pit, or press 1–6', 'Easy/Normal: point or tap once to preview, tap again to play', 'Drag to look around'],
  draughts: ['Tap a piece, then the square to move to', 'Orange glow: you must capture with that piece', 'Drag to look around'],
  whot: ['Tap a card to play it (playable ones sit forward)', 'No match? Tap Go to market', 'Whot: tap the shape you want to call'],
  ludo: ['Tap Roll, tap the die, or press Space', 'Tap a glowing token to move it'],
  snooker: ['Point at the table to aim (drag on touch) · ← → fine-tune', 'Hold Shoot or Space, let go to strike', 'Ball in hand: place the white in the D, then tap or Enter'],
  foosball: ['Move the mouse or drag up and down to slide', 'W/S or ↑/↓ slide too', 'Click, tap, Space or Kick to kick'],
};

// ── First-game lessons: what each host says, step by step ──
export const LESSONS = {
  // Tunde the barber: cocky, teasing
  draughts: {
    intro: [
      'First time on my board? Sit down. Let me teach you small before I cut you.',
      'You’re white and you move first. A man steps one square diagonally forward, on the dark squares.',
      'Tap your piece, then tap where it should go. The blue squares show where it can move.',
    ],
    firstMove: 'Ehen, that’s a move! Now watch how the barber does it.',
    mustCapture: 'You can capture, so you must! And you must take the most you can. The orange pieces are the ones that must jump.',
    firstCapture: 'Clean cut! Jump over my man onto the empty square behind. Men can capture backwards too, so watch your back o.',
    king: 'Reach my back row and your man becomes a king. Kings fly any distance along a diagonal and capture from far.',
    done: 'Okay, school don close. No more free lessons. Oya, play!',
  },

  // Iya Bisi: warm auntie who loves her rules
  whot: {
    intro: [
      'Welcome, my dear! Five cards each. Play a card that matches the top card’s shape or its number.',
      'Your playable cards sit forward. Tap one to play it. No match? Tap Go to market and pick one card.',
      'The special cards are the sweet part. Don’t worry, I’ll explain each one as it comes.',
    ],
    match: 'Ehen! Same shape or same number, either one is fine. That is the main rule.',
    market: 'Nothing to play? Go to market: you pick one card and your turn is over. No shame in it.',
    holdOn: '1 is Hold on: whoever plays it plays again straight away. Use it to set up your next card.',
    pickTwo: 'Pick two! The next player picks 2 cards, unless they put down their own 2. Then it passes on, and it grows o!',
    pickThree: '5 is Pick three. Only another 5 can defend it, not even a Whot. Otherwise you pick them.',
    suspension: '8 is Suspension: the next player misses their turn. Sit down and wait, my dear!',
    generalMarket: '14 is General market! Everybody else picks one from market, and the person who played it goes again.',
    whot: 'Whot 20 plays on anything. Then you call a shape, and the next player must follow that shape or play a Whot.',
    lastCard: 'Last card! Play your last card and you win at once. When someone is on one card, slow them with Pick two or Suspension.',
    done: 'See? You don learn Whot! Now play your best, I won’t go easy on you o.',
  },

  // Kemi and Tobi: excited kids
  ludo: {
    intro: [
      'Yay, you came! You’re red. Get all four tokens to the middle before me and Tobi!',
      'Tap Roll, tap the die, or press Space. You need a 6 to bring a token out of your yard.',
    ],
    needSix: 'No 6, no coming out! Your tokens wait in the yard until you roll a 6. Try again next turn!',
    rolledSix: 'A 6! Bring a token out, or move one that’s already out. And you roll again! But three 6s in a row loses your turn.',
    pickToken: 'Tap one of your glowing tokens to move it. If only one can move, it goes by itself.',
    capture: 'Chop! Land on a lone token and it goes back to its yard, and you roll again! Two tokens together make a block nobody can pass.',
    safe: 'Stars and the coloured start squares are safe. Nobody can chop you there, not even Tobi!',
    homeColumn: 'You’re in your red column! Five squares, then the middle. You need the exact number to get in.',
    done: 'You know everything now! No more help o. I’m going to win! Hehe.',
  },

  // Emeka: cool and precise
  snooker: {
    intro: [
      'Snooker. One frame, you and me. Pot a red, then a colour, then a red again. That’s how a break grows.',
      'Reds are 1 point each. Colours: yellow 2, green 3, brown 4, blue 5, pink 6, black 7.',
    ],
    placeCue: 'Ball in hand. Put the white anywhere inside the D, that half circle. Then tap, or press Enter, to set it.',
    aim: 'Point at the table to aim; the guide line shows the path. On a phone, drag on the table. Arrow keys fine-tune.',
    power: 'Hold Shoot or Space. The power swings up and down, so let go at the right moment. Soft is often better.',
    onRed: 'You’re on a red. Hit a red first. Touch a colour first and that’s a foul.',
    onColour: 'Red down. Now any colour. The first colour you hit is your colour, so pot that same one.',
    foul: 'Foul. Wrong ball first, no ball at all, or the white in the pocket: at least 4 points to the other player, and the turn passes.',
    done: 'You’ve got it. When the reds are gone, take the colours in order, yellow to black. Your shot.',
  },

  // Chidi: playful show-off
  foosball: {
    intro: [
      'Welcome to my table! You’re red, shooting right into my goal. First to 5 wins. Easy, abi?',
      'All four of your rods move together. Move your mouse or finger up and down the table to slide them.',
    ],
    slide: 'Slide! W and S or the arrow keys work too. Line one of your men up with the ball, like Messi.',
    kick: 'Click, tap, Space or the Kick button: all your men swing at once. Kick when the ball is right by a man!',
    firstGoal: 'GOAL! Okay, okay. After every goal, the ball comes back to the middle and rolls to whoever let it in.',
    done: 'That’s all the lesson you get. Now let me show you why they call me Messi!',
  },
};
