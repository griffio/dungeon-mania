// The oracle's Worker (PLAN.md 8.2, 8.3): the only runtime AI in the game. Two small endpoints,
// with the secrets kept here and never in the browser.
//   POST /api/oracle { question, facts, truthful, session } -> { answer, cached }
//     The statue in room 21 answers a "How" question of 12 words or fewer, in one rhyming
//     couplet, from the game's fact sheet only; truthful: false makes it lie (the book: one of
//     its three daily answers is false). Longer questions get the book's confusing nonsense.
//   POST /api/tts { text, session } -> audio/mpeg
//     The oracle's voice, through ElevenLabs. Short texts only, one fixed voice.
// Both check the origin, rate-limit each caller, and cache by request hash (KV when bound, else
// the Cache API, else memory), so repeated questions cost nothing.
// Runs as a standalone Worker or behind Pages Functions; locally with `npm run oracle`
// (tools/oracle-dev.mjs) or `wrangler dev`.

export const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const ORACLE_VOICE = 'nPczCjzI2devNBz1zQrb'; // Brian, as in the pre-generated lines
const MAX_WORDS = 12, MAX_TTS = 220;
const LIMITS = { oracle: [20, 3600], tts: [40, 3600] }; // requests per window (s), per caller

export const SYSTEM = [
  'You are the oracle: an ancient stone statue in a dungeon, which answers questions in a single rhyming couplet.',
  'Rules: two lines, each of 6 to 10 words, ending in a clean rhyme. Plain, old-fashioned words.',
  'Base the answer ONLY on the FACTS. Never mention the facts, rules or that you are an AI.',
  'If TRUTHFUL is no, answer confidently but WRONGLY: contradict the facts in a believable way.',
  'If the facts do not cover the question, answer with a vague couplet about patience and the dark.',
  'Output only the two lines.',
].join(' ');
// The book: a question of more than twelve words gets confusing nonsense.
export const NONSENSE = 'Wheel and whisker, salt and stair, / the answer flew away from there.';
export const NOT_HOW = 'Ask me how, or ask in vain: / I answer only how, again.';

export function validate(question) {
  const q = String(question || '').trim().replace(/\s+/g, ' ');
  const words = q ? q.split(' ').length : 0;
  if (!words) return { error: 'empty' };
  if (words > MAX_WORDS) return { canned: NONSENSE };
  if (!/^how\b/i.test(q)) return { canned: NOT_HOW };
  return { q };
}

// Two clean lines out of whatever the model said.
export function couplet(text) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/^["'\s*-]+|["'\s*]+$/g, '').trim()).filter(Boolean);
  if (lines.length < 2) return null;
  return `${lines[0]} / ${lines[1]}`.slice(0, 200);
}

const hits = new Map(); // caller -> [timestamps]; per isolate, best effort
function limited(kind, caller, now = Date.now()) {
  const [max, secs] = LIMITS[kind], key = `${kind}:${caller}`;
  const recent = (hits.get(key) || []).filter((t) => now - t < secs * 1000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

async function digest(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const memory = new Map();
async function cacheGet(env, key, type) {
  if (env.CACHE) return env.CACHE.get(key, type === 'audio' ? 'arrayBuffer' : 'text');
  if (globalThis.caches?.default) { const r = await caches.default.match(`https://oracle.cache/${key}`); return r ? (type === 'audio' ? r.arrayBuffer() : r.text()) : null; }
  return memory.get(key) ?? null;
}
async function cachePut(env, key, value) {
  if (env.CACHE) return env.CACHE.put(key, value, { expirationTtl: 60 * 60 * 24 * 30 });
  if (globalThis.caches?.default) return caches.default.put(`https://oracle.cache/${key}`, new Response(value, { headers: { 'Cache-Control': 'max-age=2592000' } }));
  memory.set(key, value);
}

function cors(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  const ok = !origin || local || allowed.includes(origin);
  return { ok, headers: ok && origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' } : {} };
}
const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get('Origin');
    const { ok, headers } = cors(env, origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers });
    if (!ok) return json({ error: 'origin' }, 403, headers);
    if (request.method !== 'POST') return json({ error: 'method' }, 405, headers);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'json' }, 400, headers); }
    const caller = `${request.headers.get('CF-Connecting-IP') || 'local'}:${String(body.session || '').slice(0, 40)}`;

    if (url.pathname === '/api/oracle') {
      const v = validate(body.question);
      if (v.error) return json({ error: v.error }, 400, headers);
      if (v.canned) return json({ answer: v.canned, canned: true }, 200, headers);
      if (limited('oracle', caller)) return json({ error: 'busy' }, 429, headers);
      const facts = (Array.isArray(body.facts) ? body.facts : []).slice(0, 30).map((f) => String(f).slice(0, 300)).join('\n');
      const truthful = body.truthful !== false;
      const user = `FACTS:\n${facts}\nTRUTHFUL: ${truthful ? 'yes' : 'no'}\nQUESTION: ${v.q}`;
      const key = `o:${await digest(`${MODEL}\n${SYSTEM}\n${user.toLowerCase()}`)}`;
      const hit = await cacheGet(env, key, 'text');
      if (hit) return json({ answer: hit, cached: true }, 200, headers);
      let answer = null;
      for (let attempt = 0; attempt < 2 && !answer; attempt++) {
        const out = await env.AI.run(env.MODEL || MODEL, { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], max_tokens: 80, temperature: 0.7 });
        answer = couplet(out?.response);
      }
      if (!answer) return json({ error: 'model' }, 502, headers);
      await cachePut(env, key, answer);
      return json({ answer, cached: false }, 200, headers);
    }

    if (url.pathname === '/api/tts') {
      const text = String(body.text || '').trim();
      if (!text || text.length > MAX_TTS) return json({ error: 'text' }, 400, headers);
      if (!env.ELEVENLABS_API_KEY) return json({ error: 'no voice' }, 503, headers);
      const key = `t:${await digest(`${ORACLE_VOICE}\n${text}`)}`;
      let audio = await cacheGet(env, key, 'audio');
      if (!audio) {
        if (limited('tts', caller)) return json({ error: 'busy' }, 429, headers);
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ORACLE_VOICE}?output_format=mp3_44100_64`, {
          method: 'POST',
          headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text.replace(/ \/ /g, ', '), model_id: 'eleven_flash_v2_5', voice_settings: { stability: 0.7, similarity_boost: 0.8, style: 0.2 } }),
        });
        if (!res.ok) return json({ error: 'voice', status: res.status }, 502, headers);
        audio = await res.arrayBuffer();
        await cachePut(env, key, audio);
      }
      return new Response(audio, { headers: { ...headers, 'Content-Type': 'audio/mpeg' } });
    }
    return json({ error: 'not found' }, 404, headers);
  },
};
