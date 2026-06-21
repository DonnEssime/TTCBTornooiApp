import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hooksSrc = path.join(root, '.githooks');
const gitDir = path.join(root, '.git');
const hooksDst = path.join(gitDir, 'hooks');

if (!fs.existsSync(gitDir)) {
  console.log('install-git-hooks: no .git directory, skipping');
  process.exit(0);
}

const hookNames = ['post-commit', 'post-checkout', 'post-merge'];

for (const name of hookNames) {
  const src = path.join(hooksSrc, name);
  const dst = path.join(hooksDst, name);
  fs.copyFileSync(src, dst);
  try {
    fs.chmodSync(dst, 0o755);
  } catch {
    // Windows may ignore chmod; hook still runs via Git Bash.
  }
}

console.log(`install-git-hooks: installed ${hookNames.join(', ')}`);
