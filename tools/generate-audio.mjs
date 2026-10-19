// Build-time audio with ElevenLabs (PLAN.md 8.1), from tools/audio-manifest.mjs. The key never
// ships to the browser.
//   node tools/generate-audio.mjs              generate anything missing
//   node tools/generate-audio.mjs --dry        count what would be generated, and the characters
//   node tools/generate-audio.mjs --only=sfx   just one kind: nar, vo, say, sfx (or an id prefix)
//   node tools/generate-audio.mjs --force      regenerate (with --only, just those)
// The key comes from ELEVENLABS_API_KEY, or ELEVENLABS_API_KEY / ELEVEN_LABS_API_KEY in .env (any
// letter case). Files go to assets/audio/<id>.mp3, and assets/audio/manifest.json lists what's
// ready, which is what the game loads. Idempotent: existing files are kept.
import { writeFile, access, mkdir, readFile, readdir } from 'node:fs/promises';
import { VOICES, DELIVERY, NARRATION, BARK_IDS, LINE_IDS, SFX } from './audio-manifest.mjs';

const fromEnvFile = async () => {
  const text = await readFile(new URL('../.env', import.meta.url), 'utf8').catch(() => '');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(ELEVENLABS_API_KEY|ELEVEN_LABS_API_KEY)\s*=\s*(.+?)\s*$/i);
    if (m) return m[2].replace(/^['"]|['"]$/g, '');
  }
  return null;
};
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}`))?.split('=')[1] ?? (process.argv.includes(`--${name}`) ? true : null);
const dry = !!arg('dry'), force = !!arg('force'), only = arg('only');
const KEY = process.env.ELEVENLABS_API_KEY || await fromEnvFile();
if (!KEY && !dry) { console.error('Set ELEVENLABS_API_KEY (or put it in .env)'); process.exit(1); }
const OUT = new URL('../assets/audio/', import.meta.url);
await mkdir(OUT, { recursive: true });

const exists = (p) => access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const msg = await res.text();
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
    throw new Error(`${res.status} ${msg.slice(0, 300)}`);
  }
  throw new Error('retries exhausted');
}

const speech = (id, who, text) => ({
  id, chars: text.length,
  url: `https://api.elevenlabs.io/v1/text-to-speech/${VOICES[who]}?output_format=mp3_44100_128`,
  body: { text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.4, ...DELIVERY[who] } },
});
const jobs = [
  ...NARRATION.map(([id, text]) => speech(id, 'narrator', text)),
  ...BARK_IDS.map(([id, who, text]) => speech(id, who, text)),
  ...LINE_IDS.map(([id, who, text]) => speech(id, who, text)),
  ...SFX.map(([id, text, duration, loop, influence]) => ({
    id, chars: 0, seconds: duration,
    url: 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128',
    body: { text, duration_seconds: duration, loop, prompt_influence: influence, model_id: 'eleven_text_to_sound_v2' },
  })),
].filter((j) => !only || j.id.startsWith(only === 'sfx' ? '' : only) && (only !== 'sfx' || SFX.some((s) => s[0] === j.id)));

const todo = [];
for (const j of jobs) if (force || !await exists(new URL(`${j.id}.mp3`, OUT))) todo.push(j);
const chars = todo.reduce((n, j) => n + j.chars, 0), secs = todo.reduce((n, j) => n + (j.seconds || 0), 0);
console.log(`${todo.length} to make: ${chars} characters of speech, ${secs.toFixed(0)} s of sound effects`);
if (dry) process.exit(0);

const failed = [];
let next = 0;
async function worker() {
  while (next < todo.length) {
    const job = todo[next++];
    try {
      await writeFile(new URL(`${job.id}.mp3`, OUT), await post(job.url, job.body));
      console.log('ok  ', job.id);
    } catch (e) {
      failed.push(job.id);
      console.log('FAIL', job.id, e.message);
      if (/quota|credits/i.test(e.message)) { next = todo.length; console.log('Out of credits: stopping.'); }
    }
  }
}
await Promise.all([worker(), worker(), worker()]);
// the manifest lists every file present, whatever made it
const ready = (await readdir(OUT)).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)).sort();
await writeFile(new URL('manifest.json', OUT), JSON.stringify(ready));
console.log(`\n${ready.length} files ready, ${failed.length} failed`, failed.join(' '));
