// The verandah: lighting, the house, the stools and table, and the carved Ayo board with its seeds.
import * as THREE from 'three';
import { RGBELoader } from '../vendor/RGBELoader.js';

const loader = new THREE.TextureLoader();
function tex(name, repeatX = 1, repeatY = repeatX, color = false) {
  const t = loader.load(`assets/${name}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function pbr(prefix, repeatX, repeatY, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map: tex(`${prefix}_diff`, repeatX, repeatY, true),
    normalMap: tex(`${prefix}_nor`, repeatX, repeatY),
    roughnessMap: tex(`${prefix}_rough`, repeatX, repeatY),
    ...extra,
  });
}

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
  const hdr = await new RGBELoader().loadAsync('assets/sky.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr;
  scene.background = hdr;
  scene.backgroundBlurriness = 0.35;
  scene.backgroundIntensity = 0.85;
  scene.environmentIntensity = 1.0;
  scene.backgroundRotation.y = 2.2;
  scene.environmentRotation.y = 2.2;

  // low sun slanting in from the open side of the verandah
  const sun = new THREE.DirectionalLight('#ffe2b8', 2.6);
  sun.position.set(4.5, 4.2, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3.5, right: 3.5, top: 3.5, bottom: -3.5, near: 0.5, far: 14 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  scene.add(sun);

  const add = (geo, mat, x, y, z, { cast = true, receive = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = receive;
    scene.add(m);
    return m;
  };

  // ── The verandah ──
  const floorMat = pbr('floor', 5, 4, { color: '#c9b7a3' });
  add(new THREE.PlaneGeometry(10, 8).rotateX(-Math.PI / 2), floorMat, 0, 0, 0, { cast: false });

  const wallMat = pbr('wall', 3, 1.2, { color: '#f2ece0' });
  const wallH = 3.1;
  add(new THREE.BoxGeometry(9, wallH, 0.25), wallMat, 0, wallH / 2, -2.1);
  add(new THREE.BoxGeometry(0.25, wallH, 4.5), wallMat, -3.6, wallH / 2, 0.05);
  // skirting stripe, a common touch on Lagos houses
  const skirt = new THREE.MeshStandardMaterial({ color: '#7a3b2e', roughness: 0.8 });
  add(new THREE.BoxGeometry(9, 0.32, 0.26), skirt, 0, 0.16, -2.09, { cast: false });
  add(new THREE.BoxGeometry(0.26, 0.32, 4.5), skirt, -3.59, 0.16, 0.05, { cast: false });

  // ceiling and the beam along the open edge
  const ceiling = new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.95 });
  add(new THREE.BoxGeometry(9, 0.12, 4.6), ceiling, 0, wallH + 0.06, 0.05, { receive: false });
  add(new THREE.BoxGeometry(9, 0.35, 0.3), wallMat, 0, wallH - 0.17, 2.2);
  add(new THREE.BoxGeometry(0.3, 0.35, 4.6), wallMat, 4.35, wallH - 0.17, 0.05);
  for (const [x, z] of [[4.35, 2.2], [4.35, -0.9], [1.2, 2.2], [-2.2, 2.2]]) {
    add(new THREE.BoxGeometry(0.3, wallH, 0.3), wallMat, x, wallH / 2, z);
  }
  // low wall between the pillars on the open side
  add(new THREE.BoxGeometry(0.22, 0.75, 3.1), wallMat, 4.35, 0.375, 0.65);

  // window with burglar-proof bars, behind Baba
  const frame = new THREE.MeshStandardMaterial({ color: '#2f3a44', roughness: 0.5, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1e2a33', roughness: 0.08, metalness: 0.2, envMapIntensity: 1.4 });
  add(new THREE.BoxGeometry(1.5, 1.2, 0.04), glass, -1.2, 1.65, -1.97, { cast: false });
  for (let i = 0; i <= 6; i++) {
    add(new THREE.BoxGeometry(0.025, 1.24, 0.025), frame, -1.95 + i * 0.25, 1.65, -1.93, { cast: false });
  }
  for (const y of [1.05, 1.45, 1.85, 2.25]) add(new THREE.BoxGeometry(1.54, 0.025, 0.025), frame, -1.2, y, -1.93, { cast: false });

  // wooden door
  const door = pbr('wood', 1, 2.2, { color: '#7a4a2a' });
  add(new THREE.BoxGeometry(1.0, 2.2, 0.06), door, 1.6, 1.1, -1.96, { cast: false });
  add(new THREE.SphereGeometry(0.035, 12, 10), frame, 1.22, 1.08, -1.91, { cast: false });

  // potted plant by the wall
  const pot = new THREE.MeshStandardMaterial({ color: '#9b4a2c', roughness: 0.85 });
  add(new THREE.CylinderGeometry(0.22, 0.16, 0.42, 20), pot, -3.1, 0.21, -1.6);
  const leaf = new THREE.MeshStandardMaterial({ color: '#3f6b2a', roughness: 0.7, side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const l = add(new THREE.PlaneGeometry(0.16, 0.7), leaf, -3.1 + Math.cos(a) * 0.08, 0.75, -1.6 + Math.sin(a) * 0.08);
    l.rotation.set(0.35 * Math.sin(a), a, 0.35 * Math.cos(a));
  }

  // ── Table, stools and board ──
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

  return { scene, seeds, hitTargets, glow, sun };
}
