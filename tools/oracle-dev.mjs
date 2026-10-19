// Run the oracle's Worker (worker/src/index.js) locally on Node, with no wrangler and no
// dependencies (PLAN.md 8.2: until hosting is decided, it runs locally).
//   npm run oracle           -> http://localhost:8787
// The Worker's bindings are stood in for: env.AI calls Workers AI over the REST API with
// CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN, env.ELEVENLABS_API_KEY is the voice key, and
// env.CACHE is a folder (.oracle-cache/, gitignored). Keys come from the environment or .env (any
// letter case) and stay on this machine.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import worker from '../worker/src/index.js';

const root = new URL('..', import.meta.url);
const dotenv = {};
for (const line of (await readFile(new URL('.env', root), 'utf8').catch(() => '')).split('\n')) {
  const m = line.match(/^\s*([A-Za-z_]+)\s*=\s*(.+?)\s*$/);
  if (m) dotenv[m[1].toUpperCase()] = m[2].replace(/^['"]|['"]$/g, '');
}
const key = (name) => process.env[name] || dotenv[name];
const account = key('CLOUDFLARE_ACCOUNT_ID'), token = key('CLOUDFLARE_API_TOKEN');
if (!account || !token) { console.error('Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (environment or .env)'); process.exit(1); }

const cacheDir = new URL('.oracle-cache/', root);
await mkdir(cacheDir, { recursive: true });
const env = {
  ELEVENLABS_API_KEY: key('ELEVENLABS_API_KEY') || key('ELEVEN_LABS_API_KEY'),
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '',
  AI: {
    async run(model, input) {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      const out = await res.json();
      if (!out.success) throw new Error(JSON.stringify(out.errors).slice(0, 300));
      return out.result;
    },
  },
  CACHE: {
    async get(k, type) {
      const buf = await readFile(new URL(k.replace(/[^\w.-]/g, '_'), cacheDir)).catch(() => null);
      return buf === null ? null : type === 'arrayBuffer' ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf.toString('utf8');
    },
    async put(k, v) { await writeFile(new URL(k.replace(/[^\w.-]/g, '_'), cacheDir), typeof v === 'string' ? v : Buffer.from(v)); },
  },
};

const port = Number(process.env.PORT || 8787);
createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
  });
  try {
    const out = await worker.fetch(request, env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    console.log(req.method, req.url, out.status);
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'worker' }));
  }
}).listen(port, () => console.log(`Oracle on http://localhost:${port}`));
