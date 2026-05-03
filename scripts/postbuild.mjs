import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const src = path.join(root, 'packages', 'client', 'dist');
const dest = path.join(root, 'packages', 'server', 'dist', 'public');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (!fs.existsSync(src)) {
  console.error(`Client dist not found at ${src} — run client build first`);
  process.exit(1);
}

copyDir(src, dest);
console.log(`Copied client/dist → server/dist/public`);

const migrationsSrc = path.join(root, 'packages', 'server', 'src', 'db', 'migrations');
const migrationsDest = path.join(root, 'packages', 'server', 'dist', 'db', 'migrations');
copyDir(migrationsSrc, migrationsDest);
console.log(`Copied server/src/db/migrations → server/dist/db/migrations`);
