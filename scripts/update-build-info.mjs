import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'web', 'src', 'generated');
const outPath = path.join(outDir, 'build-info.json');

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const commitHash = git('rev-parse --short=7 HEAD') ?? 'dev';
const commitDateIso = git('log -1 --format=%cI');
const commitDate = commitDateIso ? commitDateIso.slice(0, 10) : '';

const info = {
  version: pkg.version,
  commitHash,
  commitDate,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(info, null, 2)}\n`);
