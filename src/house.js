// Baba's Joint: the game house around the Ayo table. A long verandah with a table for each game,
// a walled courtyard with the snooker and table-football tables, and the gate you walk in by.
//
// Layout (metres): the verandah runs along x from -3.6 to 14.4, back wall at z = -2.1, open
// edge at z = 2.2. The courtyard runs from there to the front wall at z = 10.5, with the gate
// in the middle. The Ayo table is at the origin (built in scene.js).
import * as THREE from 'three';
import { pbr, tex } from './assets.js';

export const VERANDAH = { minX: -3.6, maxX: 14.4, back: -2.1, front: 2.2 };
export const YARD = { minX: -3.6, maxX: 14.4, front: 10.5 };
export const GATE = { minX: 4.3, maxX: 6.3 };
export const SPAWN = new THREE.Vector3(5.3, 0, 7.6);
const WALL_H = 3.1;

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildHouse(scene, add) {
  const colliders = []; // axis-aligned boxes on the floor: { minX, maxX, minZ, maxZ }
  const block = (cx, cz, w, d) => colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  const nightLights = [];
  const occluders = []; // small hanging things the camera might pass through (hidden when it does)
  const tables = {}; // where each game's playing surface is, for the table games to put their pieces on
  const glowMats = [];

  // ── Materials ──
  const tiles = pbr('floor', 9, 2.2, { color: '#c9b7a3' });
  // plain grey concrete (the plaster texture is blue, so only its bumps are borrowed)
  const concrete = new THREE.MeshStandardMaterial({ color: '#7a6c5c', roughness: 0.95, normalMap: tex('wall_nor', 8, 3.5) });
  const wallMat = pbr('wall', 7, 1.2, { color: '#f2ece0' });
  const yardWall = new THREE.MeshStandardMaterial({ color: '#d9cdb8', roughness: 0.92, normalMap: tex('wall_nor', 9, 1) });
  const skirt = new THREE.MeshStandardMaterial({ color: '#7a3b2e', roughness: 0.8 });
  const ceiling = new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.95 });
  const metal = new THREE.MeshStandardMaterial({ color: '#2f3a44', roughness: 0.5, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1e2a33', roughness: 0.08, metalness: 0.2, envMapIntensity: 1.4 });
  const woodLight = pbr('wood', 1, 1, { color: '#f0d2ae' });
  const woodDark = pbr('board', 1.5, 1, { color: '#b98a62' });
  const doorWood = pbr('wood', 1, 2.2, { color: '#7a4a2a' });
  const pot = new THREE.MeshStandardMaterial({ color: '#9b4a2c', roughness: 0.85 });
  const leaf = new THREE.MeshStandardMaterial({ color: '#3f6b2a', roughness: 0.7, side: THREE.DoubleSide });
  const zinc = new THREE.MeshStandardMaterial({ color: '#9aa3a8', roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide });

  // ── Ground: verandah tiles, courtyard concrete, the street outside ──
  const vw = VERANDAH.maxX - VERANDAH.minX;
  const vcx = (VERANDAH.minX + VERANDAH.maxX) / 2;
  add(new THREE.PlaneGeometry(vw, 4.5).rotateX(-Math.PI / 2), tiles, vcx, 0, 0.1, { cast: false });
  const yardD = YARD.front - VERANDAH.front;
  add(new THREE.PlaneGeometry(vw, yardD).rotateX(-Math.PI / 2), concrete, vcx, -0.002, VERANDAH.front + yardD / 2, { cast: false });
  // verandah edge kerb
  add(new THREE.BoxGeometry(vw, 0.06, 0.12), skirt, vcx, 0.03, VERANDAH.front + 0.12, { cast: false });
  // the street beyond the walls
  const street = new THREE.MeshStandardMaterial({ color: '#4a4540', roughness: 1 });
  add(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), street, vcx, -0.01, 20, { cast: false });

  // ── The house walls, ceiling and pillars ──
  add(new THREE.BoxGeometry(vw + 0.25, WALL_H, 0.25), wallMat, vcx, WALL_H / 2, VERANDAH.back);
  add(new THREE.BoxGeometry(vw + 0.25, 0.32, 0.26), skirt, vcx, 0.16, VERANDAH.back + 0.01, { cast: false });
  block(vcx, VERANDAH.back - 0.1, vw + 1, 0.5);
  for (const x of [VERANDAH.minX, VERANDAH.maxX]) {
    add(new THREE.BoxGeometry(0.25, WALL_H, 4.5), wallMat, x, WALL_H / 2, 0.05);
    add(new THREE.BoxGeometry(0.26, 0.32, 4.5), skirt, x + (x < 0 ? 0.01 : -0.01), 0.16, 0.05, { cast: false });
    block(x, 0.05, 0.5, 4.6);
  }
  add(new THREE.BoxGeometry(vw + 0.25, 0.12, 4.6), ceiling, vcx, WALL_H + 0.06, 0.05, { receive: false });
  add(new THREE.BoxGeometry(vw + 0.25, 0.35, 0.3), wallMat, vcx, WALL_H - 0.17, VERANDAH.front);
  for (const x of [-2.2, 1.2, 3.2, 7.2, 10.9, 14.25]) {
    add(new THREE.BoxGeometry(0.3, WALL_H, 0.3), wallMat, x, WALL_H / 2, VERANDAH.front);
    block(x, VERANDAH.front, 0.42, 0.42);
  }

  // windows with burglar-proof bars, and the doors into the house
  for (const wx of [-1.2, 5.0, 9.0, 12.7]) {
    add(new THREE.BoxGeometry(1.5, 1.2, 0.04), glass, wx, 1.65, -1.97, { cast: false });
    for (let i = 0; i <= 6; i++) add(new THREE.BoxGeometry(0.025, 1.24, 0.025), metal, wx - 0.75 + i * 0.25, 1.65, -1.93, { cast: false });
    for (const y of [1.05, 1.45, 1.85, 2.25]) add(new THREE.BoxGeometry(1.54, 0.025, 0.025), metal, wx, y, -1.93, { cast: false });
  }
  for (const dx of [1.6, 7.0]) {
    add(new THREE.BoxGeometry(1.0, 2.2, 0.06), doorWood, dx, 1.1, -1.96, { cast: false });
    add(new THREE.SphereGeometry(0.035, 12, 10), metal, dx - 0.38, 1.08, -1.91, { cast: false });
  }

  // potted plants
  for (const [px, pz] of [[-3.1, -1.6], [13.9, -1.6], [-3.1, 9.9], [13.9, 9.9], [3.6, 9.9], [7.0, 9.9]]) {
    add(new THREE.CylinderGeometry(0.22, 0.16, 0.42, 20), pot, px, 0.21, pz);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const l = add(new THREE.PlaneGeometry(0.16, 0.7), leaf, px + Math.cos(a) * 0.08, 0.75, pz + Math.sin(a) * 0.08);
      l.rotation.set(0.35 * Math.sin(a), a, 0.35 * Math.cos(a));
    }
    block(px, pz, 0.5, 0.5);
  }

  // ── Courtyard walls and the gate ──
  const yh = 2.0;
  const frontZ = YARD.front;
  for (const x of [YARD.minX, YARD.maxX]) {
    add(new THREE.BoxGeometry(0.25, yh, yardD), yardWall, x, yh / 2, VERANDAH.front + yardD / 2);
    block(x, VERANDAH.front + yardD / 2, 0.5, yardD + 0.4);
  }
  const leftLen = GATE.minX - YARD.minX;
  const rightLen = YARD.maxX - GATE.maxX;
  add(new THREE.BoxGeometry(leftLen, yh, 0.25), yardWall, YARD.minX + leftLen / 2, yh / 2, frontZ);
  add(new THREE.BoxGeometry(rightLen, yh, 0.25), yardWall, GATE.maxX + rightLen / 2, yh / 2, frontZ);
  block(vcx, frontZ + 0.15, vw + 1, 0.5); // the gateway is open, but you stay inside the joint
  // gate pillars and two half-open metal gates
  for (const gx of [GATE.minX - 0.15, GATE.maxX + 0.15]) add(new THREE.BoxGeometry(0.4, yh + 0.4, 0.4), yardWall, gx, (yh + 0.4) / 2, frontZ);
  const gateMat = new THREE.MeshStandardMaterial({ color: '#2d5c3a', roughness: 0.5, metalness: 0.5 });
  for (const [hx, dir] of [[GATE.minX, 1], [GATE.maxX, -1]]) {
    const leafG = new THREE.Group();
    leafG.position.set(hx, 0, frontZ);
    leafG.rotation.y = dir * -1.15;
    scene.add(leafG);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.7, 0.04), gateMat);
    panel.position.set(dir * 0.5, 0.95, 0);
    panel.castShadow = true;
    leafG.add(panel);
  }

  // the sign over the verandah, facing the courtyard as you walk in
  const signTex = canvasTexture(1024, 256, (g, w, h) => {
    g.fillStyle = '#1f4f37';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f2c14e';
    g.lineWidth = 10;
    g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#f2c14e';
    g.textAlign = 'center';
    g.font = 'bold 104px Georgia, serif';
    g.fillText("BABA'S JOINT", w / 2, 128);
    g.fillStyle = '#fffaf2';
    g.font = 'bold 40px Arial, sans-serif';
    g.fillText('AYO  •  DRAUGHTS  •  WHOT  •  LUDO  •  SNOOKER', w / 2, 200);
  });
  const sign = add(new THREE.BoxGeometry(4.2, 1.05, 0.06), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.7 }), 5.1, 2.62, VERANDAH.front + 0.2);
  sign.material = [metal, metal, metal, metal, sign.material, metal];

  // ── Helpers for the tables ──
  function stool(x, z, h = 0.46) {
    add(new THREE.CylinderGeometry(0.2, 0.19, 0.05, 24), woodLight, x, h - 0.025, z);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const leg = add(new THREE.CylinderGeometry(0.022, 0.026, h - 0.03, 8), woodLight, x + Math.cos(a) * 0.13, (h - 0.03) / 2, z + Math.sin(a) * 0.13);
      leg.rotation.set(Math.sin(a) * -0.12, 0, Math.cos(a) * 0.12);
    }
    block(x, z, 0.44, 0.44);
  }
  function lantern(x, y, z) {
    const g = new THREE.Group();
    occluders.push(g);
    g.position.set(x, y, z);
    scene.add(g);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, WALL_H - y - 0.1, 6), metal);
    wire.position.y = (WALL_H - y) / 2 + 0.05;
    const glow = new THREE.MeshStandardMaterial({ color: '#fff2d8', emissive: '#ffb35c', emissiveIntensity: 0, transparent: true, opacity: 0.75, roughness: 0.1 });
    glowMats.push(glow);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 16), glow);
    globe.scale.y = 1.25;
    g.add(wire, globe);
    for (const cy of [0.085, -0.085]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.03, 16), metal);
      c.position.y = cy;
      g.add(c);
    }
    // (no light of its own: every extra light slows the shaders a lot, so one shared light
    // lights all the verandah tables at night)
  }

  // ── Draughts table: a square board, 10×10, pieces set out ──
  const DRAUGHTS = new THREE.Vector3(5.0, 0, 0);
  {
    const top = 0.62;
    add(new THREE.BoxGeometry(0.66, 0.04, 0.66), woodLight, DRAUGHTS.x, top - 0.02, DRAUGHTS.z);
    for (const [lx, lz] of [[-0.29, -0.29], [0.29, -0.29], [-0.29, 0.29], [0.29, 0.29]]) {
      add(new THREE.BoxGeometry(0.045, top - 0.04, 0.045), woodLight, DRAUGHTS.x + lx, (top - 0.04) / 2, DRAUGHTS.z + lz);
    }
    const boardTex = canvasTexture(512, 512, (g, w) => {
      const s = w / 10;
      for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
        g.fillStyle = (r + c) % 2 ? '#5b3a22' : '#e8cfa3';
        g.fillRect(c * s, r * s, s, s);
      }
    });
    const size = 0.46;
    add(new THREE.BoxGeometry(size + 0.04, 0.03, size + 0.04), woodDark, DRAUGHTS.x, top + 0.015, DRAUGHTS.z);
    add(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.5 }), DRAUGHTS.x, top + 0.031, DRAUGHTS.z, { cast: false });
    // (the pieces belong to the draughts game, in draughtsTable.js)
    tables.draughts = { center: DRAUGHTS.clone(), top: top + 0.031, size };
    block(DRAUGHTS.x, DRAUGHTS.z, 0.7, 0.7);
    stool(DRAUGHTS.x, DRAUGHTS.z + 0.72);
    stool(DRAUGHTS.x, DRAUGHTS.z - 0.72);
    lantern(DRAUGHTS.x + 0.3, 1.72, DRAUGHTS.z);
  }

  // ── Whot table: round, four stools, cards in play ──
  const WHOT = new THREE.Vector3(9.0, 0, 0);
  {
    const top = 0.62;
    add(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 32), woodLight, WHOT.x, top - 0.02, WHOT.z);
    add(new THREE.CylinderGeometry(0.05, 0.07, top - 0.04, 12), woodLight, WHOT.x, (top - 0.04) / 2, WHOT.z);
    add(new THREE.CylinderGeometry(0.25, 0.25, 0.03, 24), woodLight, WHOT.x, 0.015, WHOT.z);
    // (the cards belong to the Whot game, in whotTable.js)
    tables.whot = { center: WHOT.clone(), top };
    block(WHOT.x, WHOT.z, 0.95, 0.95);
    stool(WHOT.x, WHOT.z + 0.82);
    stool(WHOT.x, WHOT.z - 0.82);
    stool(WHOT.x - 0.82, WHOT.z);
    stool(WHOT.x + 0.82, WHOT.z);
    lantern(WHOT.x + 0.3, 1.72, WHOT.z);
  }

  // ── Ludo table: square, a printed board and dice ──
  const LUDO = new THREE.Vector3(12.6, 0, 0);
  {
    const top = 0.62;
    add(new THREE.BoxGeometry(0.76, 0.04, 0.76), woodLight, LUDO.x, top - 0.02, LUDO.z);
    for (const [lx, lz] of [[-0.34, -0.34], [0.34, -0.34], [-0.34, 0.34], [0.34, 0.34]]) {
      add(new THREE.BoxGeometry(0.045, top - 0.04, 0.045), woodLight, LUDO.x + lx, (top - 0.04) / 2, LUDO.z + lz);
    }
    const ludoTex = canvasTexture(600, 600, (g, w) => {
      const s = w / 15;
      g.fillStyle = '#fbf6ec';
      g.fillRect(0, 0, w, w);
      const homes = [['#d63031', 0, 0], ['#00a65a', 9, 0], ['#f5b700', 9, 9], ['#1e6fd9', 0, 9]];
      for (const [col, cx, cy] of homes) {
        g.fillStyle = col;
        g.fillRect(cx * s, cy * s, 6 * s, 6 * s);
        g.fillStyle = '#fbf6ec';
        g.fillRect((cx + 1) * s, (cy + 1) * s, 4 * s, 4 * s);
        g.fillStyle = col;
        for (const [ox, oy] of [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]]) {
          g.beginPath();
          g.arc((cx + ox + 0.5) * s, (cy + oy + 0.5) * s, s * 0.55, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.strokeStyle = '#3a3a3a';
      g.lineWidth = 2;
      for (let i = 0; i < 15; i++) for (let j = 0; j < 15; j++) {
        const inCross = (i >= 6 && i < 9) || (j >= 6 && j < 9);
        if (inCross && !(i >= 6 && i < 9 && j >= 6 && j < 9)) g.strokeRect(i * s, j * s, s, s);
      }
      // home stretches
      g.fillStyle = '#d63031'; for (let i = 1; i < 6; i++) g.fillRect(i * s, 7 * s, s, s);
      g.fillStyle = '#00a65a'; for (let j = 1; j < 6; j++) g.fillRect(7 * s, j * s, s, s);
      g.fillStyle = '#f5b700'; for (let i = 9; i < 14; i++) g.fillRect(i * s, 7 * s, s, s);
      g.fillStyle = '#1e6fd9'; for (let j = 9; j < 14; j++) g.fillRect(7 * s, j * s, s, s);
      // centre triangles
      const c = 7.5 * s;
      for (const [col, a] of [['#d63031', Math.PI], ['#00a65a', -Math.PI / 2], ['#f5b700', 0], ['#1e6fd9', Math.PI / 2]]) {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(c, c);
        g.lineTo(c + Math.cos(a - Math.PI / 4) * 1.5 * s * Math.SQRT2, c + Math.sin(a - Math.PI / 4) * 1.5 * s * Math.SQRT2);
        g.lineTo(c + Math.cos(a + Math.PI / 4) * 1.5 * s * Math.SQRT2, c + Math.sin(a + Math.PI / 4) * 1.5 * s * Math.SQRT2);
        g.fill();
      }
    });
    add(new THREE.BoxGeometry(0.52, 0.012, 0.52), woodDark, LUDO.x, top + 0.006, LUDO.z);
    add(new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: ludoTex, roughness: 0.6 }), LUDO.x, top + 0.013, LUDO.z, { cast: false });
    // (the tokens and die belong to the Ludo game, in ludoTable.js)
    tables.ludo = { center: LUDO.clone(), top: top + 0.013, size: 0.5 };
    block(LUDO.x, LUDO.z, 0.8, 0.8);
    stool(LUDO.x, LUDO.z + 0.8);
    stool(LUDO.x, LUDO.z - 0.8);
    stool(LUDO.x - 0.8, LUDO.z);
    stool(LUDO.x + 0.8, LUDO.z);
    lantern(LUDO.x + 0.3, 1.72, LUDO.z);
  }

  // ── Snooker under a zinc canopy in the courtyard ──
  const SNOOKER = new THREE.Vector3(9.4, 0, 6.4);
  {
    const L = 2.6;
    const W = 1.4;
    const h = 0.82;
    const felt = new THREE.MeshStandardMaterial({ color: '#1f7a4a', roughness: 0.9 });
    add(new THREE.BoxGeometry(L, 0.06, W), felt, SNOOKER.x, h - 0.03, SNOOKER.z);
    for (const [cx, cz, w, d] of [[0, W / 2 + 0.05, L + 0.2, 0.1], [0, -W / 2 - 0.05, L + 0.2, 0.1], [L / 2 + 0.05, 0, 0.1, W], [-L / 2 - 0.05, 0, 0.1, W]]) {
      add(new THREE.BoxGeometry(w, 0.1, d), woodDark, SNOOKER.x + cx, h + 0.02, SNOOKER.z + cz);
    }
    add(new THREE.BoxGeometry(L + 0.1, 0.22, W + 0.1), woodDark, SNOOKER.x, h - 0.17, SNOOKER.z);
    for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
      add(new THREE.BoxGeometry(0.12, h - 0.28, 0.12), woodDark, SNOOKER.x + lx * (L / 2 - 0.1), (h - 0.28) / 2, SNOOKER.z + lz * (W / 2 - 0.1));
    }
    const pocket = new THREE.MeshStandardMaterial({ color: '#0d0d0d', roughness: 1 });
    for (const px of [-1, 0, 1]) for (const pz of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16), pocket, SNOOKER.x + px * (L / 2 - 0.02), h + 0.002, SNOOKER.z + pz * (W / 2 - 0.02), { cast: false });
    }
    // (the balls and cue belong to the snooker game, in snookerTable.js)
    tables.snooker = { center: SNOOKER.clone(), top: h, L, W };
    block(SNOOKER.x, SNOOKER.z, L + 0.3, W + 0.3);
    // canopy: four poles and a corrugated zinc roof
    for (const px of [-1, 1]) for (const pz of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 10), metal, SNOOKER.x + px * 2.0, 1.3, SNOOKER.z + pz * 1.55);
      block(SNOOKER.x + px * 2.0, SNOOKER.z + pz * 1.55, 0.2, 0.2);
    }
    const roof = new THREE.PlaneGeometry(4.4, 3.5, 44, 1);
    const p = roof.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 28) * 0.02);
    roof.computeVertexNormals();
    const r = add(roof, zinc, SNOOKER.x, 2.62, SNOOKER.z);
    r.rotation.x = -Math.PI / 2 + 0.08;
    // a bare bulb over the table at night
    const bulbGlow = new THREE.MeshStandardMaterial({ color: '#fff7e0', emissive: '#ffdc8a', emissiveIntensity: 0 });
    glowMats.push(bulbGlow);
    add(new THREE.SphereGeometry(0.05, 14, 12), bulbGlow, SNOOKER.x, 2.25, SNOOKER.z, { cast: false });
    const bulb = new THREE.PointLight('#ffd98a', 2.2, 7, 1.4);
    bulb.position.set(SNOOKER.x, 2.2, SNOOKER.z);
    nightLights.push(bulb);
  }

  // ── Table football in the courtyard ──
  const FOOS = new THREE.Vector3(3.2, 0, 6.6);
  {
    const L = 1.2;
    const W = 0.7;
    const h = 0.86;
    // an open cabinet: the pitch sits 12 cm down inside four walls
    const body = new THREE.MeshStandardMaterial({ color: '#2b3a67', roughness: 0.6 });
    const pitchY = h - 0.12;
    const wallT = 0.04;
    add(new THREE.BoxGeometry(L, 0.18, W), body, FOOS.x, pitchY - 0.09, FOOS.z); // underside
    add(new THREE.BoxGeometry(L - 2 * wallT, 0.004, W - 2 * wallT), new THREE.MeshStandardMaterial({ color: '#1f8a4c', roughness: 0.8 }), FOOS.x, pitchY + 0.002, FOOS.z, { cast: false });
    for (const e of [-1, 1]) {
      add(new THREE.BoxGeometry(L, 0.12, wallT), body, FOOS.x, pitchY + 0.06, FOOS.z + e * (W / 2 - wallT / 2)); // long sides
      // end walls with a goal mouth in the middle
      const sideLen = (W - 2 * wallT - 0.2) / 2;
      for (const s of [-1, 1]) {
        add(new THREE.BoxGeometry(wallT, 0.12, sideLen), body, FOOS.x + e * (L / 2 - wallT / 2), pitchY + 0.06, FOOS.z + s * (0.1 + sideLen / 2));
      }
      add(new THREE.BoxGeometry(wallT, 0.06, 0.2), body, FOOS.x + e * (L / 2 - wallT / 2), pitchY + 0.09, FOOS.z); // crossbar
    }
    const line = new THREE.MeshBasicMaterial({ color: '#e8f5e9' });
    add(new THREE.BoxGeometry(0.004, 0.001, W - 2 * wallT), line, FOOS.x, pitchY + 0.005, FOOS.z, { cast: false, receive: false });
    add(new THREE.RingGeometry(0.07, 0.074, 32).rotateX(-Math.PI / 2), line, FOOS.x, pitchY + 0.005, FOOS.z, { cast: false, receive: false });
    for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
      add(new THREE.BoxGeometry(0.07, pitchY - 0.18, 0.07), body, FOOS.x + lx * (L / 2 - 0.05), (pitchY - 0.18) / 2, FOOS.z + lz * (W / 2 - 0.05));
    }
    // (the rods, players and ball belong to the table-football game, in foosballTable.js)
    tables.foosball = { center: FOOS.clone(), top: pitchY + 0.004, L: L - 2 * wallT, W: W - 2 * wallT, rodY: h - 0.02, goalW: 0.2 };
    block(FOOS.x, FOOS.z, L + 0.2, W + 0.5);
  }

  // one warm light for the draughts, Whot and Ludo tables
  const verandahLight = new THREE.PointLight('#ffb35c', 3.2, 9, 1.1);
  verandahLight.position.set(8.8, 1.75, 0.3);
  nightLights.push(verandahLight);

  // Lights are only added to the scene at night. (The time of day is set once at load, so the
  // shaders are only ever built for one set of lights.)
  function setNight(night) {
    for (const l of nightLights) {
      if (night) scene.add(l);
      else scene.remove(l);
    }
    for (const m of glowMats) m.emissiveIntensity = night ? 2.5 : 0;
  }

  // The tables you can walk up to. `seat` is where your character sits (facing `face`);
  // `approach` is where you stand to sit down.
  const stations = [
    { id: 'ayo', name: 'Ayo', host: 'Baba', ready: true,
      approach: new THREE.Vector3(0, 0, 1.35), seat: new THREE.Vector3(0, 0, 0.72), face: Math.PI },
    { id: 'draughts', name: 'Draughts', host: 'Tunde the barber', ready: false,
      approach: new THREE.Vector3(DRAUGHTS.x, 0, 1.35), seat: new THREE.Vector3(DRAUGHTS.x, 0, 0.72), face: Math.PI },
    { id: 'whot', name: 'Whot', host: 'Iya Bisi and friends', ready: false,
      approach: new THREE.Vector3(WHOT.x, 0, 1.45), seat: new THREE.Vector3(WHOT.x, 0, 0.82), face: Math.PI },
    { id: 'ludo', name: 'Ludo', host: 'Kemi and Tobi', ready: false,
      approach: new THREE.Vector3(LUDO.x, 0, 1.45), seat: new THREE.Vector3(LUDO.x, 0, 0.8), face: Math.PI },
    { id: 'snooker', name: 'Snooker', host: 'Emeka', ready: false, standing: true,
      approach: new THREE.Vector3(SNOOKER.x - 0.4, 0, SNOOKER.z + 1.25), seat: new THREE.Vector3(SNOOKER.x - 0.4, 0, SNOOKER.z + 1.0), face: Math.PI },
    { id: 'foosball', name: 'Table football', host: 'Chidi', ready: false, standing: true,
      approach: new THREE.Vector3(FOOS.x, 0, FOOS.z + 0.95), seat: new THREE.Vector3(FOOS.x, 0, FOOS.z + 0.7), face: Math.PI },
  ];

  // The regulars who sit (or stand) at the other tables.
  const regulars = [
    { name: 'Tunde', station: 'draughts', pos: new THREE.Vector3(DRAUGHTS.x, 0, -0.72), face: 0,
      style: { body: 'male', primaryColor: '#f4f4f2', secondaryColor: '#3b3f4a', skinColor: '#6b4226', hairColor: '#111111', hair: 'short', hat: 'none', accessory: 'none' } },
    { name: 'Iya Bisi', station: 'whot', pos: new THREE.Vector3(WHOT.x, 0, -0.82), face: 0,
      style: { body: 'female', primaryColor: '#e1a120', secondaryColor: '#7a1f2b', skinColor: '#7a4a2a', hairColor: '#1a1410', hair: 'bun', hat: 'none', accessory: 'earrings' } },
    { name: 'Mama Ngozi', station: 'whot', pos: new THREE.Vector3(WHOT.x - 0.82, 0, 0), face: Math.PI / 2,
      style: { body: 'female', primaryColor: '#b0263c', secondaryColor: '#2b2f4a', skinColor: '#5c3a21', hairColor: '#1a1410', hair: 'braids', hat: 'none', accessory: 'glasses' } },
    { name: 'Uncle Femi', station: 'whot', pos: new THREE.Vector3(WHOT.x + 0.82, 0, 0), face: -Math.PI / 2,
      style: { body: 'male', primaryColor: '#2f7a4a', secondaryColor: '#2b2f4a', skinColor: '#8d5524', hairColor: '#2a2420', hair: 'short', hat: 'none', accessory: 'beard' } },
    { name: 'Kemi', station: 'ludo', pos: new THREE.Vector3(LUDO.x, 0, -0.8), face: 0, child: true,
      style: { body: 'female', primaryColor: '#ef6fa6', secondaryColor: '#5b2a86', skinColor: '#8d5524', hairColor: '#17120f', hair: 'ponytail', hat: 'none', accessory: 'none' } },
    { name: 'Tobi', station: 'ludo', pos: new THREE.Vector3(LUDO.x + 0.8, 0, 0), face: -Math.PI / 2, child: true,
      style: { body: 'male', primaryColor: '#1e6fd9', secondaryColor: '#e1a120', skinColor: '#6b4226', hairColor: '#17120f', hair: 'short', hat: 'cap', accessory: 'none' } },
    { name: 'Emeka', station: 'snooker', pos: new THREE.Vector3(SNOOKER.x + 0.9, 0, SNOOKER.z - 1.0), face: 0.3, standing: true,
      style: { body: 'male', primaryColor: '#1d1d22', secondaryColor: '#3a4a6b', skinColor: '#5c3a21', hairColor: '#0f0b08', hair: 'dreads', hat: 'none', accessory: 'none' } },
    { name: 'Chidi', station: 'foosball', pos: new THREE.Vector3(FOOS.x, 0, FOOS.z - 0.62), face: 0, standing: true,
      style: { body: 'male', primaryColor: '#f2f2f0', secondaryColor: '#1e3a6b', skinColor: '#7a4a2a', hairColor: '#17120f', hair: 'afro', hat: 'none', accessory: 'none' } },
  ];

  return { colliders, stations, regulars, setNight, occluders, tables };
}
