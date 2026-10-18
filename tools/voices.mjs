// Lists the recorded voice lines in assets/audio/voice/ into voices.json, so the game knows
// which lines to play as recordings instead of babble. Run after adding or renaming files:
//   node tools/voices.mjs
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';

const dir = new URL('../assets/audio/voice/', import.meta.url);
mkdirSync(dir, { recursive: true });
const files = readdirSync(dir).filter((f) => /^[a-z0-9-]+__[a-z0-9-]+\.mp3$/.test(f)).sort();
const odd = readdirSync(dir).filter((f) => f.endsWith('.mp3') && !files.includes(f));
writeFileSync(new URL('voices.json', dir), JSON.stringify(files, null, 2) + '\n');
console.log(`${files.length} recorded line(s) listed in assets/audio/voice/voices.json`);
if (odd.length) console.log('Skipped (name should be who__line.mp3, lowercase with dashes):', odd.join(', '));
