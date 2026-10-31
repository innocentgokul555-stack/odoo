import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend');
let child;
let tmp;

export async function setup() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'odoo-ui-'));
  const env = { ...process.env, DB_PATH: path.join(tmp, 'ui-test.db'), PORT: '4021', BILLING_AUTORUN: 'false', NODE_ENV: 'test', DEMO_MODE: 'true' };
  execFileSync('node', ['src/seed/seed.js'], { cwd: backend, env, stdio: 'ignore' });
  child = spawn('node', ['src/server.js'], { cwd: backend, env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:4021/api/health'); if (r.ok) return; } catch (e) { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('The backend did not start for the UI tests');
}

export async function teardown() {
  if (child) child.kill();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
}
