// Ilé Eré: lighting, the game house, and the Ayo table with its carved board and seeds.
// The Ayo table sits at the origin; the rest of the house (other tables, courtyard, gate) comes
// from house.js.
import * as THREE from 'three';
import { RGBELoader } from '../vendor/RGBELoader.js';
import { manager, allLoaded, pbr } from './assets.js';
import { buildHouse } from './house.js';
import { mergeInto } from './merge.js';

export { onLoadProgress } from './assets.js';

// ── Board layout ──
// Pits 0–5 are the player's row (near side, left → right); 6–11 continue anticlockwise along
// Baba's row (right → left as the player sees it). Stores sit at each end: the player's on
// their right (+x), Baba's on the left. Sizes are real: the board is about 62 cm long.
export const TABLE_TOP = 0.34;
export const BOARD_TOP = TABLE_TOP + 0.047;
const PIT_R = 0.029;
const PIT_DEPTH = 0.6; // bowl is a squashed hemisphere
const STORE_RX = 0.03;
const STORE_RZ = 0.07;
const SEED_R = 0.0085; // nickernuts are about 1.7 cm across
export const SEAT_Z = 0.72; // stools either side of the table

export function pitCenter(i) {
  const col = i < 6 ? i : 11 - i;
  return new THREE.Vector3(-0.19 + col * 0.076, BOARD_TOP, i < 6 ? 0.041 : -0.041);
}
export function storeCenter(player) {
  return new THREE.Vector3(player === 0 ? 0.265 : -0.265, BOARD_TOP, 0);
}

// Height of a bowl's surface at distance r from its centre (scaled hemisphere).
function bowlFloor(r, radius) {
  return BOARD_TOP - PIT_DEPTH * Math.sqrt(Math.max(0, radius * radius - r * r));
}

