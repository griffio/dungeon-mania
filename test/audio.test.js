import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { SPOKEN, NARRATION, BARK_IDS, SFX } from '../tools/audio-manifest.mjs';
import { quotes, hash, norm } from '../src/voice.js';
import * as N from '../src/narration.js';
import * as DATA from '../src/dungeon-data.js';
import * as SURFACE from '../src/surface-data.js';

// The spoken lines are found by the hash of their words, so a script edit that changes a line
// silently loses its recording. Every line in the manifest must still be said, word for word.
const SOURCES = ['src/scripts/npcs.js', 'src/oracle.js', 'src/scripts/odric.js', 'src/scripts/rooms.js', 'src/recruits.js', 'src/ending.js', 'src/game.js']
  .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\\'/g, "'")).join('\n');

test('every recorded line is still in the scripts, word for word', () => {
  const said = new Set(quotes(SOURCES).map((q) => hash(q)));
  // the statues' couplets are quoted from arrays, not inline
  const missing = SPOKEN.filter(([, text]) => !said.has(hash(text)) && !SOURCES.includes(norm(text)));
  assert.deepEqual(missing.map(([who, t]) => `${who}: ${t}`), []);
});

test('the narration covers every room, and nothing that is not a room', () => {
  const rooms = new Set([...DATA.ROOMS, ...SURFACE.ROOMS].map((r) => String(r.id)));
  for (const id of Object.keys(N.ROOMS)) assert.ok(rooms.has(id), `narration for unknown room ${id}`);
  const unnarrated = DATA.ROOMS.filter((r) => !r.passage && !N.ROOMS[r.id] && r.id !== '18').map((r) => r.id);
  assert.deepEqual(unnarrated, []);
});

test('the audio manifest lists only files that exist, and ids are unique', () => {
  const dir = new URL('../assets/audio/', import.meta.url);
  const ids = [...NARRATION.map((n) => n[0]), ...BARK_IDS.map((b) => b[0]), ...SFX.map((s) => s[0])];
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  if (!existsSync(dir)) return;
  const listed = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
  const files = new Set(readdirSync(dir).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)));
  assert.deepEqual(listed.filter((id) => !files.has(id)), []);
});
