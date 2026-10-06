import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmp(prefix = 'wpx-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
export function read(...p) {
  return fs.readFileSync(path.join(...p), 'utf8');
}
export function exists(...p) {
  return fs.existsSync(path.join(...p));
}
