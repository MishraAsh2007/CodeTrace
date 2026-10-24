// Downloads Eclipse JDT Language Server into .tools/jdtls for editor features (completion, rename, quick fixes).
// Not needed when the VS Code Java extension (redhat.java) is installed; TraceLab finds its copy automatically.
// Usage: npm run setup:jdtls [-- --version 1.63.0] [-- --dry-run]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, run } from './env.mjs';

const args = process.argv.slice(2);
const version = args.includes('--version') ? args[args.indexOf('--version') + 1] : '1.63.0';
const dryRun = args.includes('--dry-run');
const base = `https://download.eclipse.org/jdtls/milestones/${version}`;
const target = join(root, '.tools/jdtls');

const text = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} returned ${r.status}`); return (await r.text()).trim(); };
const file = await text(`${base}/latest.txt`);
if (!/^jdt-language-server-[\w.-]+\.tar\.gz$/.test(file)) throw new Error(`Unexpected file name in latest.txt: ${file}`);
const expected = (await text(`${base}/${file}.sha256`)).split(/\s+/)[0].toLowerCase();
console.log(`Eclipse JDT LS ${version}: ${file} (sha256 ${expected.slice(0, 12)}…)`);
if (dryRun) {
  const head = await fetch(`${base}/${file}`, { method: 'HEAD' });
  console.log(`Download reachable: ${head.ok} (${head.headers.get('content-length') ?? '?'} bytes). Dry run, nothing written.`);
  process.exit(head.ok ? 0 : 1);
}
if (existsSync(join(target, 'plugins'))) { console.log(`Already installed in ${target}. Delete it to reinstall.`); process.exit(0); }
const response = await fetch(`${base}/${file}`);
if (!response.ok) throw new Error(`Download failed: ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
const actual = createHash('sha256').update(archive).digest('hex');
if (actual !== expected) throw new Error(`Checksum mismatch: expected ${expected}, got ${actual}. Nothing was installed.`);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const temp = join(target, file);
writeFileSync(temp, archive);
// tar ships with Windows 10+, macOS and Linux.
await run('tar', ['-xzf', temp, '-C', target], process.env);
rmSync(temp);
console.log(`Installed in ${target}. Restart TraceLab with npm start.`);
