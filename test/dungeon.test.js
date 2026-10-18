import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dungeon, T, TILE } from '../src/dungeon.js';

const d = new Dungeon();
const at = (x, y) => d.idx(x, y);
const anchor = (id) => d.idx(...d.byId[id].at);
// Everything a party could eventually do: find every secret door, carry Odric's keys,
// climb through pits and use the tunnel between 9 and 18.
const ALL = { secrets: true, keys: new Set(['odric']), pits: true, links: true };

test('map is a closed rectangle of known glyphs', () => {
  assert.equal(d.W, 52);
  assert.equal(d.H, 34);
  for (let x = 0; x < d.W; x++) for (const y of [0, d.H - 1]) assert.equal(d.at(x, y), T.ROCK, `edge ${x},${y}`);
  for (let y = 0; y < d.H; y++) for (const x of [0, d.W - 1]) assert.equal(d.at(x, y), T.ROCK, `edge ${x},${y}`);
});

test('every room has tiles inside its box', () => {
  for (const r of d.rooms) {
    assert.ok(r.tiles.length > 0, r.id);
    for (const i of r.tiles) {
      const [x, y] = d.xy(i);
      assert.ok(x >= r.box[0] && y >= r.box[1] && x <= r.box[2] && y <= r.box[3], `${r.id} tile ${x},${y}`);
    }
  }
  for (const id of [...Array.from({ length: 23 }, (_, k) => String(k + 1)), '9a']) assert.ok(d.byId[id], `room ${id}`);
});

test('doors sit in walls, with a way through on two opposite sides', () => {
  for (const door of d.doors.values()) {
    const [x, y] = d.xy(door.i);
    const open = (dx, dy) => TILE[d.at(x + dx, y + dy)].walk;
    assert.ok((open(0, -1) && open(0, 1)) || (open(-1, 0) && open(1, 0)), `door at ${x},${y}`);
    for (const [dx, dy] of [[1, 0], [0, 1]]) assert.ok(!TILE[d.at(x + dx, y + dy)].door, `doors side by side at ${x},${y}`);
  }
});

test('every room can be reached from the entrance', () => {
  const { dist } = d.search(d.start, ALL);
  for (const r of d.rooms) assert.ok(dist[anchor(r.id)] < Infinity, `room ${r.id}`);
});

test('every reachable room has a way back out', () => {
  for (const r of d.rooms) assert.ok(d.pathTo(anchor(r.id), d.start, ALL), `room ${r.id}`);
});

test('at least two routes lead to room 23: no single door cuts it off', () => {
  const goal = anchor('23');
  for (const door of d.doors.keys()) {
    const [x, y] = d.xy(door);
    assert.ok(d.pathTo(d.start, goal, { ...ALL, ignore: new Set([door]) }), `blocking the door at ${x},${y}`);
  }
});

test("Odric's keys are reachable without them, and only room 14 and the cells need them", () => {
  const noKeys = { ...ALL, keys: new Set() };
  const { dist } = d.search(d.start, noKeys);
  assert.ok(dist[anchor('12')] < Infinity, 'Odric (room 12)');
  for (const r of d.rooms) if (r.id !== '14') assert.ok(dist[anchor(r.id)] < Infinity, `room ${r.id}`);
  assert.equal(dist[anchor('14')], Infinity, 'room 14 is locked');
  assert.equal(dist[at(3, 9)], Infinity, 'south-west cell is locked');
});

test('room 21 is a one-way trap unless its secret door is found', () => {
  const inside = at(30, 30), corridor = at(34, 28);
  assert.ok(d.pathTo(corridor, inside, { pits: true }), 'the block door opens from the corridor');
  assert.equal(d.pathTo(inside, corridor, { pits: true, links: true }), null, 'but not from inside');
  assert.ok(d.pathTo(inside, d.start, ALL), 'the west secret door gets you out');
});

test('the pit at 18 blocks a careful walker, and the 9-18 tunnel is a link', () => {
  assert.equal(d.t[at(29, 23)], T.PIT);
  const west = at(27, 23), east = at(30, 23);
  const careful = d.pathTo(west, east, {});
  assert.ok(careful, 'there is a way round, through the lower corridor');
  assert.ok(!careful.tiles.includes(at(29, 23)));
  assert.ok(careful.cost > 3);
  // without secret doors or climbing through room 3's pit, the tunnel is the only way down
  assert.equal(d.pathTo(anchor('9'), anchor('18'), {}), null);
  const viaTunnel = d.pathTo(anchor('9'), anchor('18'), { links: true });
  const walking = d.pathTo(anchor('9'), anchor('18'), { secrets: true, pits: true });
  assert.ok(viaTunnel.cost < walking.cost, 'the tunnel is the short way down');
});

