// Builds the player's start.ng character from its `style` (https://start.ng/docs#character-style-fields).
// Every field changes the model: body shape, top, trousers/skirt, skin, hair, hat and accessory.
// Realistic proportions (head about 1/7.5 of standing height), shaped torso, elbows and knees,
// and hands with jointed fingers. The character faces +Z and sits on a stool (hips 0.46 m up).
import * as THREE from 'three';

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

export function buildCharacter(rawStyle) {
  const style = normalizeStyle(rawStyle);
  const female = style.body === 'female';
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
  const top = fabric(style.primaryColor);
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
  const body = new THREE.Group(); // leans and breathes; root only moves and turns
  root.add(body);

  // ── Proportions (metres, standing) ──
  const hipY = female ? 0.84 : 0.88;
  const thighLen = female ? 0.41 : 0.43;
  const shinLen = hipY - thighLen - 0.04;
  const torsoLen = female ? 0.5 : 0.53;
  const shoulderY = hipY + torsoLen;
  const shoulderX = female ? 0.165 : 0.2;
  const R = 0.105; // head radius
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

  // hips: trousers' seat for men, the top of the skirt for women
  if (female) {
    const skirt = [[0.15, 0.1], [0.168, 0.04], [0.19, -0.06], [0.215, -0.14]];
    const s = mesh(new THREE.LatheGeometry(skirt.map(([r, y]) => new THREE.Vector2(r, y)), 32), bottom, body, 0, hipY, 0);
    s.scale.z = 0.8;
    s.material.side = THREE.DoubleSide;
  } else {
    const seat = mesh(new THREE.SphereGeometry(0.16, 24, 14), bottom, body, 0, hipY + 0.02, -0.01);
    seat.scale.set(1.02, 0.55, 0.72);
  }

  // ── Neck and head ──
  mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.12, 14), skin, body, 0, shoulderY + 0.06, 0);
  const head = group(body, 0, headY, 0.005);
  const skull = mesh(new THREE.SphereGeometry(R, 32, 24), skin, head);
  skull.scale.set(0.88, 1.08, 0.98);
  const jaw = mesh(new THREE.SphereGeometry(R * 0.78, 24, 16), skin, head, 0, -R * 0.42, R * 0.18);
  jaw.scale.set(female ? 0.9 : 0.98, 0.78, 0.92);
  const nose = mesh(new THREE.SphereGeometry(R * 0.17, 12, 10), skin, head, 0, -R * 0.12, R * 0.93);
  nose.scale.set(1.15, 0.9, 1.0);
  mesh(new THREE.SphereGeometry(R * 0.1, 10, 8), skin, head, 0, R * 0.04, R * 0.9).scale.set(0.8, 1.6, 0.9); // bridge
  // lips
  for (const [y, w] of [[-R * 0.42, 0.95], [-R * 0.52, 0.8]]) {
    const l = mesh(new THREE.CapsuleGeometry(R * 0.07, R * 0.28, 4, 10), lips, head, 0, y, R * 0.86);
    l.rotation.z = Math.PI / 2;
    l.scale.set(1, w, 0.7);
  }
  // eyes (with lids that blink), brows that lift, and ears
  const lids = [];
  const brows = [];
  for (const side of [-1, 1]) {
    const eye = group(head, side * R * 0.36, R * 0.13, R * 0.74);
    mesh(new THREE.SphereGeometry(R * 0.15, 14, 12), white, eye);
    mesh(new THREE.SphereGeometry(R * 0.085, 12, 10), iris, eye, 0, 0, R * 0.09);
    const lid = mesh(new THREE.SphereGeometry(R * 0.165, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), skin, eye);
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
    const c = mesh(new THREE.SphereGeometry(R * extra, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.6), hair, head, 0, R * 0.04, -R * 0.06);
    c.rotation.x = -0.5;
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
  const sleeve = fabric(style.primaryColor);
  const hands = [];
  const arms = [-1, 1].map((side) => {
    const shoulder = group(body, side * shoulderX, shoulderY - 0.045, 0);
    mesh(new THREE.SphereGeometry(0.05, 16, 12), sleeve, shoulder).scale.set(1, 0.9, 0.95);
    limb(shoulder, 0.047, 0.15, sleeve, 0.044); // short sleeve
    limb(shoulder, 0.041, 0.29, skin, 0.036).position.y = -0.155;
    const elbow = group(shoulder, 0, -0.29, 0);
    limb(elbow, 0.036, 0.26, skin, 0.03);
    const wrist = group(elbow, 0, -0.26, 0);
    const hand = buildHand(wrist, side);
    hands.push(hand);
    return { shoulder, elbow, wrist };
  });

  // Palm faces +z (forward) in the rest pose; fingers curl toward +z. The thumb is on the
  // outer side: -x for the character's right hand (side −1), +x for the left.
  function buildHand(wrist, side) {
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
  const legs = [-1, 1].map((side) => {
    const hip = group(body, side * (female ? 0.085 : 0.095), hipY, 0);
    limb(hip, female ? 0.068 : 0.078, thighLen + 0.03, legMat, female ? 0.052 : 0.062).position.y = -(thighLen + 0.03) / 2 + 0.015;
    const knee = group(hip, 0, -thighLen, 0);
    mesh(new THREE.SphereGeometry(female ? 0.052 : 0.062, 14, 12), legMat, knee);
    limb(knee, female ? 0.05 : 0.058, shinLen, legMat, female ? 0.036 : 0.048);
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
      const b = mesh(new THREE.SphereGeometry(R * 0.86, 24, 14, 0, Math.PI, Math.PI * 0.42, Math.PI * 0.5), hair, head, 0, -R * 0.3, R * 0.12);
      b.rotation.y = -Math.PI / 2 + Math.PI / 2; // front half
      b.scale.set(0.98, 0.95, 1.0);
      b.material.side = THREE.DoubleSide;
      const moustache = mesh(new THREE.CapsuleGeometry(R * 0.06, R * 0.32, 4, 8), hair, head, 0, -R * 0.33, R * 0.9);
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

  function animate(dt, { reach = 0, reachToX = 0, cheer = 0, time = 0, leanIn = 1, grip = 0, look = null } = {}) {
    const k = Math.min(1, dt * 10);
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
    const lean = 0.08 + reachNow * 0.47 * leanIn - 0.2 * is('surprise') - 0.1 * is('laugh');
    const bob = Math.abs(Math.sin(time * 15)) * 0.012 * is('laugh');
    body.rotation.x = lean;
    body.position.set(0, -SEAT_DROP + hipY * (1 - Math.cos(lean)) + Math.sin(time * 1.6) * 0.003 + bob, -hipY * Math.sin(lean));
    legs.forEach(({ hip, knee }, i) => {
      hip.rotation.x = -Math.PI / 2 - lean;
      hip.rotation.z = (i ? 1 : -1) * 0.08;
      knee.rotation.x = Math.PI / 2 - 0.05;
    });

    // head: follow the look target, plus nods, shakes and laughing
    const want = look ?? { yaw: 0, pitch: 0.15 + reachNow * 0.05 };
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

      shoulder.rotation.x = -(upper + lean) * (1 - cheerNow) - 2.9 * cheerNow;
      elbow.rotation.x = -bend * (1 - cheerNow) - 0.35 * cheerNow;
      // With the forearm forward the hand's palm side (+z) would face up, so the wrist turns
      // it over (pronates): palms down on the thighs and over the board, thumbs inward.
      wrist.rotation.y = wristY * (1 - cheerNow);
      wrist.rotation.x = wristX;
      shoulder.rotation.z = z * (1 - cheerNow) + side * 0.35 * cheerNow + wave * side;
      curlHand(hands[i], curl + cheerNow * 0.5 * (i === REACH ? 0 : 1));
    });
  }

  function dispose() {
    for (const g of geometries) g.dispose();
    for (const m of materials.values()) m.dispose();
  }

  animate(0);
  return { root, body, head, headY, headR: R, palm: hands[REACH].palmPoint, animate, gesture, dispose, style };
}
