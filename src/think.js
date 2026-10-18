// Asks a game module's computer player for a move in a background worker; falls back to
// running it here if workers aren't available.
let worker = null;
let nextId = 1;
const waiting = new Map();
try {
  worker = new Worker(new URL('./aiWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const job = waiting.get(e.data.id);
    if (!job) return;
    waiting.delete(e.data.id);
    if (e.data.error) job.reject(new Error(e.data.error));
    else job.resolve(e.data.result);
  };
  worker.onerror = () => { worker = null; };
} catch {
  worker = null;
}

// think('./draughts.js', mod, 'chooseMove', [state, level]) → Promise of the result
export function think(path, mod, fn, args) {
  if (!worker) return Promise.resolve(mod[fn](...args));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, module: new URL(path, import.meta.url).href, fn, args });
  }).catch(() => mod[fn](...args)); // if the worker fails, think here instead
}
