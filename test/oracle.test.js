import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { validate, couplet, NONSENSE, NOT_HOW } from '../worker/src/index.js';
import { offline, facts, CANNED, VAGUE } from '../src/oracle.js';
import { Game } from '../src/game.js';

// M7: the statue oracle (PLAN.md 8.2-8.3). The Worker is tested with a stand-in model, so these
// tests never touch the network.
const post = (path, body, origin = 'http://localhost:8080') => new Request(`http://oracle.test${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body),
});
const env = () => {
  const e = { calls: 0, AI: { run: async (model, input) => { e.calls++; e.last = input; return { response: 'Feed the lizard, sly and slow,\nand past his rock the sword will go.' }; } } };
  return e;
};

test('the book\'s rules: a How question of twelve words or fewer, or nonsense', () => {
  assert.equal(validate('How do we reach the sword?').q, 'How do we reach the sword?');
  assert.equal(validate('Where is the sword?').canned, NOT_HOW);
  assert.equal(validate('How on earth are we ever supposed to find our way out of here, really?').canned, NONSENSE);
  assert.equal(validate('   ').error, 'empty');
  assert.equal(couplet('"Line one here,"\n\n"line two there."'), 'Line one here, / line two there.');
  assert.equal(couplet('just one line'), null);
});

test('the Worker answers from the facts, lies when told, caches, and refuses strangers', async () => {
  const e = env();
  const body = { question: 'How do we pass the lizardman?', truthful: false, facts: ['A lizardman guards the sword.'], session: 'a' };
  const r1 = await (await worker.fetch(post('/api/oracle', body), e)).json();
  assert.equal(r1.answer, 'Feed the lizard, sly and slow, / and past his rock the sword will go.');
  assert.match(e.last.messages[1].content, /TRUTHFUL: no/);
  assert.match(e.last.messages[1].content, /A lizardman guards the sword/);
  const r2 = await (await worker.fetch(post('/api/oracle', body), e)).json();
  assert.equal(r2.cached, true);
  assert.equal(e.calls, 1, 'the second ask cost nothing');
  const bad = await worker.fetch(post('/api/oracle', body, 'https://elsewhere.example'), e);
  assert.equal(bad.status, 403);
  // behind Pages Functions the game's own page asks: same origin, always allowed
  const own = await worker.fetch(post('/api/oracle', body, 'http://oracle.test'), e);
  assert.equal(own.status, 200);
  const canned = await (await worker.fetch(post('/api/oracle', { question: 'Why?' }), e)).json();
  assert.equal(canned.answer, NOT_HOW);
  const noVoice = await worker.fetch(post('/api/tts', { text: 'Hello.' }), e);
  assert.equal(noVoice.status, 503, 'no voice key: no voice');
});

test('the Worker rate-limits one caller', async () => {
  const e = env();
  let last;
  for (let k = 0; k < 22; k++) last = await worker.fetch(post('/api/oracle', { question: `How do we win, take ${k}?`, session: 'flood' }), e);
  assert.equal(last.status, 429);
});

test('offline, the oracle still answers: true or false by keyword, vague otherwise', () => {
  assert.equal(offline('how do we reach the sword', true), CANNED[0][1]);
  assert.equal(offline('how do we reach the sword', false), CANNED[0][2]);
  assert.equal(offline('how do we free the prisoners', true), CANNED[2][1]);
  assert.equal(offline('how high is the moon', true), VAGUE);
});

test('the fact sheet follows the game: the sword, the keys, the secret door', () => {
  const g = new Game({ ui: { update() {} }, seed: 1 });
  let f = facts(g).join('\n');
  assert.match(f, /behind a rock in the flooded storeroom/);
  assert.match(f, /Odric, the high priest, wears the iron keys/);
  assert.match(f, /secret door in its west wall/);
  g.state.sword = 'brannoc'; g.keys.add('odric');
  f = facts(g).join('\n');
  assert.match(f, /The sword has been taken/);
  assert.match(f, /carries Odric's keys/);
  assert.ok(facts(g).length <= 30, 'within what the Worker accepts');
});
