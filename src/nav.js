import * as THREE from 'three';

// ── Getting around the joint: a walk grid with A* paths, the mini-map and the table signs ──

// A grid over the floor; a cell is blocked when a person standing there would touch a collider.
export function makeGrid(colliders, bounds, cell = 0.2, radius = 0.3) {
  const nx = Math.ceil((bounds.maxX - bounds.minX) / cell);
  const nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
  const blocked = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = bounds.minX + (i + 0.5) * cell;
      const z = bounds.minZ + (j + 0.5) * cell;
      for (const b of colliders) {
        const dx = x - THREE.MathUtils.clamp(x, b.minX, b.maxX);
        const dz = z - THREE.MathUtils.clamp(z, b.minZ, b.maxZ);
        if (dx * dx + dz * dz < radius * radius) { blocked[j * nx + i] = 1; break; }
      }
    }
  }
  return { cell, nx, nz, minX: bounds.minX, minZ: bounds.minZ, blocked };
}

const cellOf = (g, x, z) => [Math.floor((x - g.minX) / g.cell), Math.floor((z - g.minZ) / g.cell)];
const inside = (g, i, j) => i >= 0 && j >= 0 && i < g.nx && j < g.nz;
const free = (g, i, j) => inside(g, i, j) && !g.blocked[j * g.nx + i];
const centre = (g, i, j) => ({ x: g.minX + (i + 0.5) * g.cell, z: g.minZ + (j + 0.5) * g.cell });

// the nearest free cell to (i, j), searching outwards ring by ring
function nearestFree(g, i, j) {
  if (free(g, i, j)) return [i, j];
  for (let r = 1; r < 12; r++) {
    let best = null;
    let bestD = Infinity;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !free(g, i + di, j + dj)) continue;
        const d = di * di + dj * dj;
        if (d < bestD) { bestD = d; best = [i + di, j + dj]; }
      }
    }
    if (best) return best;
  }
  return null;
}

// can you walk straight from a to b? (samples the grid along the line)
function clearLine(g, a, b) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (g.cell * 0.5));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const [i, j] = cellOf(g, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    if (!free(g, i, j)) return false;
  }
  return true;
}

// A* over the grid (8 directions, no cutting corners), then pulled straight where the way is clear.
// Returns the points to walk through after `from`, ending exactly at `to`; null if there's no way.
export function findPath(g, from, to) {
  const s = nearestFree(g, ...cellOf(g, from.x, from.z));
  const e = nearestFree(g, ...cellOf(g, to.x, to.z));
  if (!s || !e) return null;
  const start = s[1] * g.nx + s[0];
  const goal = e[1] * g.nx + e[0];
  const n = g.nx * g.nz;
  const cost = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (k) => {
    const dx = Math.abs((k % g.nx) - e[0]);
    const dz = Math.abs(Math.floor(k / g.nx) - e[1]);
    return Math.max(dx, dz) + 0.41 * Math.min(dx, dz);
  };
  // a small binary heap of [f, key]
  const heap = [];
  const push = (f, k) => {
    heap.push([f, k]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  cost[start] = 0;
  push(h(start), start);
  while (heap.length) {
    const [, k] = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === goal) break;
    const i = k % g.nx;
    const j = Math.floor(k / g.nx);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (!free(g, ni, nj)) continue;
        if (di && dj && (!free(g, i + di, j) || !free(g, i, j + dj))) continue;
        const nk = nj * g.nx + ni;
        const c = cost[k] + (di && dj ? 1.414 : 1);
        if (c < cost[nk]) {
          cost[nk] = c;
          came[nk] = k;
          push(c + h(nk), nk);
        }
      }
    }
  }
  if (!closed[goal]) return null;
  const cells = [];
  for (let k = goal; k !== -1; k = came[k]) cells.push(centre(g, k % g.nx, Math.floor(k / g.nx)));
  cells.reverse();
  cells[cells.length - 1] = { x: to.x, z: to.z };
  // string pulling: from each point, jump to the furthest point you can walk to in a straight line
  const out = [];
  let at = { x: from.x, z: from.z };
  let k = 0;
  while (k < cells.length - 1) {
    let far = k;
    for (let m = cells.length - 1; m > k; m--) {
      if (clearLine(g, at, cells[m])) { far = m; break; }
    }
    if (far === k) far = k + 1;
    out.push(cells[far]);
    at = cells[far];
    k = far;
  }
  if (!out.length) out.push(cells[cells.length - 1]);
  return out;
}

