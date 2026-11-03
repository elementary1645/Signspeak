// Self-host the MediaPipe WASM runtime: copy it from the pinned npm package into
// public/ so the app never loads it from a CDN. Output is git-ignored.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const target = join(root, 'public', 'mediapipe', 'wasm');
if (!existsSync(source)) {
  console.warn('copy-wasm: @mediapipe/tasks-vision not installed yet; run npm install');
  process.exit(0);
}
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`copy-wasm: ${source} -> ${target}`);
