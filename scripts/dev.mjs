import { createRequire } from 'module';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function resolveDocker() {
  const probe = spawnSync('docker', ['--version'], { shell: true, encoding: 'utf8' });
  if (!probe.error && probe.status === 0) return 'docker';

  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
      'C:\\Program Files\\Docker\\Docker\\resources\\docker.exe',
    ];
    const found = candidates.find((p) => existsSync(p));
    if (found) return found;
  }
  return null;
}

console.log('→ Starting SearXNG container...');
const dockerCmd = resolveDocker();

if (!dockerCmd) {
  console.warn(
    '⚠ Docker is not installed. Web search tools will be unavailable until you install it.\n' +
    '  On Windows:   winget install -e --id Docker.DockerDesktop\n' +
    '  On macOS:     brew install --cask docker\n' +
    '  On Linux:     see https://docs.docker.com/engine/install/\n' +
    '  After installing, launch Docker Desktop once (accept terms, let it initialise),\n' +
    '  then re-run `npm run dev`. Continuing with server + client only...'
  );
} else {
  const useShell = dockerCmd === 'docker';
  const searxng = spawnSync(dockerCmd, ['compose', 'up', '-d', 'searxng'], {
    cwd: root,
    shell: useShell,
    encoding: 'utf8',
  });
  if (searxng.error || searxng.status !== 0) {
    const stderr = (searxng.stderr || '').trim();
    const daemonDown = /docker_engine|cannot find the file|daemon|pipe/i.test(stderr);
    if (daemonDown) {
      console.warn(
        '⚠ Docker is installed but the daemon is not running yet.\n' +
        '  Launch Docker Desktop from the Start menu and wait until the tray icon shows "Docker Desktop is running",\n' +
        '  then re-run `npm run dev`. Continuing with server + client only...'
      );
    } else {
      console.warn(
        '⚠ Could not start the SearXNG container.\n' +
        (stderr ? `  ${stderr.split('\n').slice(0, 4).join('\n  ')}\n` : '') +
        '  Run `docker compose up -d searxng` manually to see the full error.\n' +
        '  Continuing with server + client only...'
      );
    }
  } else {
    console.log('✓ SearXNG ready');
  }
}

function run(name, cmd, args, cwd, opts = {}) {
  const colors = { server: '\x1b[36m', client: '\x1b[33m', worker: '\x1b[35m' };
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
      if (opts.optional) {
        console.warn(`${color}[${name}]${reset} exited with code ${code} (optional — leaving down)`);
        return;
      }
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
run('worker', 'npx', ['tsx', 'watch', 'src/jobs/worker.ts'], serverDir, { optional: true });
