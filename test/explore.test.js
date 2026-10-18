import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explore } from './bot.js';

// M2: the whole dungeon can be explored (PLAN.md 10). Since M3 the party meets the orcs and the
// rats on the way and has to fight them.
test('the whole dungeon can be explored, fighting what it meets', { timeout: 300000 }, async () => {
  for (const seed of [1, 2, 3]) {
    const g = await explore(seed);
    const rooms = g.dungeon.rooms.filter((r) => !r.passage).map((r) => r.id);
    const missing = rooms.filter((id) => !g.visited.has(id));
    assert.deepEqual(missing, [], `seed ${seed}: rooms never entered (after ${Math.round(g.clock / 10)} turns)`);
    assert.equal(g.hidden().length, 0, `seed ${seed}: every secret door and the lever found`);
  }
});