// ── The trail of dots on the floor showing the way you're walking ──
// Only the part still ahead of you is shown, and the dots drift along it towards where you're going.
export function createPathLine(scene) {
  const MAX = 120;
  const GAP = 0.32;
  const dots = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.045, 14).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffd76a', transparent: true, opacity: 0, depthWrite: false }),
    MAX,
  );
  dots.frustumCulled = false;
  dots.renderOrder = 2;
  dots.count = 0;
  scene.add(dots);
  const m = new THREE.Matrix4();
  let phase = 0;
  return {
    show() { dots.material.opacity = 0.9; },
    hide() { dots.material.opacity = 0; dots.count = 0; },
    // pos: where you are; ahead: the points still to walk through (null once you've stopped)
    update(dt, pos, ahead) {
      if (!ahead) {
        dots.material.opacity = Math.max(0, dots.material.opacity - dt * 3);
        return;
      }
      phase = (phase + dt * 0.45) % GAP;
      let n = 0;
      let from = pos;
      let carry = GAP - phase; // distance to the first dot
      for (const to of ahead) {
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const len = Math.hypot(dx, dz);
        let d = carry;
        for (; d < len && n < MAX; d += GAP) {
          const t = d / len;
          // dots shrink near you, so they seem to come out from your feet
          const near = Math.min(1, (n * GAP + carry) / 0.6);
          m.makeScale(near, 1, near).setPosition(from.x + dx * t, 0.015, from.z + dz * t);
          dots.setMatrixAt(n++, m);
        }
        carry = d - len;
        from = to;
      }
      dots.count = n;
      dots.instanceMatrix.needsUpdate = true;
    },
  };
}

// ── Painted signs over the tables ──
export function makeSign(title, sub) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 176;
  const g = c.getContext('2d');
  // a wooden board with a painted border
  const wood = g.createLinearGradient(0, 0, 0, c.height);
  wood.addColorStop(0, '#6b4424');
  wood.addColorStop(1, '#4a2d17');
  g.fillStyle = wood;
  g.beginPath();
  g.roundRect(6, 6, c.width - 12, c.height - 12, 22);
  g.fill();
  g.strokeStyle = '#e8b54a';
  g.lineWidth = 7;
  g.beginPath();
  g.roundRect(20, 20, c.width - 40, c.height - 40, 14);
  g.stroke();
  g.textAlign = 'center';
  g.fillStyle = '#fff3d6';
  g.font = '800 64px system-ui, sans-serif';
  g.fillText(title, c.width / 2, 98);
  g.fillStyle = '#f3cf7a';
  g.font = '600 32px system-ui, sans-serif';
  g.fillText(sub, c.width / 2, 140);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(0.95, 0.95 * (c.height / c.width), 1);
  return sprite;
}

// ── The mini-map ──
// x runs left to right and z top to bottom, so the gate (where you come in) is at the bottom.
export function createMinimap(canvas, { colliders, stations, bounds, icons }) {
  const W = canvas.width;
  const H = canvas.height;
  const pad = 8;
  const scale = Math.min((W - pad * 2) / (bounds.maxX - bounds.minX), (H - pad * 2) / (bounds.maxZ - bounds.minZ));
  const ox = (W - (bounds.maxX - bounds.minX) * scale) / 2;
  const oz = (H - (bounds.maxZ - bounds.minZ) * scale) / 2;
  const toMap = (x, z) => [ox + (x - bounds.minX) * scale, oz + (z - bounds.minZ) * scale];
  const toWorld = (mx, mz) => ({ x: bounds.minX + (mx - ox) / scale, z: bounds.minZ + (mz - oz) / scale });

  // the floor plan doesn't change, so it's drawn once
  const base = document.createElement('canvas');
  base.width = W;
  base.height = H;
  const b = base.getContext('2d');
  b.fillStyle = 'rgba(214, 196, 160, 0.16)';
  const [vx0, vz0] = toMap(bounds.minX, bounds.minZ);
  const [vx1, vz1] = toMap(bounds.maxX, bounds.verandahFront);
  b.fillRect(vx0, vz0, vx1 - vx0, vz1 - vz0); // the verandah's tiled floor
  b.fillStyle = 'rgba(255, 240, 210, 0.42)';
  for (const c of colliders) {
    const [x0, z0] = toMap(c.minX, c.minZ);
    const [x1, z1] = toMap(c.maxX, c.maxZ);
    b.fillRect(x0, z0, Math.max(1.5, x1 - x0), Math.max(1.5, z1 - z0));
  }

  const spots = stations.map((s) => ({ s, at: toMap(s.centre.x, s.centre.z) }));
  const g = canvas.getContext('2d');
  return {
    draw(player, heading, target) {
      g.clearRect(0, 0, W, H);
      g.drawImage(base, 0, 0);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const { s, at } of spots) {
        g.fillStyle = target === s ? '#ffd76a' : 'rgba(43, 31, 22, 0.92)';
        g.strokeStyle = '#e8b54a';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(at[0], at[1], 10, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.font = '12px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
        g.fillStyle = '#fff';
        g.fillText(icons[s.id] ?? '•', at[0], at[1] + 1);
      }
      // you: a dot with an arrow for the way you're facing
      const [px, pz] = toMap(player.x, player.z);
      g.save();
      g.translate(px, pz);
      g.rotate(-heading + Math.PI);
      g.fillStyle = '#4fc3f7';
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(5, 5);
      g.lineTo(0, 2.5);
      g.lineTo(-5, 5);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    },
    // what a tap on the map points at: a table, or a spot on the floor
    pick(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const mx = (clientX - r.left) * (W / r.width);
      const mz = (clientY - r.top) * (H / r.height);
      const hit = spots.find(({ at }) => Math.hypot(at[0] - mx, at[1] - mz) < 13);
      return hit ? { station: hit.s } : { point: toWorld(mx, mz) };
    },
  };
}
