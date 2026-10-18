// Runs a game's computer player off the main thread, so the table keeps animating while it
// thinks. Message: { id, module: './draughts.js', fn: 'chooseMove', args: [...] }.
self.onmessage = async (e) => {
  const { id, module, fn, args } = e.data;
  try {
    const mod = await import(module);
    self.postMessage({ id, result: mod[fn](...args) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