// A small hand-made map for the movement and sight rules.
const tiny = new Dungeon({
  MAP: `
#######
#..#..#
#..+..#
#.#####
#..=..#
#######
`,
  ROOMS: [], DOORS: [], LINKS: [], PROPS: [], START: [1, 1],
});

const tilesOf = (p) => p.tiles.map((i) => tiny.xy(i));

test('diagonal steps cost 1.5 and never cut a corner', () => {
  assert.equal(tiny.pathTo(tiny.idx(1, 1), tiny.idx(2, 2)).cost, 1.5);
  // 2,2 -> 1,3 would clip the wall at 2,3, so the path goes round it
  const corner = tiny.pathTo(tiny.idx(2, 2), tiny.idx(1, 4));
  assert.deepEqual(tilesOf(corner), [[2, 2], [1, 2], [1, 3], [1, 4]]);
  assert.equal(corner.cost, 3);
});

test('a closed door costs an extra point to open and is entered straight on', () => {
  const p = tiny.pathTo(tiny.idx(2, 1), tiny.idx(4, 1));
  assert.deepEqual(tilesOf(p), [[2, 1], [2, 2], [3, 2], [4, 2], [4, 1]]);
  assert.equal(p.cost, 5);
  assert.equal(tiny.pathTo(tiny.idx(2, 1), tiny.idx(4, 1), { closed: false }), null, 'not if doors must stay shut');
});

test('sight: rock and closed doors block, bars and open doors do not', () => {
  assert.ok(tiny.los(1, 1, 2, 2));
  assert.ok(tiny.los(1, 1, 1, 4));
  assert.ok(!tiny.los(2, 1, 4, 1), 'rock between');
  assert.ok(!tiny.los(2, 2, 4, 2), 'closed door');
  assert.ok(tiny.los(2, 4, 4, 4), 'bars');
  const door = tiny.doors.get(tiny.idx(3, 2));
  door.open = true;
  assert.ok(tiny.los(2, 2, 4, 2), 'open door');
  door.open = false;
});

test('light: reach and line of sight, stopped by rock and closed doors', () => {
  const lit = tiny.light([{ x: 1.5, z: 1.5, reach: 6 }]);
  assert.equal(lit[tiny.idx(2, 2)], 1);
  assert.equal(lit[tiny.idx(3, 2)], 1, 'the door itself is lit');
  assert.equal(lit[tiny.idx(4, 2)], 0, 'not past the closed door');
  assert.equal(lit[tiny.idx(4, 1)], 0, 'not through rock');
  assert.equal(lit[tiny.idx(3, 1)], 0, 'rock is never "lit"');
  assert.equal(tiny.light([{ x: 1.5, z: 1.5, reach: 1 }])[tiny.idx(1, 3)], 0, 'beyond reach');
});

test('sight: lit tiles in view, the dark only next to you, and the walls around what you see', () => {
  const eye = tiny.idx(1, 1);
  const seen = tiny.sight(eye, tiny.light([{ x: 1.5, z: 1.5, reach: 6 }]));
  assert.equal(seen[tiny.idx(1, 4)], 1);
  assert.equal(seen[tiny.idx(4, 2)], 0, 'behind the closed door');
  assert.equal(seen[tiny.idx(0, 0)], 1, 'the wall beside a seen tile');
  assert.equal(seen[tiny.idx(4, 1)], 0, 'rock next to nothing seen');
  const dark = tiny.sight(eye, new Uint8Array(tiny.n));
  assert.equal(dark[tiny.idx(2, 2)], 1, 'next to you, even unlit');
  assert.equal(dark[tiny.idx(1, 3)], 0, 'two tiles away in the dark');
});

test('paths can be limited to known tiles', () => {
  const known = new Uint8Array(tiny.n).fill(1);
  assert.ok(tiny.pathTo(tiny.idx(1, 1), tiny.idx(1, 4), { known }));
  known[tiny.idx(1, 3)] = 0;
  assert.equal(tiny.pathTo(tiny.idx(1, 1), tiny.idx(1, 4), { known }), null);
});
