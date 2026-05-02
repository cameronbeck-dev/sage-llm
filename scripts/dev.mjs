import { createRequire } from 'module';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function run(name, cmd, args, cwd) {
  const colors = { server: '\x1b[36m', client: '\x1b[33m' };
  const reset = '\x1b[0m';
  const color = colors[name] ?? '\x1b[35m';

  const proc = spawn(cmd, args, {
    cwd,
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  proc.stdout.on('data', (data) => {
    process.stdout.write(`${color}[${name}]${reset} ${data}`);
  });

  proc.stderr.on('data', (data) => {
    process.stderr.write(`${color}[${name}]${reset} ${data}`);
  });

  proc.on('close', (code) => {
    if (code !== 0) {
      console.error(`${color}[${name}]${reset} exited with code ${code}`);
      process.exit(code ?? 1);
    }
  });

  return proc;
}

const serverDir = path.join(root, 'packages', 'server');
const clientDir = path.join(root, 'packages', 'client');

run('server', 'npx', ['tsx', 'watch', 'src/index.ts'], serverDir);
run('client', 'npx', ['vite'], clientDir);
