// Builds the player's start.ng character from its `style` (https://start.ng/docs#character-style-fields).
// Every field changes the model: body shape, top, trousers/skirt, skin, hair, hat and accessory.
// Realistic proportions (head about 1/7.5 of standing height), shaped torso, elbows and knees,
// and hands with jointed fingers. The character faces +Z and sits on a stool (hips 0.46 m up).
import * as THREE from 'three';
import { mergeInto } from './merge.js';

const HEX = /^#[0-9a-f]{6}$/i;
const HAIRS = ['short', 'afro', 'braids', 'bun', 'ponytail', 'dreads', 'bald'];
const HATS = ['none', 'cap', 'beanie', 'tophat', 'crown'];
const ACCESSORIES = ['none', 'glasses', 'earrings', 'beard', 'scarf', 'backpack'];

// Fills in anything missing or unknown, since start.ng may add options later.
export function normalizeStyle(style) {
  const s = style ?? {};
  const color = (v, fallback) => (typeof v === 'string' && HEX.test(v) ? v : fallback);
  const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
  return {
    body: s.body === 'female' ? 'female' : 'male',
    primaryColor: color(s.primaryColor, '#4b7bec'),
    secondaryColor: color(s.secondaryColor, '#2b2f4a'),
    skinColor: color(s.skinColor, '#8d5524'),
    hairColor: color(s.hairColor, '#17120f'),
    hair: pick(s.hair, HAIRS, 'short'),
    hat: pick(s.hat, HATS, 'none'),
    accessory: pick(s.accessory, ACCESSORIES, 'none'),
  };
}

export function styleKey(style) {
  return JSON.stringify(normalizeStyle(style));
}

