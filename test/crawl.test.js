import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawl } from './bot.js';
import { tally } from '../src/ending.js';

// M5: a complete crawl from the surface to the sword and back out (PLAN.md 10). The bot plays
// every room's denizens, people and treasure, takes the sword, and leaves by one of the exits.
test('a complete crawl: surface, every room, the sword, and back out', { timeout: 600000 }, async () => {
  for (const seed of [1, 2, 3]) {
    const g = await crawl(seed);
    const t = tally(g, 'left');
    const note = `seed ${seed}: ${t.rows.map(([a, b]) => `${a}: ${b}`).join('; ')}`;
    assert.equal(g.mode, 'over', `seed ${seed}: the adventure ends (${g.log.slice(-3).map((e) => e.text).join(' / ')})`);
    assert.ok(g.state.sword, `${note}: the sword was taken`);
    assert.equal(g.L.id, 'surface', `${note}: and carried out`);
    assert.ok(t.survivors > 0, `${note}: somebody lived`);
  }
});
