import { chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(scriptDirectory, '../dist/index.js');

if (process.platform !== 'win32') {
  await chmod(entry, 0o755);
}