// Cloth prints, made on a small canvas from the outfit's main colour so it stays dominant:
// 'ankara' (wax-print circles and diamonds), 'stripes', 'jersey' (a chest band) or 'plain'.
function printTexture(kind, base) {
  const W = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = W;
  const g = cv.getContext('2d');
  const c = new THREE.Color(base);
  const hsl = {};
  c.getHSL(hsl);
  const tone = (dl, dh = 0, ds = 0) => `#${new THREE.Color().setHSL((hsl.h + dh + 1) % 1, Math.min(1, hsl.s + ds), Math.max(0.04, Math.min(0.96, hsl.l + dl))).getHexString()}`;
  g.fillStyle = base;
  g.fillRect(0, 0, W, W);
  if (kind === 'ankara') {
    // a bold repeating wax-print motif: rings and dots on a diamond grid
    // motifs in deeper and lighter tones of the same colour, with a small contrasting accent,
    // so the player's own colour still reads first
    const accent = tone(hsl.l > 0.5 ? -0.25 : 0.2, 0.45, 0.05);
    const deep = tone(-0.2);
    const cream = tone(0.22, 0, -0.15);
    for (let y = 0; y <= W; y += 64) {
      for (let x = 0; x <= W; x += 64) {
        for (const [ox, oy] of [[0, 0], [32, 32]]) {
          const cx = x + ox;
          const cy = y + oy;
          g.fillStyle = deep;
          g.beginPath(); g.arc(cx, cy, 16, 0, Math.PI * 2); g.fill();
          g.fillStyle = accent;
          g.beginPath(); g.arc(cx, cy, 11, 0, Math.PI * 2); g.fill();
          g.fillStyle = cream;
          g.beginPath(); g.arc(cx, cy, 5.5, 0, Math.PI * 2); g.fill();
          g.fillStyle = deep;
          g.beginPath(); g.arc(cx, cy, 3, 0, Math.PI * 2); g.fill();
        }
        // small diamonds between the rings
        g.fillStyle = accent;
        g.beginPath();
        g.moveTo(x + 32, y + 4); g.lineTo(x + 38, y + 10); g.lineTo(x + 32, y + 16); g.lineTo(x + 26, y + 10);
        g.fill();
      }
    }
  } else if (kind === 'stripes') {
    for (let y = 0; y < W; y += 32) {
      g.fillStyle = tone(-0.18);
      g.fillRect(0, y, W, 9);
      g.fillStyle = tone(0.2);
      g.fillRect(0, y + 14, W, 3);
    }
  } else if (kind === 'jersey') {
    g.fillStyle = tone(hsl.l > 0.5 ? -0.45 : 0.45, 0.02);
    g.fillRect(0, W * 0.38, W, W * 0.16);
    g.fillStyle = tone(-0.12);
    for (let x = 0; x < W; x += 8) g.fillRect(x, 0, 1, W); // fabric mesh
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// `look` lets the regulars dress their part: { outfit: 'auto'|'plain'|'ankara'|'stripes'|'jersey',
// energy: how lively they are (0.5 calm elder … 1.6 excited child) }
export function buildCharacter(rawStyle, look = {}) {
  const style = normalizeStyle(rawStyle);
  const female = style.body === 'female';
  const energy = look.energy ?? 1;
  const geometries = [];
  const materials = new Map();

  const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
  const fabric = (hex, extra = {}) => cached(`f${hex}${JSON.stringify(extra)}`, () => new THREE.MeshPhysicalMaterial({
    color: hex, roughness: 0.88, sheen: 0.6, sheenRoughness: 0.8, sheenColor: shade(hex, 1.25), ...extra,
  }));
  const plain = (hex, extra = {}) => cached(`p${hex}${JSON.stringify(extra)}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6, ...extra }));
  function cached(key, make) {
    if (!materials.has(key)) materials.set(key, make());
    return materials.get(key);
  }
  const mesh = (geometry, material, parent, x = 0, y = 0, z = 0) => {
    geometries.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const group = (parent, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  // joints the smooth skin bends around
  const bone = (parent, x = 0, y = 0, z = 0) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    parent.add(b);
    return b;
  };
  // a limb segment hanging down from its joint: capsule of total length `len`
  // (r2 is the radius at the far end; the capsule uses the average and tapers by scaling)
  const limb = (parent, radius, len, material, r2 = radius) => {
    const r = (radius + r2) / 2;
    return mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 6, 14), material, parent, 0, -len / 2, 0);
  };

  // skin is slightly soft and sheeny, like real skin under daylight
  const skin = cached('skin', () => new THREE.MeshPhysicalMaterial({
    color: style.skinColor, roughness: 0.52, sheen: 0.35, sheenRoughness: 0.45, sheenColor: shade(style.skinColor, 1.6),
  }));
  const lips = plain(shade(style.skinColor, 0.62), { roughness: 0.4 });
  // the top's print: chosen by the regulars, or picked from the player's style (always the same
  // for the same style, and always in the player's own colour)
  const hash = [...JSON.stringify(style)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const outfit = look.outfit && look.outfit !== 'auto' ? look.outfit : ['ankara', 'plain', 'ankara', 'stripes', 'plain'][hash % 5];
  const top = outfit === 'plain'
    ? fabric(style.primaryColor)
    : cached(`print-${outfit}`, () => new THREE.MeshPhysicalMaterial({
      map: printTexture(outfit, style.primaryColor), roughness: 0.86, sheen: 0.5, sheenRoughness: 0.8, sheenColor: shade(style.primaryColor, 1.2),
    }));
  if (top.map) top.map.repeat.set(outfit === 'jersey' ? 1 : 3, outfit === 'jersey' ? 1 : 2);
  // sleeves are much narrower than the body, so their print repeats less to stay the same size
  let sleeveMat = top;
  if (top.map) {
    sleeveMat = top.clone();
    sleeveMat.map = top.map.clone();
    sleeveMat.map.repeat.set(outfit === 'jersey' ? 0.4 : 1, outfit === 'jersey' ? 0.4 : 0.9);
    materials.set('sleeve-print', sleeveMat);
  }
  const bottom = fabric(style.secondaryColor);
  const hair = cached('hair', () => new THREE.MeshPhysicalMaterial({
    color: style.hairColor, roughness: 0.75, sheen: 0.5, sheenRoughness: 0.4, sheenColor: shade(style.hairColor, 2.2),
  }));
  const shoe = plain('#2a2420', { roughness: 0.45 });
  const sole = plain('#141110', { roughness: 0.8 });
  const white = plain('#f3efe8', { roughness: 0.3 });
  const iris = plain('#2a1a10', { roughness: 0.2 });
  const dark = plain('#141416', { roughness: 0.35, metalness: 0.3 });
  const gold = plain('#e8b84a', { metalness: 0.8, roughness: 0.25 });

  const root = new THREE.Group();
  const body = new THREE.Bone(); // leans and breathes; root only moves and turns
  root.add(body);

  // ── Proportions (metres, standing) ──
  const hipY = female ? 0.84 : 0.88;
  const thighLen = female ? 0.41 : 0.43;
  const shinLen = hipY - thighLen - 0.04;
  const torsoLen = female ? 0.5 : 0.53;
  const shoulderY = hipY + torsoLen;
  const shoulderX = female ? 0.165 : 0.2;
  const R = 0.112; // head radius (a touch bigger than life, for expression)
  const headY = shoulderY + 0.2;

  // ── Torso: a lathed shirt shape, flattened front to back ──
  const profile = female
    ? [[0.135, -0.02], [0.155, 0.05], [0.14, 0.13], [0.118, 0.22], [0.135, 0.3], [0.15, 0.36], [0.148, 0.43], [0.13, 0.48], [0.06, torsoLen], [0.045, torsoLen + 0.02]]
    : [[0.145, -0.02], [0.15, 0.06], [0.142, 0.16], [0.148, 0.26], [0.168, 0.36], [0.176, 0.44], [0.155, 0.5], [0.065, torsoLen], [0.05, torsoLen + 0.02]];
  const torso = mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 32), top, body, 0, hipY, 0);
  torso.scale.set(female ? 1.12 : 1.22, 1, 0.66);
  // collar
  const collar = mesh(new THREE.TorusGeometry(0.058, 0.012, 8, 24), fabric(shade(style.primaryColor, 0.85)), body, 0, shoulderY + 0.01, 0.005);
  collar.rotation.x = Math.PI / 2 + 0.25;

  // hips: trousers' seat for men (only shown sitting), the top of the skirt for women
  let seatMesh = null;
  if (female) {
    const skirt = [[0.15, 0.1], [0.168, 0.04], [0.19, -0.06], [0.215, -0.14]];
    const s = mesh(new THREE.LatheGeometry(skirt.map(([r, y]) => new THREE.Vector2(r, y)), 32), bottom, body, 0, hipY, 0);
    s.scale.z = 0.8;
    s.material.side = THREE.DoubleSide;
  } else {
    // the seat of the trousers, covering where the legs meet the body
    seatMesh = mesh(new THREE.SphereGeometry(0.16, 24, 14), bottom, body, 0, hipY + 0.015, 0.0);
    seatMesh.scale.set(0.96, 0.48, 0.56);
  }

  // ── Neck and head ──
  mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.12, 14), skin, body, 0, shoulderY + 0.06, 0);
  const head = bone(body, 0, headY, 0.005);
  const skull = mesh(new THREE.SphereGeometry(R, 32, 24), skin, head);
  skull.scale.set(0.88, 1.08, 0.98);
  const jaw = mesh(new THREE.SphereGeometry(R * 0.78, 24, 16), skin, head, 0, -R * 0.42, R * 0.18);
  jaw.scale.set(female ? 0.9 : 0.98, 0.78, 0.92);
  const nose = mesh(new THREE.SphereGeometry(R * 0.17, 12, 10), skin, head, 0, -R * 0.12, R * 0.93);
  nose.scale.set(1.15, 0.9, 1.0);
  mesh(new THREE.SphereGeometry(R * 0.1, 10, 8), skin, head, 0, R * 0.04, R * 0.9).scale.set(0.8, 1.6, 0.9); // bridge
  // lips, with a mouth that opens when they talk (the lower lip drops, the dark inside shows)
  const upperLip = mesh(new THREE.CapsuleGeometry(R * 0.07, R * 0.28, 4, 10), lips, head, 0, -R * 0.42, R * 0.86);
  upperLip.rotation.z = Math.PI / 2;
  upperLip.scale.set(1, 0.95, 0.7);
  const lowerLip = mesh(new THREE.CapsuleGeometry(R * 0.07, R * 0.26, 4, 10), lips, head, 0, -R * 0.53, R * 0.85);
  lowerLip.rotation.z = Math.PI / 2;
  lowerLip.scale.set(1, 0.85, 0.7);
  const mouth = mesh(new THREE.SphereGeometry(R * 0.16, 14, 8), plain('#3a1612', { roughness: 0.9 }), head, 0, -R * 0.475, R * 0.8);
  mouth.scale.set(1, 0.05, 0.4);
  const lowerLipY = lowerLip.position.y;
  // eyes (with lids that blink and a catch-light), brows that lift, and ears
  const lids = [];
  const brows = [];
  const shine = plain('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.6, roughness: 0.1 });
  for (const side of [-1, 1]) {
    const eye = group(head, side * R * 0.36, R * 0.13, R * 0.72);
    mesh(new THREE.SphereGeometry(R * 0.17, 16, 12), white, eye);
    mesh(new THREE.SphereGeometry(R * 0.1, 14, 10), iris, eye, 0, 0, R * 0.095);
    mesh(new THREE.SphereGeometry(R * 0.025, 8, 6), shine, eye, side * -R * 0.03, R * 0.04, R * 0.18);
    const lid = mesh(new THREE.SphereGeometry(R * 0.185, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), skin, eye);
    lid.rotation.x = 0.35;
    lids.push(lid);
    const brow = mesh(new THREE.CapsuleGeometry(R * 0.035, R * 0.26, 4, 8), hair, head, side * R * 0.37, R * 0.38, R * 0.86);
    brow.rotation.z = Math.PI / 2 + side * 0.12;
    brows.push(brow);
    const ear = mesh(new THREE.SphereGeometry(R * 0.26, 12, 10), skin, head, side * R * 0.87, -R * 0.02, -R * 0.05);
    ear.scale.set(0.38, 1, 0.68);
  }

  // ── Hair ──
  let hatY = R * 1.06; // where a hat sits, above the head centre
  let hatScale = 1;
  const cap = (extra = 1.06) => {
    // tipped back so the hairline sits high on the forehead and low at the nape
    const c = mesh(new THREE.SphereGeometry(R * extra, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), hair, head, 0, R * 0.05, -R * 0.07);
    c.rotation.x = -0.72;
    c.scale.set(0.92, 1.08, 1.0);
    return c;
  };
  const strand = (a, y, len, radius) => {
    const pivot = group(head, Math.sin(a) * R * 0.86, y, Math.cos(a) * R * 0.86 - R * 0.05);
    const s = mesh(new THREE.CapsuleGeometry(radius, len, 4, 8), hair, pivot, 0, -len / 2, 0);
    pivot.rotation.x = Math.cos(a) * -0.2;
    pivot.rotation.z = Math.sin(a) * 0.15;
    return s;
  };
  switch (style.hair) {
    case 'short':
      cap();
      break;
    case 'afro': {
      // a full rounded afro with a soft, bumpy outline
      const g = new THREE.IcosahedronGeometry(R * 1.55, 4);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i);
        const n = 1 + Math.sin(v.x * 140) * Math.sin(v.y * 130) * Math.sin(v.z * 150) * 0.035;
        v.multiplyScalar(n);
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      const a = mesh(g, hair, head, 0, R * 0.42, -R * 0.32);
      a.scale.set(1, 0.92, 0.95);
      hatY = R * 1.85;
      hatScale = 1.45;
      break;
    }
    case 'braids':
      cap(1.05);
      for (let i = 0; i < 13; i++) strand(Math.PI * 0.55 + (i / 12) * Math.PI * 0.9, R * 0.15, R * 2.6, R * 0.07);
      break;
    case 'bun':
      cap();
      mesh(new THREE.SphereGeometry(R * 0.42, 20, 16), hair, head, 0, R * 0.78, -R * 0.62);
      break;
    case 'ponytail': {
      cap();
      mesh(new THREE.TorusGeometry(R * 0.16, R * 0.05, 8, 16), fabric(style.primaryColor), head, 0, R * 0.3, -R * 0.95);
      const tail = group(head, 0, R * 0.3, -R * 1.0);
      mesh(new THREE.CapsuleGeometry(R * 0.2, R * 1.6, 6, 12), hair, tail, 0, -R * 0.95, 0).scale.set(1, 1, 0.7);
      tail.rotation.x = 0.35;
      break;
    }
    case 'dreads':
      cap(1.07);
      for (let i = 0; i < 18; i++) strand(Math.PI * 0.35 + (i / 17) * Math.PI * 1.3, R * 0.35, R * 1.9, R * 0.11);
      break;
    case 'bald':
      hatY = R * 0.98;
      break;
  }

  // ── Hat ──
  const hat = group(head, 0, hatY, -R * 0.04);
  hat.scale.setScalar(hatScale);
  switch (style.hat) {
    case 'cap': {
      const c = mesh(new THREE.SphereGeometry(R * 1.12, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), fabric(style.secondaryColor), hat, 0, -R * 0.55, 0);
      c.scale.y = 0.95;
      const brim = mesh(new THREE.CylinderGeometry(R * 0.8, R * 0.8, R * 0.06, 24, 1, false, -Math.PI / 2, Math.PI), fabric(style.secondaryColor), hat, 0, -R * 0.52, R * 0.5);
      brim.scale.set(1, 1, 1.1);
      mesh(new THREE.SphereGeometry(R * 0.1, 10, 8), fabric(style.primaryColor), hat, 0, R * 0.52, 0);
      break;
    }
    case 'beanie': {
      const b = mesh(new THREE.SphereGeometry(R * 1.13, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), fabric(style.primaryColor), hat, 0, -R * 0.5, 0);
      b.scale.y = 1.2;
      const fold = mesh(new THREE.TorusGeometry(R * 1.1, R * 0.17, 10, 32), fabric(shade(style.primaryColor, 0.78)), hat, 0, -R * 0.45, 0);
      fold.rotation.x = Math.PI / 2;
      mesh(new THREE.SphereGeometry(R * 0.26, 14, 12), fabric('#f4f1ea'), hat, 0, R * 0.9, 0);
      break;
    }
    case 'tophat': {
      const black = plain('#1d1d22', { roughness: 0.45 });
      mesh(new THREE.CylinderGeometry(R * 1.55, R * 1.55, R * 0.08, 32), black, hat, 0, -R * 0.15, 0);
      mesh(new THREE.CylinderGeometry(R * 0.92, R * 0.98, R * 1.6, 32), black, hat, 0, R * 0.66, 0);
      mesh(new THREE.CylinderGeometry(R * 1.0, R * 1.0, R * 0.22, 32), fabric(style.primaryColor), hat, 0, R * 0.0, 0);
      break;
    }
    case 'crown': {
      const band = mesh(new THREE.CylinderGeometry(R * 0.92, R * 0.86, R * 0.42, 32, 1, true), gold, hat, 0, 0, 0);
      band.material.side = THREE.DoubleSide;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        mesh(new THREE.ConeGeometry(R * 0.14, R * 0.42, 8), gold, hat, Math.sin(a) * R * 0.9, R * 0.38, Math.cos(a) * R * 0.9);
        mesh(new THREE.SphereGeometry(R * 0.08, 10, 8), plain('#c8143c', { roughness: 0.15 }), hat, Math.sin(a) * R * 0.93, 0, Math.cos(a) * R * 0.93);
      }
      break;
    }
  }

  // ── Arms: shoulder → upper arm (sleeve) → elbow → forearm → wrist → hand with fingers ──
  // (the arm and sleeve skins are built further down, once every joint is in place)
  const UPPER = 0.29;
  const FORE = 0.26;
  const hands = [];
  const arms = [-1, 1].map((side) => {
    const shoulder = bone(body, side * shoulderX, shoulderY - 0.045, 0);
    const elbow = bone(shoulder, 0, -UPPER, 0);
    const wrist = bone(elbow, 0, -FORE, 0);
    const hand = buildHand(wrist, side);
    hands.push(hand);
    return { shoulder, elbow, wrist };
  });

  // Palm faces +z (forward) in the rest pose; fingers curl toward +z. The thumb is on the
  // outer side: -x for the character's right hand (side −1), +x for the left. Hands are a
  // little bigger than life, so they read well at the table.
  function buildHand(wristBone, side) {
    const wrist = group(wristBone);
    wrist.scale.setScalar(1.12);
    const palm = mesh(new THREE.CapsuleGeometry(0.026, 0.04, 6, 12), skin, wrist, 0, -0.045, 0);
    palm.scale.set(1.55, 1, 0.62);
    const fingers = [];
    const spec = [[-0.022, 0.044, 0.008], [-0.007, 0.05, 0.0085], [0.008, 0.048, 0.0082], [0.022, 0.038, 0.0075]];
    for (const [x, len, r] of spec) {
      const knuckle = group(wrist, x * -side, -0.083, 0.002);
      limb(knuckle, r, len * 0.55, skin);
      const mid = group(knuckle, 0, -len * 0.55, 0);
      limb(mid, r * 0.95, len * 0.48, skin, r * 0.85);
      fingers.push([knuckle, mid]);
    }
    const thumbBase = group(wrist, side * 0.03, -0.035, 0.012);
    thumbBase.rotation.z = side * 0.55;
    limb(thumbBase, 0.0105, 0.03, skin);
    const thumbTip = group(thumbBase, 0, -0.03, 0);
    limb(thumbTip, 0.0095, 0.026, skin, 0.008);
    const palmPoint = new THREE.Object3D();
    palmPoint.position.set(0, -0.06, 0.035); // in front of the palm, where held seeds sit
    wrist.add(palmPoint);
    return { fingers, thumbBase, thumbTip, palmPoint };
  }
  function curlHand(h, curl) {
    for (const [knuckle, mid] of h.fingers) {
      knuckle.rotation.x = curl * 1.15;
      mid.rotation.x = curl * 1.35;
    }
    h.thumbBase.rotation.x = curl * 0.5;
    h.thumbTip.rotation.x = curl * 0.7;
  }

  // ── Legs: hip → thigh → knee → shin → shoe ──
  const legMat = female ? skin : bottom;
  const legX = female ? 0.085 : 0.095;
  const legs = [-1, 1].map((side) => {
    const hip = bone(body, side * legX, hipY, 0);
    const knee = bone(hip, 0, -thighLen, 0);
    const ankle = group(knee, 0, -shinLen, 0);
    const foot = mesh(new THREE.CapsuleGeometry(0.042, 0.13, 6, 12), shoe, ankle, 0, -0.03, 0.06);
    foot.rotation.x = Math.PI / 2;
    foot.scale.set(1.05, 1, 0.75);
    const s = mesh(new THREE.BoxGeometry(0.09, 0.012, 0.25), sole, ankle, 0, -0.058, 0.06);
    s.castShadow = false;
    return { hip, knee };
  });

  // ── Accessory ──
  switch (style.accessory) {
    case 'glasses':
      for (const side of [-1, 1]) {
        const lens = mesh(new THREE.TorusGeometry(R * 0.2, R * 0.025, 8, 24), dark, head, side * R * 0.36, R * 0.13, R * 0.95);
        lens.scale.set(1.1, 0.9, 1);
        mesh(new THREE.CircleGeometry(R * 0.19, 20), plain('#9fb8c8', { transparent: true, opacity: 0.25, roughness: 0.05 }), head, side * R * 0.36, R * 0.13, R * 0.95);
        const temple = mesh(new THREE.BoxGeometry(R * 0.03, R * 0.03, R * 0.9), dark, head, side * R * 0.62, R * 0.15, R * 0.5);
        temple.rotation.y = side * 0.12;
      }
      mesh(new THREE.BoxGeometry(R * 0.2, R * 0.03, R * 0.03), dark, head, 0, R * 0.16, R * 0.98);
      break;
    case 'earrings':
      for (const side of [-1, 1]) {
        const hoop = mesh(new THREE.TorusGeometry(R * 0.13, R * 0.025, 8, 20), gold, head, side * R * 0.9, -R * 0.36, -R * 0.02);
        hoop.rotation.y = Math.PI / 2;
      }
      break;
    case 'beard': {
      // along the jaw and chin, below the mouth (the front half of the lower part of a sphere)
      const b = mesh(new THREE.SphereGeometry(R * 0.84, 24, 10, 0, Math.PI, Math.PI * 0.62, Math.PI * 0.38), hair, head, 0, -R * 0.36, R * 0.1);
      b.scale.set(0.95, 0.9, 1.0);
      b.material.side = THREE.DoubleSide;
      // a moustache above the lip, leaving the mouth free
      const moustache = mesh(new THREE.CapsuleGeometry(R * 0.045, R * 0.3, 4, 8), hair, head, 0, -R * 0.34, R * 0.92);
      moustache.rotation.z = Math.PI / 2;
      break;
    }
    case 'scarf': {
      const scarf = fabric(style.secondaryColor);
      const ring = mesh(new THREE.TorusGeometry(0.075, 0.035, 12, 28), scarf, body, 0, shoulderY + 0.035, 0.005);
      ring.rotation.x = Math.PI / 2;
      ring.scale.set(1.1, 1, 1);
      const tail = mesh(new THREE.BoxGeometry(0.075, 0.26, 0.022), scarf, body, 0.06, shoulderY - 0.1, 0.11);
      tail.rotation.set(-0.12, 0, 0.1);
      break;
    }
    case 'backpack': {
      const pack = fabric(shade(style.secondaryColor, 0.85));
      const bag = mesh(new THREE.BoxGeometry(0.3, 0.38, 0.13), pack, body, 0, hipY + 0.28, -0.17);
      bag.scale.set(1, 1, 1);
      mesh(new THREE.BoxGeometry(0.22, 0.12, 0.05), fabric(shade(style.secondaryColor, 0.65)), body, 0, hipY + 0.17, -0.25);
      for (const side of [-1, 1]) mesh(new THREE.BoxGeometry(0.035, 0.42, 0.015), pack, body, side * 0.1, hipY + 0.3, 0.11);
      break;
    }
  }

  // ── Poses ──
  // Seated at the board. `reach` (0–1) stretches the reaching arm out over the board so the hand
  // is above `reachToX` (sideways, in the character's own metres); `grip` (0–1) cups the hand to
  // hold seeds; `cheer` (0–1) raises both arms; `leanIn` scales how far the body tips forward
  // when reaching (the player leans less, so their head doesn't block the camera).
  const SEAT_DROP = hipY - 0.46; // hips rest on a 0.46 m stool
  const REACH = 0; // index of the sowing arm: the right hand (the model faces +z, so its right is -x)
  const reachShoulderX = -shoulderX;
  let reachNow = 0;
  let cheerNow = 0;
  let gripNow = 0.3;
  let swingNow = -0.1;
  // where the head looks (yaw: + is to the character's left; pitch: + is down), eased
  const lookNow = { yaw: 0, pitch: 0.15 };
  // blinking every few seconds
  let blinkIn = 1 + Math.random() * 3;
  let blinkT = -1;
  // a short gesture: 'nod', 'shake', 'chin', 'laugh', 'clap' or 'surprise'
  let gestureName = null;
  let gestureT = 0;
  let gestureLen = 1;
  function gesture(name, seconds = 1.5) {
    gestureName = name;
    gestureT = 0;
    gestureLen = seconds;
  }

  // standing and walking: `seated` false stands the character up (blended over half a second);
  // `walk` is walking speed in m/s, which swings the legs and arms in step
  let sitNow = 1;
  let phase = 0;
  let talkNow = 0;
  function animate(dt, { reach = 0, reachToX = 0, cheer = 0, time = 0, leanIn = 1, grip = 0, look = null, seated = true, walk = 0, talking = false } = {}) {
    const k = Math.min(1, dt * 10);
    sitNow += ((seated ? 1 : 0) - sitNow) * Math.min(1, dt * 7);
    if (Math.abs(sitNow - (seated ? 1 : 0)) < 0.002) sitNow = seated ? 1 : 0;
    const stand = 1 - sitNow;
    const stride = Math.min(1, walk / 1.6);
    phase += dt * (walk > 0.05 ? 3.6 + walk * 2.6 : 0);
    if (walk <= 0.05) phase += (Math.round(phase / Math.PI) * Math.PI - phase) * Math.min(1, dt * 8); // feet together when stopping
    reachNow += (reach - reachNow) * k;
    cheerNow += (cheer - cheerNow) * Math.min(1, dt * 6);
    const wantGrip = grip > 0 ? grip : reach > 0 ? 0.15 : 0.35;
    gripNow += (wantGrip - gripNow) * Math.min(1, dt * 12);
    // rotating the shoulder about z moves the hand along x
    const swing = reach > 0 ? Math.asin(THREE.MathUtils.clamp((reachToX - reachShoulderX) / 0.6, -0.95, 0.95)) : 0.07;
    swingNow += (swing - swingNow) * Math.min(1, dt * 14);

    // gesture strength: eases in over the first 15%, out over the last 25%
    let g = 0;
    let gp = 0;
    if (gestureName) {
      gestureT += dt;
      gp = gestureT / gestureLen;
      if (gp >= 1) gestureName = null;
      else g = Math.min(1, gp / 0.15, (1 - gp) / 0.25);
    }
    const is = (name) => (gestureName === name ? g : 0);

    // Lean in from the hips: the body tips forward around the hip point, and the legs
    // counter-rotate so the feet stay on the floor. Surprise and laughter rock back a little.
    const seatLean = 0.08 + reachNow * 0.47 * leanIn - 0.2 * is('surprise') - 0.1 * is('laugh');
    const lean = seatLean * sitNow + (0.03 + 0.05 * stride - 0.08 * is('laugh')) * stand;
    const bob = Math.abs(Math.sin(time * 15)) * 0.012 * is('laugh');
    const stepBob = Math.abs(Math.cos(phase)) * 0.025 * stride; // the body rises over each step
    body.rotation.x = lean;
    body.position.set(
      0,
      (-SEAT_DROP + hipY * (1 - Math.cos(lean))) * sitNow + (stepBob - 0.02 * stride) * stand + Math.sin(time * (1.1 + 0.5 * energy)) * 0.003 + bob,
      -hipY * Math.sin(lean) * sitNow,
    );
    legs.forEach(({ hip, knee }, i) => {
      const p = phase + (i ? Math.PI : 0);
      const standHip = Math.sin(p) * 0.42 * stride;
      const standKnee = Math.max(0, Math.sin(p - 1.2)) * 0.75 * stride + 0.04;
      hip.rotation.x = (-Math.PI / 2 - lean) * sitNow + (standHip - lean) * stand;
      hip.rotation.z = (i ? 1 : -1) * (0.08 * sitNow + 0.02 * stand);
      // lively people (the kids) swing their legs while they sit
      const fidget = Math.max(0, energy - 1) * Math.sin(time * 3.2 + i * 2.1) * 0.35 * sitNow;
      knee.rotation.x = (Math.PI / 2 - 0.05) * sitNow + standKnee * stand + fidget;
    });

    // head: follow the look target, plus nods, shakes and laughing
    const want = look ?? { yaw: 0, pitch: (0.15 + reachNow * 0.05) * sitNow + 0.04 * stand };
    const lk = Math.min(1, dt * 5);
    lookNow.yaw += (THREE.MathUtils.clamp(want.yaw, -0.9, 0.9) - lookNow.yaw) * lk;
    lookNow.pitch += (THREE.MathUtils.clamp(want.pitch, -0.35, 0.75) - lookNow.pitch) * lk;
    head.rotation.order = 'YXZ';
    head.rotation.y = lookNow.yaw + Math.sin(gp * Math.PI * 5) * 0.32 * is('shake');
    head.rotation.x = lookNow.pitch + Math.sin(gp * Math.PI * 4) * 0.2 * is('nod') - 0.35 * is('laugh') - 0.15 * is('surprise') + 0.12 * is('chin');
    head.rotation.z = 0.08 * is('chin');
    for (const b of brows) b.position.y = R * 0.38 + R * 0.12 * is('surprise');

    // blinking (and a squint while laughing)
    blinkIn -= dt;
    if (blinkIn <= 0 && blinkT < 0) { blinkT = 0; blinkIn = 2 + Math.random() * 4; }
    let close = 0;
    if (blinkT >= 0) {
      blinkT += dt;
      close = Math.max(0, 1 - Math.abs(blinkT / 0.07 - 1));
      if (blinkT > 0.14) blinkT = -1;
    }
    close = Math.max(close, 0.6 * is('laugh'));
    for (const lid of lids) lid.rotation.x = 0.35 + 1.15 * close;

    // the mouth moves while they talk (and opens wide when they laugh)
    talkNow += ((talking ? 1 : 0) - talkNow) * Math.min(1, dt * 10);
    const chatter = Math.abs(Math.sin(time * 13)) * (0.55 + 0.45 * Math.sin(time * 5.3));
    const open = Math.max(talkNow * chatter, 0.8 * is('laugh'), 0.5 * is('surprise'));
    mouth.scale.y = 0.05 + open * 0.55;
    lowerLip.position.y = lowerLipY - open * R * 0.1;

    // standing at ease, a gentle shift of weight; livelier people sway more
    if (stand > 0.5 && stride < 0.1) body.rotation.z = Math.sin(time * 0.8) * 0.02 * energy * stand;
    else body.rotation.z = 0;

    // Arm angles are set in the world (forward of straight down). A forward lean swings a
    // hanging arm backwards, so the lean is subtracted.
    const wave = Math.sin(time * 9) * 0.25 * cheerNow;
    const clap = is('clap');
    const clapOpen = 0.5 + 0.5 * Math.sin(time * 17);
    arms.forEach(({ shoulder, elbow, wrist }, i) => {
      const side = i ? 1 : -1;
      const reaching = i === REACH ? reachNow : 0;
      // resting: upper arm forward, forearm angled down so the hand lies on the thigh
      let upper = 0.3 + (0.78 - 0.3) * reaching;
      let bend = 0.6 + (0.2 - 0.6) * reaching;
      const restZ = -side * 0.07; // elbows tucked so the hands sit on the thighs
      let z = i === REACH ? swingNow * reaching + restZ * (1 - reaching) : restZ;
      let wristY = Math.PI;
      let wristX = 0.25 * reaching - 0.12 * (1 - reaching);
      let curl = i === REACH ? gripNow : 0.35;

      // thinking: the left hand comes up to stroke the chin
      const chin = i === 1 ? is('chin') : 0;
      if (chin) {
        upper += (1.25 - upper) * chin;
        bend += (2.3 - bend) * chin;
        z += (-0.42 + Math.sin(time * 5) * 0.03 - z) * chin;
        wristX += (-0.5 - wristX) * chin;
        curl += (0.7 - curl) * chin;
      }
      // clapping: both hands in front of the chest, palms facing
      if (clap) {
        upper += (0.95 - upper) * clap;
        bend += (1.15 - bend) * clap;
        z += (-side * (0.5 - 0.14 * clapOpen) - z) * clap;
        wristY += (-side * Math.PI / 2 - wristY) * clap;
        curl += (0.1 - curl) * clap;
      }
      // surprise: hands lift off the knees, palms open
      const sur = is('surprise');
      if (sur) {
        upper += (0.85 - upper) * sur;
        bend += (1.5 - bend) * sur;
        z += (side * 0.25 - z) * sur;
        curl += (0 - curl) * sur;
      }

      // standing: arms hang at the sides, palms in, swinging opposite to the legs
      const swingArm = Math.sin(phase + (i ? 0 : Math.PI)) * 0.35 * stride;
      const st = stand * (1 - chin) * (1 - clap);
      const sx = (-(upper + lean) * (1 - cheerNow) - 2.9 * cheerNow) * (1 - st) + (-swingArm - lean * 0.5) * st;
      shoulder.rotation.x = sx;
      elbow.rotation.x = (-bend * (1 - cheerNow) - 0.35 * cheerNow) * (1 - st) + (-0.18 - 0.25 * stride) * st;
      // Seated, with the forearm forward, the hand's palm side (+z) would face up, so the wrist
      // turns it over: palms down on the thighs and over the board, thumbs inward. Standing,
      // the palms turn in to face the legs.
      wrist.rotation.y = wristY * (1 - cheerNow) * (1 - st) + (-side * Math.PI / 2) * st;
      wrist.rotation.x = wristX * (1 - st);
      shoulder.rotation.z = (z * (1 - cheerNow) + side * 0.35 * cheerNow + wave * side) * (1 - st) + side * 0.07 * st;
      curlHand(hands[i], (curl + cheerNow * 0.5 * (i === REACH ? 0 : 1)) * (1 - st) + 0.3 * st);
    });
  }

  function dispose() {
    for (const g of geometries) g.dispose();
    root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); // the merged parts
    for (const m of materials.values()) m.dispose();
  }

  // ── Smooth skin over the joints ──
  // Arms, sleeves and legs are each one continuous mesh bound to the skeleton, so they bend
  // smoothly at the shoulder, elbow, hip and knee instead of showing separate pieces.
  const boneList = [body, head, ...arms.flatMap((a) => [a.shoulder, a.elbow, a.wrist]), ...legs.flatMap((l) => [l.hip, l.knee])];
  const bi = (b) => boneList.indexOf(b);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneList);
  const smooth = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

  // rings: [{ x, y, z, rx, rz, v, w: [[bone, weight], ...] }], horizontal rings stacked downwards
  function skinTube(rings, material, { radial = 18, capTop = false } = {}) {
    const pos = [];
    const nor = [];
    const uv = [];
    const si = [];
    const sw = [];
    const idx = [];
    const weights = (w) => {
      const list = w.filter(([, v]) => v > 0.001).slice(0, 4);
      const total = list.reduce((s, [, v]) => s + v, 0) || 1;
      const out = [[0, 0], [0, 0], [0, 0], [0, 0]];
      list.forEach(([b, v], k) => { out[k] = [bi(b), v / total]; });
      return out;
    };
    rings.forEach((r) => {
      const w = weights(r.w);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const cx = Math.sin(a);
        const cz = Math.cos(a);
        pos.push(r.x + cx * r.rx, r.y, r.z + cz * r.rz);
        const n = new THREE.Vector3(cx / r.rx, 0, cz / r.rz).normalize();
        nor.push(n.x, n.y, n.z);
        uv.push(j / radial, r.v);
        si.push(...w.map(([b]) => b));
        sw.push(...w.map(([, v]) => v));
      }
    });
    const stride = radial + 1;
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * stride + j;
        const b = a + stride;
        idx.push(a, b, a + 1, b, b + 1, a + 1); // wound so the outside faces out
      }
    }
    if (capTop) {
      // close the top with a fan (for the rounded top of a sleeve)
      const r = rings[0];
      const w = weights(r.w);
      const centre = pos.length / 3;
      pos.push(r.x, r.y + 0.004, r.z);
      nor.push(0, 1, 0);
      uv.push(0.5, r.v);
      si.push(...w.map(([b]) => b));
      sw.push(...w.map(([, v]) => v));
      for (let j = 0; j < radial; j++) idx.push(centre, j, j + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(idx);
    geometries.push(g);
    const m = new THREE.SkinnedMesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // its bounds move with the bones
    root.add(m);
    m.bind(skeleton);
    return m;
  }

  // arms: skin from inside the sleeve to the wrist, and a short sleeve with a rounded shoulder
  arms.forEach(({ shoulder, elbow, wrist }, i) => {
    const side = i ? 1 : -1;
    const sx = side * shoulderX;
    const sy = shoulderY - 0.045;
    const armW = (d) => {
      if (d < 0.04) return [[body, (0.04 - Math.max(0, d)) / 0.04 * 0.5 + (d < 0 ? 0.3 : 0)], [shoulder, 1]];
      if (d > FORE + UPPER - 0.035) return [[elbow, 1], [wrist, smooth((d - (FORE + UPPER - 0.035)) / 0.035) * 0.6]];
      const t = smooth((d - (UPPER - 0.035)) / 0.07);
      return [[shoulder, 1 - t], [elbow, t]];
    };
    const armR = (d) => (d <= UPPER
      ? THREE.MathUtils.lerp(0.043, 0.036, d / UPPER)
      : d < UPPER + 0.06 ? THREE.MathUtils.lerp(0.035, 0.038, (d - UPPER) / 0.06) : THREE.MathUtils.lerp(0.038, 0.027, (d - UPPER - 0.06) / (FORE - 0.06)));
    const skinRings = [0.03, 0.07, 0.12, 0.17, 0.22, 0.255, 0.28, 0.3, 0.32, 0.35, 0.4, 0.45, 0.5, 0.535, 0.548].map((d) => ({
      x: sx, y: sy - d, z: 0, rx: armR(d), rz: armR(d) * 0.9, v: d / 0.25, w: armW(d),
    }));
    skinTube(skinRings, skin);
    const sleeveRings = [-0.05, -0.043, -0.032, -0.018, 0, 0.04, 0.09, 0.13, 0.15, 0.158].map((d) => {
      const base = d < 0 ? 0.053 * Math.sqrt(Math.max(0.04, 1 - (d / 0.055) ** 2)) : THREE.MathUtils.lerp(0.053, 0.048, d / 0.15) + (d > 0.15 ? 0.003 : 0);
      return { x: sx - side * (d < 0 ? 0.012 * (-d / 0.05) : 0), y: sy - d, z: 0, rx: base, rz: base * 0.92, v: d / 0.25, w: armW(d) };
    });
    skinTube(sleeveRings, sleeveMat, { capTop: true });
  });

  // legs: trousers (or bare legs under the skirt) from the hip to the ankle
  legs.forEach(({ hip, knee }, i) => {
    const side = i ? 1 : -1;
    const kd = thighLen;
    const end = thighLen + shinLen - 0.012;
    const legW = (d) => {
      if (d < 0.06) return [[body, (0.06 - Math.max(0, d)) / 0.06 * 0.45 + (d < 0 ? 0.25 : 0)], [hip, 1]];
      const t = smooth((d - (kd - 0.045)) / 0.09);
      return [[hip, 1 - t], [knee, t]];
    };
    const thigh0 = female ? 0.072 : 0.082;
    const kneeR = female ? 0.05 : 0.06;
    const calf = female ? 0.054 : 0.063;
    const ankleR = female ? 0.036 : 0.05;
    const legR = (d) => (d <= kd
      ? THREE.MathUtils.lerp(thigh0, kneeR + 0.004, smooth(d / kd))
      : d < kd + 0.12 ? THREE.MathUtils.lerp(kneeR, calf, (d - kd) / 0.12) : THREE.MathUtils.lerp(calf, ankleR, (d - kd - 0.12) / (end - kd - 0.12)));
    const ds = [-0.04, -0.01, 0.03, 0.08, 0.14, 0.2, 0.26, 0.32, kd - 0.05, kd - 0.02, kd, kd + 0.03, kd + 0.08, kd + 0.14, kd + 0.22, kd + 0.3, end];
    skinTube(ds.map((d) => ({ x: side * legX, y: hipY - d, z: 0, rx: legR(d), rz: legR(d) * 0.95, v: d / 0.3, w: legW(d) })), legMat);
  });

  // ── Merge parts that never move relative to each other (far fewer draw calls) ──
  const joints = new Set([
    body, head,
    ...arms.flatMap((a) => [a.shoulder, a.elbow, a.wrist]),
    ...hands.flatMap((h) => [...h.fingers.flat(), h.thumbBase, h.thumbTip]),
    ...legs.flatMap((l) => [l.hip, l.knee]),
  ]);
  const moving = new Set([...lids, ...brows, lowerLip, mouth].filter(Boolean));
  const byJoint = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || moving.has(o)) return;
    // tiny parts (fingers, eyes, lips) don't need to cast shadows
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const s = o.getWorldScale(new THREE.Vector3());
    if (o.geometry.boundingSphere.radius * Math.max(s.x, s.y, s.z) < 0.035) o.castShadow = false;
    let j = o.parent;
    while (j && j !== root && !joints.has(j)) j = j.parent;
    const key = j ?? root;
    if (!byJoint.has(key)) byJoint.set(key, []);
    byJoint.get(key).push(o);
  });
  for (const [joint, list] of byJoint) mergeInto(joint, list);

  // ── Level of detail: from a few metres away, fingers and small face parts can't be seen,
  // so they're skipped (each is a separate draw call) ──
  const fine = new Set([white, iris, lips]);
  const details = [...lids, ...brows];
  for (const h of hands) {
    for (const node of [...h.fingers.flat(), h.thumbBase, h.thumbTip]) {
      for (const c of node.children) if (c.isMesh) details.push(c);
    }
  }
  head.traverse((o) => { if (o.isMesh && fine.has(o.material)) details.push(o); });
  let detailed = true;
  function setDetail(on) {
    if (on === detailed) return;
    detailed = on;
    for (const m of details) m.visible = on;
  }

  animate(0);
  return { root, body, head, headY, headR: R, palm: hands[REACH].palmPoint, animate, gesture, setDetail, dispose, style };
}
