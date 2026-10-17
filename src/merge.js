// Merges meshes that never move relative to each other into one mesh per material. Every mesh
// is a separate draw call for the graphics card, so the house's hundreds of small props (and
// each character's dozens of parts) would otherwise make the game crawl.
import * as THREE from 'three';

// Bakes each mesh's transform relative to `root` into a copy of its geometry and joins them.
function joinGeometries(meshes, root) {
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts = meshes.map((m) => {
    m.updateWorldMatrix(true, false);
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone());
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    return g;
  });
  let count = 0;
  for (const g of parts) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += n;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

// Merges `meshes` (all children, at any depth, of `root`) into one mesh per material and
// shadow setting, added to `root`. Returns how many meshes it removed.
export function mergeInto(root, meshes) {
  root.updateWorldMatrix(true, true);
  const groups = new Map();
  for (const m of meshes) {
    if (Array.isArray(m.material)) continue;
    const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  let removed = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const merged = new THREE.Mesh(joinGeometries(list, root), list[0].material);
    merged.castShadow = list[0].castShadow;
    merged.receiveShadow = list[0].receiveShadow;
    root.add(merged);
    for (const m of list) {
      m.parent.remove(m);
      removed++;
    }
  }
  return removed;
}
