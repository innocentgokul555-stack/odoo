// Starts the API (port 4000) and the website (port 5173) together, with coloured prefixes.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parts = [['api', 'backend', '\x1b[36m'], ['web', 'frontend', '\x1b[35m']];
let stopping = false;

const children = parts.map(([name, dir, color]) => {
  const child = spawn('npm', ['run', 'dev'], { cwd: path.join(root, dir), shell: true, env: process.env });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) out.write(`${prefix}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!stopping) {
      console.log(`${prefix}stopped (exit code ${code}). Stopping everything.`);
      stop(code || 0);
    }
  });
  return child;
});

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) { try { c.kill(); } catch (e) { /* already gone */ } }
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

console.log('\n  Starting the Odoo subscription system...');
console.log('  Open  http://localhost:5173  in your browser once both parts say they are ready.');
console.log('  Press Ctrl+C to stop.\n');
