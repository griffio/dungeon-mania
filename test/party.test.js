import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dungeon } from '../src/dungeon.js';
import { groupTargets } from '../src/party.js';

// A corridor running east along the top of a 3x3 room.
const d = new Dungeon({
  MAP: `
##########
#........#
######...#
######...#
######...#
##########
`,
  ROOMS: [{ id: '1', name: 'Room', at: [7, 3], box: [6, 2, 8, 4] }],
  DOORS: [], LINKS: [], PROPS: [], START: [1, 1],
});
const at = (x, y) => d.idx(x, y);
const xy = (list) => list.map((i) => d.xy(i));

test('in a corridor the party follows the leader in single file', () => {
  const chain = [at(4, 1), at(3, 1), at(2, 1), at(1, 1)];
  const path = [at(4, 1), at(5, 1), at(6, 1), at(7, 1)];
  assert.deepEqual(xy(groupTargets(d, path, chain)), [[7, 1], [6, 1], [5, 1], [4, 1]]);
});

test('a short step pulls the old line along behind the leader', () => {
  const chain = [at(4, 1), at(3, 1), at(2, 1), at(1, 1)];
  assert.deepEqual(xy(groupTargets(d, [at(4, 1), at(5, 1)], chain)), [[5, 1], [4, 1], [3, 1], [2, 1]]);
});

test('in a room the party closes up into a 2x2 block behind the leader', () => {
  const chain = [at(6, 2), at(6, 1), at(5, 1), at(4, 1)];
  // the leader walks south from 6,2 to 6,4
  const t = xy(groupTargets(d, [at(6, 2), at(6, 3), at(6, 4)], chain));
  assert.deepEqual(t[0], [6, 4]);
  assert.deepEqual(new Set(t.map(String)).size, 4, 'four different tiles');
  for (const [x, y] of t) assert.ok(x >= 6 && x <= 8 && y >= 2 && y <= 4, `${x},${y} is in the room`);
  assert.deepEqual(t[2], [6, 3], 'the third member is straight behind the leader');
});

test('no block where the room has no space for it: the snake is kept', () => {
  const chain = [at(6, 2), at(6, 1), at(5, 1), at(4, 1)];
  const blocked = new Set([at(7, 4), at(5, 4), at(7, 3), at(5, 3)]);
  const t = xy(groupTargets(d, [at(6, 2), at(6, 3), at(6, 4)], chain, (i) => !blocked.has(i)));
  assert.deepEqual(t, [[6, 4], [6, 3], [6, 2], [6, 1]]);
});
