import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { snapshot, restore } from '../src/save.js';

// M8: save and load (PLAN.md 7.7). A restored game is the same game: the same state, and the same
// dice from then on.
const ui = { update() {}, viewKey: null };
function playSome(g) {
  g.useLevel('dungeon', g.levels.dungeon.data.PARTY_START); g.state.wentDown = true;
  g.lightTorch(g.member('ysolde'));
  g.foes.find((f) => f.kind === 'goblin').hp = 1;
  g.purse.gp = 12; g.keys.add('odric'); g.state.rosa = 'rescued';
  g.levels.dungeon.dungeon.doors.get(g.dungeon.idx(31, 14)).open = true;
  g.levels.dungeon.chests[0].opened = true;
  g.search();
  g.sightKey = ''; g.updateSight(); // as the next frame would
}
const strip = (s) => ({ ...s, saved: 0 });

test('a game saved and restored carries on exactly as it would have', () => {
  const g = new Game({ ui, seed: 11 });
  g.swarm = null; g.state.batsGone = true;
  playSome(g);
  g.mode = 'explore'; g.enc = null; g.swarm = null;
  const snap = snapshot(g);
  const json = JSON.parse(JSON.stringify(snap)); // as it would come back from storage
  const h = restore(json, { ui, prefs: null });
  assert.deepEqual(strip(snapshot(h)), strip(snap), 'the same state');
  assert.equal(h.L.id, 'dungeon');
  assert.equal(h.purse.gp, 12);
  assert.ok(h.keys.has('odric'));
  assert.equal(h.dungeon.doors.get(h.dungeon.idx(31, 14)).open, true);
  assert.equal(h.levels.dungeon.chests[0].opened, true);
  // the same dice from here on
  const rolls = (x) => Array.from({ length: 8 }, () => x.rng());
  assert.deepEqual(rolls(h), rolls(g));
  // and the same consequences
  g.search(); h.search();
  assert.deepEqual(strip(snapshot(h)), strip(snapshot(g)));
});

test('the difficulty is kept: a Classic party stays rolled', () => {
  const g = new Game({ ui, seed: 3, difficulty: 'classic' });
  const h = restore(JSON.parse(JSON.stringify(snapshot(g))), { ui, prefs: null });
  assert.equal(h.difficulty, 'classic');
  assert.equal(h.level, 1);
  assert.deepEqual(h.party.map((m) => m.maxHp), g.party.map((m) => m.maxHp));
});

test('wandering monsters: residents leave their posts, out of sight, and close in', async () => {
  const { spawn } = await import('../src/wanderers.js');
  const g = new Game({ ui, seed: 4, prefs: { wanderers: true, showDice: true } });
  g.useLevel('dungeon', g.levels.dungeon.data.PARTY_START);
  g.swarm = null; g.mode = 'explore';
  const who = spawn(g);
  assert.ok(who?.length, 'someone comes');
  for (const f of who) { assert.equal(f.state, 'wandering'); assert.equal(g.visible[f.tile], 0, 'unseen'); }
  const start = g.distTo(who[0].tile, g.leader.tile);
  g.advance(5);
  assert.ok(g.distTo(who[0].tile, g.leader.tile) < start || g.mode === 'encounter', 'closer');
});
