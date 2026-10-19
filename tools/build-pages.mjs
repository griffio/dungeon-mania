// The site for Cloudflare Pages: just what the browser loads (index.html, src/, assets/, and the
// oracle's question rules in worker/src/, which src/oracle.js shares), copied into dist/. Nothing
// else in the project (tools, tests, .env, caches) is published. Every relative import in the
// copied scripts must resolve inside dist/, or the build fails (Pages would serve the HTML page
// in its place).
import { cp, rm, mkdir, readdir, readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url), out = new URL('dist/', root);
await rm(out, { recursive: true, force: true });
await mkdir(out);
for (const p of ['index.html', 'src', 'assets', 'worker/src']) await cp(new URL(p, root), new URL(p, out), { recursive: true, filter: (src) => !src.endsWith('.DS_Store') });

const dist = fileURLToPath(out), missing = [];
for (const f of await readdir(dist, { recursive: true })) {
  if (!f.endsWith('.js')) continue;
  for (const [, spec] of (await readFile(join(dist, f), 'utf8')).matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = resolve(dirname(join(dist, f)), spec);
    if (!target.startsWith(dist) || !await access(target).then(() => true, () => false)) missing.push(`${f} -> ${spec}`);
  }
}
if (missing.length) { console.error(`imports missing from dist/:\n  ${missing.join('\n  ')}`); process.exit(1); }
console.log('dist/ ready');
