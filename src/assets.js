// Shared texture loading. Every texture and the sky go through one loading manager, so the page
// can show progress and wait until the whole game house is dressed before showing it.
import * as THREE from 'three';

export const manager = new THREE.LoadingManager();
let progress = () => {};
manager.onProgress = (url, loaded, total) => progress(loaded / total);
export function onLoadProgress(fn) {
  progress = fn;
}
export const allLoaded = new Promise((resolve) => { manager.onLoad = resolve; });

const loader = new THREE.TextureLoader(manager);
const cache = new Map();
export function tex(name, repeatX = 1, repeatY = repeatX, color = false) {
  // one download per file; each use gets its own repeat
  if (!cache.has(name)) cache.set(name, loader.load(`assets/${name}.webp`));
  const t = cache.get(name).clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  // (clones share the original's image source, so they update when it finishes loading)
  return t;
}
export function pbr(prefix, repeatX, repeatY, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map: tex(`${prefix}_diff`, repeatX, repeatY, true),
    normalMap: tex(`${prefix}_nor`, repeatX, repeatY),
    roughnessMap: tex(`${prefix}_rough`, repeatX, repeatY),
    ...extra,
  });
}
