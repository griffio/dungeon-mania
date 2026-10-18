import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { T } from '../src/dungeon.js';
import { SCRIPTS } from '../src/scripts/rooms.js';
import { foeTurn } from '../src/ai.js';
import * as traps from '../src/traps.js';

// Set pieces from M4, checked on the real game: the party is put where the scene happens.
const ui = { update() {}, viewKey: null };
function inDungeon(seed, tiles) {
  const g = new Game({ ui, seed });
  g.useLevel('dungeon', tiles);
  g.explored.fill(1);
  return g;
}
const at = (g, x, y) => g.dungeon.idx(x, y);
const xy = (g, i) => g.dungeon.xy(i).join(',');

test('broken goblins run out of the far door, round through 18 over the pit, and back to the near door', () => {
  // the party in the doorway the goblins' room was entered by (26,23), and just outside it
  const g = inDungeon(1, [[25, 23], [27, 23], [28, 23], [28, 22]]);
  const d = g.dungeon, near = d.doors.get(at(g, 26, 23)), far = d.doors.get(at(g, 26, 25));
  near.open = true;
  assert.equal(SCRIPTS.goblins.broke(g), true);
  const gob = g.foes.find((f) => f.group === 'goblins' && f.state === 'looping');
  assert.ok(gob, 'they run');
  const path = gob.loop;
  assert.ok(path.includes(far.i), 'out through the far door');
  assert.ok(path.includes(at(g, 29, 23)), 'over the covered pit at 18');
  assert.equal(xy(g, path[path.length - 1]), '27,23', 'back at the corridor outside the door they were attacked through');
  assert.ok(!path.slice(path.indexOf(far.i) + 1).some((i) => d.roomOf(i)?.id === '19'), 'not back through their own room');
});

test('a covered pit looks like floor until someone falls in, and the pole finds it first', () => {
  const g = inDungeon(2, [[27, 23], [27, 24], [27, 25], [28, 25]]);
  const pit = at(g, 29, 23), m = g.member(g.order[0]), hp = m.hp;
  assert.ok(g.hiddenTrapAt(pit));
  const plan = g.plan(at(g, 30, 23));
  assert.ok(plan.path.includes(pit), 'the planner walks straight over it');
  traps.onEnter(g, m, at(g, 28, 23), pit);
  assert.ok(!g.hiddenTrapAt(pit), 'found now');
  assert.ok(m.hp < hp, 'the faller is hurt');
  // the pole: a fresh game, probing, stops short of the pit and reveals it
  const h = inDungeon(2, [[27, 23], [27, 24], [27, 25], [28, 25]]);
  h.probing = true;
  const path = traps.probe(h, h.plan(at(h, 30, 23)).path);
  assert.ok(!path.includes(pit), 'stops before it');
  assert.ok(!h.hiddenTrapAt(pit), 'and it is found');
});

test('the green slime drops on whoever passes under it; six rounds, or fire', () => {
  const g = inDungeon(3, [[27, 9], [27, 8], [27, 7], [27, 6]]);
  const m = g.member(g.order[0]), slime = g.foes.find((f) => f.kind === 'slime');
  traps.onEnter(g, m, at(g, 27, 9), at(g, 27, 10));
  assert.equal(slime.on, m);
  assert.equal(m.status.slimed, 6);
  assert.equal(g.mode, 'encounter');
  // ordinary weapons don't touch it
  assert.equal(g.planAttack(g.member(g.order[1]), slime).ok, false);
  // five rounds of eating...
  for (let k = 0; k < 5; k++) traps.slimeRound(g);
  assert.equal(m.status.slimed, 1);
  assert.equal(m.dead, false);
  // ...then fire: burn until it's gone (the victim takes half of each burn)
  const bearer = g.member(g.order[1]);
  bearer.light = 'torch';
  for (let k = 0; k < 10 && slime.alive; k++) { bearer.acted = false; traps.burn(g, bearer, slime, 'torch'); }
  assert.equal(slime.alive, false);
  assert.equal(m.status.slimed, undefined, 'freed');
});

test('Sleep drops goblins, and a sleeping goblin dies to one blow', () => {
  const g = inDungeon(4, [[25, 23], [27, 23], [28, 23], [28, 22]]);
  const ys = g.member('ysolde'), goblins = g.foes.filter((f) => f.group === 'goblins');
  g.dungeon.doors.get(at(g, 26, 23)).open = true; // the way into their room
  g.updateWalls(); g.updateSight();
  g.startEncounter('goblins', { partySurprised: false, foesSurprised: false });
  g.casting = { caster: ys, spell: 'sleep' };
  g.castAt(goblins[0].tile);
  const asleep = goblins.filter((f) => f.status.asleep);
  assert.ok(asleep.length >= 1, 'at least one sleeps (2d8 HD against 1 HD goblins)');
  const plan = g.planAttack(g.member('brannoc'), asleep[0]);
  assert.equal(plan.helpless, true);
  assert.equal(plan.chance, 1);
  assert.equal(ys.memorised.includes('sleep'), false, 'the spell is spent');
});

test('Fennick hides in the dark and backstabs for double damage', () => {
  const g = inDungeon(5, [[25, 23], [27, 23], [28, 23], [28, 22]]);
  const f = g.member('fennick'), gob = g.foes.find((x) => x.group === 'goblins');
  f.status.hidden = true;
  // put him behind a goblin, in melee
  f.tile = at(g, 24, 23); gob.tile = at(g, 23, 23); gob.yaw = Math.PI / 2;
  const plan = g.planAttack(f, gob);
  assert.ok(plan.backstab);
  assert.ok(plan.mods.some((m) => m.label === 'Backstab' && m.value === 4));
});

test('Brannoc holds the line: a foe that steps next to him stops there', () => {
  const g = inDungeon(6, [[25, 24], [27, 23], [28, 23], [28, 22]]);
  const gob = g.foes.find((x) => x.group === 'goblins' && x.tile === at(g, 23, 23));
  // Ysolde further along the corridor is the nearest target past Brannoc
  g.member('brannoc').tile = at(g, 25, 23);
  g.member('ysolde').tile = at(g, 27, 23);
  gob.state = 'fighting';
  const plan = foeTurn(g, gob);
  const end = plan.route ? plan.route[plan.route.length - 1] : gob.tile;
  assert.ok(g.inMelee(end, g.member('brannoc').tile), 'it ends its move beside him');
});

test('pits: crossing one is a single climb, and a rope bridge makes it safe', () => {
  const g = inDungeon(7, [[29, 14], [28, 14], [27, 14], [27, 13]]);
  assert.equal(g.dungeon.t[at(g, 30, 14)], T.PIT);
  g.state.bridge = true;
  assert.ok(g.floorPits().has(at(g, 30, 14)), 'room 3 pits are walked like floor once bridged');
});
