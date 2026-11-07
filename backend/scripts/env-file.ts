// Small helper so scripts can record IDs in backend/.env instead of asking you to paste them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');

/** Sets NAME=value in .env: replaces an existing (possibly empty) line, or appends one. */
export function setEnvVar(name: string, value: string): void {
  const text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const re = new RegExp(`^${name}\\s*=.*$`, 'm');
  const next = re.test(text) ? text.replace(re, `${name}=${value}`) : `${text}${text.endsWith('\n') || !text ? '' : '\n'}${name}=${value}\n`;
  fs.writeFileSync(ENV_PATH, next);
}
