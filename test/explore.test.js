import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explore } from './bot.js';

// M2 is done when the whole dungeon can be explored with no combat (PLAN.md 10).
test('the whole dungeon can be explored with no combat', { timeout: 120000 }, () => {
  for (const seed of [1, 2, 3]) {
    const g = explore(seed);
    const rooms = g.dungeon.rooms.filter((r) => !r.passage).map((r) => r.id);
    const missing = rooms.filter((id) => !g.visited.has(id));
    assert.deepEqual(missing, [], `seed ${seed}: rooms never entered (after ${Math.round(g.clock / 10)} turns)`);
    assert.equal(g.hidden().length, 0, `seed ${seed}: every secret door and the lever found`);
  }
});
