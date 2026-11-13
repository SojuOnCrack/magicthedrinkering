import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

const roots = ['js', 'functions', 'scripts'];
const excluded = /(^|\\/)tracker(?:-[^/]+)?\\.js$/;
const files = [];

async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile() && path.endsWith('.js') && !excluded.test(path)) files.push(path);
  }
}

for (const root of roots) await collect(root);
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`\\n✗ ${relative(process.cwd(), file)}\\n${result.stderr || result.stdout}`);
  }
}
if (failed) process.exit(1);
console.log(`✓ Syntax check passed for ${files.length} JavaScript files (tracker excluded).`);