// Small deterministic jitter per seed so piles look natural but don't twitch.
function jitter(id, k) {
  const x = Math.sin(id * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

// Where the n-th seed sits in a pit (a loose pile: a ring of 6 around 1, then layers above).
export function seedSlot(i, n, id) {
  const c = pitCenter(i);
  const layer = Math.floor(n / 7);
  const k = n % 7;
  const ring = k === 0 ? 0 : 0.0175 - layer * 0.002;
  const a = (k / 6) * Math.PI * 2 + layer * 0.5 + jitter(id, 1) * 0.3;
  const x = Math.cos(a) * ring + jitter(id, 2) * 0.003;
  const z = Math.sin(a) * ring + jitter(id, 3) * 0.003;
  const y = bowlFloor(Math.hypot(x, z), PIT_R) + SEED_R * 0.86 + layer * 0.0135;
  return new THREE.Vector3(c.x + x, y, c.z + z);
}

// Where the n-th seed sits in a store (rows along the long oval, layered).
export function storeSlot(player, n, id) {
  const c = storeCenter(player);
  const perLayer = 14;
  const layer = Math.floor(n / perLayer);
  const k = n % perLayer;
  const row = Math.floor(k / 2);
  const x = (k % 2 ? 0.0095 : -0.0095) + jitter(id, 4) * 0.003;
  const z = -0.051 + row * 0.017 + jitter(id, 5) * 0.003;
  const r = Math.hypot(x / STORE_RX, z / STORE_RZ) * STORE_RX;
  const y = bowlFloor(Math.min(r, STORE_RX * 0.95), STORE_RX) + SEED_R * 0.86 + layer * 0.0135;
  return new THREE.Vector3(c.x + x, y, c.z + z);
}

export async function buildScene(renderer) {
  const scene = new THREE.Scene();

  // Afternoon light from the sky photo; the house blocks most of it so it reads as shade.
  // (started now, used once everything else is queued, so all downloads run together)
  const sky = new RGBELoader(manager).loadAsync('assets/sky.hdr').then((hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
    scene.background = hdr;
  });
  scene.backgroundBlurriness = 0.35;
  scene.backgroundIntensity = 0.85;
  scene.environmentIntensity = 1.0;
  scene.backgroundRotation.y = 2.2;
  scene.environmentRotation.y = 2.2;

  // Low sun slanting in from the courtyard. Its shadow box follows whatever the camera is
  // looking at (see followSun), so shadows stay sharp anywhere in the house.
  const sun = new THREE.DirectionalLight('#ffe2b8', 2.6);
  const sunOffset = new THREE.Vector3(4.5, 4.2, 2.5);
  sun.position.copy(sunOffset);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 0.5, far: 18 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  function followSun(focus) {
    // snap to a grid so the shadow edges don't shimmer as the focus moves
    const fx = Math.round(focus.x * 4) / 4;
    const fz = Math.round(focus.z * 4) / 4;
    sun.target.position.set(fx, 0, fz);
    sun.position.set(fx + sunOffset.x, sunOffset.y, fz + sunOffset.z);
  }

  // Everything made with add() is part of the building and never moves, so it's all merged
  // into a few big meshes once the house is built (see mergeInto at the end).
  const statics = [];
  const add = (geo, mat, x, y, z, { cast = true, receive = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = receive;
    scene.add(m);
    statics.push(m);
    return m;
  };

  // ── The house: verandah, courtyard, gate and the other tables ──
  const house = buildHouse(scene, add);
  // the Ayo table, its two stools and the radio's stool can't be walked through either
  for (const [cx, cz, w, d] of [[0, 0, 0.85, 0.5], [0, SEAT_Z, 0.44, 0.44], [0, -SEAT_Z, 0.44, 0.44], [-2.75, -1.55, 0.4, 0.4]]) {
    house.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  }

  // ── The Ayo table, stools and board ──
  const woodLight = pbr('wood', 1, 1, { color: '#f0d2ae' });
  const woodDark = pbr('board', 1.5, 1, { color: '#b98a62' });
  // a low table between two stools
  add(new THREE.BoxGeometry(0.8, 0.04, 0.42), woodLight, 0, TABLE_TOP - 0.02, 0);
  for (const [x, z] of [[-0.36, -0.17], [0.36, -0.17], [-0.36, 0.17], [0.36, 0.17]]) {
    add(new THREE.BoxGeometry(0.045, TABLE_TOP - 0.04, 0.045), woodLight, x, (TABLE_TOP - 0.04) / 2, z);
  }
  for (const z of [SEAT_Z, -SEAT_Z]) {
    add(new THREE.CylinderGeometry(0.2, 0.19, 0.05, 24), woodLight, 0, 0.435, z);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const legGeo = new THREE.CylinderGeometry(0.022, 0.026, 0.43, 8);
      const leg = add(legGeo, woodLight, Math.cos(a) * 0.13, 0.205, z + Math.sin(a) * 0.13);
      leg.rotation.set(Math.sin(a) * -0.12, 0, Math.cos(a) * 0.12);
    }
  }

  // the board: a body, then a top plate with the pits and stores cut through, over carved bowls
  const boardW = 0.62;
  const boardD = 0.19;
  add(new THREE.BoxGeometry(boardW - 0.012, 0.024, boardD - 0.012), woodDark, 0, TABLE_TOP + 0.012, 0);
  const shape = new THREE.Shape();
  const hw = boardW / 2;
  const hd = boardD / 2;
  const rr = 0.03;
  shape.moveTo(-hw + rr, -hd);
  shape.lineTo(hw - rr, -hd);
  shape.quadraticCurveTo(hw, -hd, hw, -hd + rr);
  shape.lineTo(hw, hd - rr);
  shape.quadraticCurveTo(hw, hd, hw - rr, hd);
  shape.lineTo(-hw + rr, hd);
  shape.quadraticCurveTo(-hw, hd, -hw, hd - rr);
  shape.lineTo(-hw, -hd + rr);
  shape.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
  for (let i = 0; i < 12; i++) {
    const c = pitCenter(i);
    const hole = new THREE.Path();
    hole.absarc(c.x, -c.z, PIT_R, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  for (const p of [0, 1]) {
    const c = storeCenter(p);
    const hole = new THREE.Path();
    hole.absellipse(c.x, -c.z, STORE_RX, STORE_RZ, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const plateGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.017, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 3, curveSegments: 32 });
  plateGeo.rotateX(-Math.PI / 2);
  const plateMat = pbr('board', 2.2, 2.2, { color: '#ffe2c4' });
  add(plateGeo, plateMat, 0, TABLE_TOP + 0.027, 0);

  const bowlMat = pbr('board', 0.25, 0.25, { color: '#d9a982', side: THREE.DoubleSide });
  const bowlGeo = new THREE.SphereGeometry(PIT_R, 28, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  for (let i = 0; i < 12; i++) {
    const c = pitCenter(i);
    const b = add(bowlGeo, bowlMat, c.x, BOARD_TOP - 0.004, c.z, { cast: false });
    b.scale.y = PIT_DEPTH;
  }
  const storeGeo = new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  for (const p of [0, 1]) {
    const c = storeCenter(p);
    const b = add(storeGeo, bowlMat, c.x, BOARD_TOP - 0.004, c.z, { cast: false });
    b.scale.set(STORE_RX, STORE_RX * PIT_DEPTH, STORE_RZ);
  }

  // ── Seeds: grey nickernuts (Caesalpinia bonduc), glossy, each a slightly different shade ──
  const seedGeo = new THREE.SphereGeometry(SEED_R, 16, 12);
  seedGeo.scale(1, 0.86, 1.1);
  const shades = ['#a3a597', '#9a9c8c', '#b1b2a6', '#8f9384', '#a9a48f', '#9ea294'];
  const seedMats = shades.map((c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.25 }));
  const seeds = [];
  for (let id = 0; id < 48; id++) {
    const m = new THREE.Mesh(seedGeo, seedMats[id % shades.length]);
    m.castShadow = true;
    m.receiveShadow = true;
    m.rotation.set(jitter(id, 6) * 3, jitter(id, 7) * 6, jitter(id, 8) * 3);
    m.userData.id = id;
    scene.add(m);
    seeds.push(m);
  }

  // invisible click targets over the player's pits, and a glow ring to show the hovered pit
  const hitGeo = new THREE.CylinderGeometry(PIT_R + 0.008, PIT_R + 0.008, 0.06, 20);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitTargets = [];
  for (let i = 0; i < 6; i++) {
    const c = pitCenter(i);
    const h = new THREE.Mesh(hitGeo, hitMat);
    h.position.set(c.x, BOARD_TOP + 0.01, c.z);
    h.userData.pit = i;
    scene.add(h);
    hitTargets.push(h);
  }
  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(PIT_R + 0.004, 0.0025, 8, 40).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0.9 }),
  );
  glow.visible = false;
  scene.add(glow);

  // ── Hurricane lantern hanging over the table (lit at night) ──
  const metal = new THREE.MeshStandardMaterial({ color: '#3a3f44', roughness: 0.4, metalness: 0.8 });
  const lantern = new THREE.Group();
  house.occluders.push(lantern);
  lantern.position.set(0.32, 1.72, -0.05);
  scene.add(lantern);
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 3.1 - 1.86, 6), metal);
  wire.position.y = (3.1 - 1.72) / 2 + 0.07;
  lantern.add(wire);
  const flameGlass = new THREE.MeshStandardMaterial({ color: '#fff2d8', emissive: '#ffb35c', emissiveIntensity: 0, transparent: true, opacity: 0.75, roughness: 0.1 });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 16), flameGlass);
  globe.scale.y = 1.25;
  lantern.add(globe);
  for (const y of [0.085, -0.085]) {
    const capMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.03, 16), metal);
    capMesh.position.y = y;
    lantern.add(capMesh);
  }
  // the Ayo lantern's light, and a spot that throws the board's shadows (added at night only)
  const lanternLight = new THREE.PointLight('#ffb35c', 2.2, 5, 1.6);
  lanternLight.position.copy(lantern.position);
  const lanternSpot = new THREE.SpotLight('#ffbf70', 7, 4, 0.9, 0.6, 1.4);
  lanternSpot.position.copy(lantern.position).add(new THREE.Vector3(0, -0.1, 0));
  lanternSpot.target.position.set(0, TABLE_TOP, 0);
  lanternSpot.castShadow = true;
  lanternSpot.shadow.mapSize.set(1024, 1024);
  lanternSpot.shadow.bias = -0.0005;
  scene.add(lanternSpot.target);

  // Time of day follows the player's own clock: afternoon, golden evening, or night by lantern.
  function setTimeOfDay(kind) {
    const night = kind === 'night';
    const evening = kind === 'evening';
    sun.color.set(night ? '#8fa6ff' : evening ? '#ffad66' : '#ffe2b8');
    sun.intensity = night ? 0.25 : evening ? 2.3 : 2.6;
    sunOffset.set(evening ? 5.2 : 4.5, evening ? 2.1 : night ? 5 : 4.2, evening ? 3.4 : 2.5);
    followSun(sun.target.position);
    scene.environmentIntensity = night ? 0.1 : evening ? 0.55 : 1.0;
    scene.backgroundIntensity = night ? 0.06 : evening ? 0.45 : 0.85;
    if (night) scene.add(lanternLight, lanternSpot);
    else scene.remove(lanternLight, lanternSpot);
    flameGlass.emissiveIntensity = night ? 2.5 : 0;
    house.setNight(night);
  }
  setTimeOfDay('day');

  // ── Chickens wandering the open end of the verandah ──
  function chicken(color) {
    const c = new THREE.Group();
    const feathers = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    const red = new THREE.MeshStandardMaterial({ color: '#c8231c', roughness: 0.6 });
    const beakMat = new THREE.MeshStandardMaterial({ color: '#e0a332', roughness: 0.5 });
    const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 14), feathers);
    bodyMesh.scale.set(0.85, 0.8, 1.15);
    bodyMesh.position.y = 0.2;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 10), feathers);
    tail.position.set(0, 0.27, -0.12);
    tail.rotation.x = -0.7;
    const head = new THREE.Group();
    head.position.set(0, 0.3, 0.1);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 12), feathers);
    const comb = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.035, 0.05), red);
    comb.position.set(0, 0.045, 0.005);
    const wattle = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), red);
    wattle.position.set(0, -0.035, 0.035);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 8), beakMat);
    beak.position.set(0, -0.005, 0.055);
    beak.rotation.x = Math.PI / 2;
    head.add(skull, comb, wattle, beak);
    const legs = [-1, 1].map((s) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), beakMat);
      leg.geometry.translate(0, -0.06, 0);
      leg.position.set(s * 0.035, 0.13, 0);
      c.add(leg);
      return leg;
    });
    c.add(bodyMesh, tail, head);
    c.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    c.userData = { head, legs, target: new THREE.Vector3(), wait: 0, peck: 0 };
    scene.add(c);
    return c;
  }
  const chickens = [chicken('#f2ede4'), chicken('#8a4b24')];
  chickens[0].position.set(-1.5, 0, 5.5);
  chickens[1].position.set(1.2, 0, 7.5);

  // ── A small radio on a stool by the wall (click it to switch the music on or off) ──
  const radio = new THREE.Group();
  radio.position.set(-2.75, 0, -1.55);
  scene.add(radio);
  const stoolTop = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 20), woodLight);
  stoolTop.position.y = 0.42;
  radio.add(stoolTop);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.42, 8), woodLight);
    leg.position.set(Math.cos(a) * 0.11, 0.21, Math.sin(a) * 0.11);
    radio.add(leg);
  }
  const caseMat = new THREE.MeshStandardMaterial({ color: '#5a2e1c', roughness: 0.5 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.17, 0.1), caseMat);
  box.position.y = 0.525;
  const grille = new THREE.Mesh(new THREE.CircleGeometry(0.055, 24), new THREE.MeshStandardMaterial({ color: '#1d1b19', roughness: 0.9 }));
  grille.position.set(-0.06, 0.525, 0.051);
  const dialMat = new THREE.MeshStandardMaterial({ color: '#e7d7a8', emissive: '#ffcf6e', emissiveIntensity: 0 });
  const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.035), dialMat);
  dial.position.set(0.075, 0.545, 0.051);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.32, 6), metal);
  antenna.position.set(0.11, 0.75, -0.02);
  antenna.rotation.z = -0.4;
  radio.add(box, grille, dial, antenna);
  radio.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const setRadioLight = (on) => { dialMat.emissiveIntensity = on ? 1.2 : 0; };

  mergeInto(scene, statics);
  await Promise.all([sky, allLoaded]);
  return { scene, seeds, hitTargets, glow, sun, followSun, setTimeOfDay, chickens, radio: box, setRadioLight, house };
}
