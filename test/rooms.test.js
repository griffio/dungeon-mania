import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { T } from '../src/dungeon.js';
import { SCRIPTS } from '../src/scripts/rooms.js';
import { foeTurn } from '../src/ai.js';
import * as traps from '../src/traps.js';
import * as magic from '../src/magic.js';

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

// ---------- M5 ----------
import { SCRIPTS as S } from '../src/scripts/rooms.js';
import * as treasure from '../src/treasure.js';
import * as ending from '../src/ending.js';
const foeOf = (g, kind) => g.foes.find((f) => f.kind === kind);
const pickOption = (g, re) => { const k = g.dialogue.options.findIndex((o) => re.test(o.label)); assert.ok(k >= 0, `option ${re} in ${g.dialogue.options.map((o) => o.label)}`); g.choose(k); };

test('Belisarius: fed, he joins as a fifth hero, but never in the front rank', () => {
  const g = inDungeon(8, [[30, 3], [29, 4], [30, 4], [31, 4]]);
  const b = foeOf(g, 'belisarius');
  S.belisarius.open(g, g.scriptState.belisarius ||= {}, b);
  pickOption(g, /^Give him some food/);
  pickOption(g, /^Ask him to come/);
  pickOption(g, /^Welcome/);
  assert.equal(g.party.length, 5);
  assert.ok(g.member('belisarius'));
  assert.ok(!g.foes.includes(b), 'no longer a denizen');
  g.swapOrder('belisarius', g.order[0]);
  assert.equal(g.order[0], 'brannoc', 'he refuses to lead');
  assert.equal(g.order[4], 'belisarius');
});

test("Odric's rite: Rosa dies after three rounds unless someone is at his throat; beaten, he runs for his stairs", () => {
  const g = inDungeon(9, [[13, 13], [12, 13], [11, 13], [14, 13]]);
  const o = foeOf(g, 'odric'), rosa = foeOf(g, 'rosa'), s = g.scriptState.odric ||= {};
  S.odric.start(g, s, 'odric');
  assert.equal(s.timer, 3);
  assert.equal(o.state, 'ritual', 'Odric keeps to his rite');
  assert.equal(foeOf(g, 'gecko').state, 'chained');
  for (let k = 0; k < 3; k++) S.odric.round(g, s);
  assert.equal(rosa.alive, false, 'sacrificed');
  // a second chamber: someone beside him stops the knife
  const h = inDungeon(9, [[13, 15], [12, 13], [11, 13], [14, 13]]), s2 = h.scriptState.odric ||= {};
  S.odric.start(h, s2, 'skeletons');
  for (let k = 0; k < 5; k++) S.odric.round(h, s2);
  assert.ok(foeOf(h, 'rosa').alive, 'the rite waits while he fights');
  // hopeless: his skeletons gone, he slips the gecko and runs
  for (const f of h.foes.filter((x) => x.kind === 'skeleton')) { f.alive = false; f.dead = true; }
  S.odric.round(h, s2);
  const od = foeOf(h, 'odric');
  assert.equal(od.state, 'looping');
  assert.equal(foeOf(h, 'gecko').state, 'fighting', 'unchained');
  assert.equal(xy(h, od.loop[od.loop.length - 1]), '7,27', 'for the stairs in 15');
});

test("the ghoul's touch paralyses, and Cure Light Wounds frees", () => {
  const g = inDungeon(10, [[12, 8], [11, 8], [11, 7], [12, 7]]);
  const gh = foeOf(g, 'ghoul'), m = g.member('brannoc');
  g.rng = () => 0.01; // every save fails
  g.afflict(gh, m, gh.def.attacks[0]);
  assert.ok(m.status.paralysed > 0);
  assert.equal(g.canAct(m), false);
  assert.equal(g.planAttack(gh, m).helpless, true, 'and hit without fail');
  magic.heal(g, m, 1, 'test');
  assert.equal(m.status.paralysed, undefined);
});

test("the rockmen: both fists landing in one round turns flesh to stone, if the save fails", () => {
  const g = inDungeon(11, [[22, 8], [21, 8], [21, 9], [22, 9]]);
  const r = foeOf(g, 'rockman'), m = g.member('brannoc');
  g.rng = () => 0.01;
  g.afflict(r, m, r.def.attacks[0]);
  assert.equal(m.petrified, undefined, 'one fist is not enough');
  g.afflict(r, m, r.def.attacks[1]);
  assert.equal(m.petrified, true);
  assert.equal(m.dead, true, 'out of the mission');
});

test("room 14's chests: Odric's keys open them, chest 4's needle poisons, and the cure stops the clock", () => {
  const g = inDungeon(12, [[3, 12], [3, 11], [3, 13], [4, 12]]);
  g.keys.add('odric');
  const c4 = g.chests.find((c) => c.id === 'chest4');
  g.rng = () => 0.01;
  treasure.openChest(g, c4);
  const victim = g.party.find((m) => m.status.poisoned);
  assert.ok(victim, 'a needle got someone');
  assert.ok(Object.values(g.party).some((m) => m.items.scrollCure === 2), 'the scrolls');
  magic.heal(g, victim, 1, 'test');
  assert.equal(victim.status.poisoned, undefined);
  // uncured, ten turns later the victim is stricken
  const h = inDungeon(12, [[3, 12], [3, 11], [3, 13], [4, 12]]);
  h.keys.add('odric'); h.rng = () => 0.01;
  treasure.openChest(h, h.chests.find((c) => c.id === 'chest4'));
  const v = h.party.find((m) => m.status.poisoned);
  h.advance(100);
  assert.equal(v.status.stricken, true);
  assert.equal(h.canAct(v), false);
  // the false bottom: only a search of the opened chest finds the silver
  const c1 = h.chests.find((c) => c.id === 'chest1');
  treasure.openChest(h, c1);
  for (let k = 0; k < 20 && c1.hidden; k++) treasure.searchChests(h);
  assert.equal(c1.hidden, null);
  assert.ok(h.piles.some((p) => p.kind === 'sp' && p.n === 3000), '3,000 sp: a heap to think about');
});

test('the sliding block shuts six moves after it opens, and there is no handle inside', () => {
  const g = inDungeon(13, [[34, 29], [35, 29], [34, 28], [34, 30]]);
  const door = g.dungeon.doors.get(at(g, 33, 29)), s = g.scriptState.block ||= {};
  for (let k = 0; k < 20 && !door.open; k++) g.tryOpen(door.i); // stiff, like every door
  assert.equal(door.open, true, 'it opens from outside');
  assert.equal(s.left, 6);
  for (let k = 0; k < 6; k++) S.block.round(g, s);
  assert.equal(door.open, false);
});

test("the cells: a gate opened lets its prisoners follow, and the merchant pays when they're out", () => {
  const g = inDungeon(14, [[5, 8], [6, 8], [5, 9], [6, 9]]);
  g.keys.add('odric');
  const door = g.dungeon.doors.get(at(g, 5, 7));
  for (let k = 0; k < 20 && !door.open; k++) g.tryOpen(door.i);
  assert.equal(door.open, true);
  assert.equal(g.escort.count, 3);
  assert.ok(g.escort.merchant);
  assert.ok(g.followers.includes(g.escort));
  const before = g.purse.gp;
  ending.reachSurface(g);
  assert.equal(g.state.prisonersOut, 3);
  assert.equal(g.purse.gp, before + 50);
});

test('the lizardman takes food for the sword; it hums near Chaos; with Odric escaped, the dungeon is re-alerted', () => {
  const g = inDungeon(15, [[12, 29], [12, 30], [11, 29], [11, 30]]);
  const liz = foeOf(g, 'lizardman'), s = g.scriptState.lizardman ||= {};
  S.lizardman.open(g, s, liz);
  pickOption(g, /^Offer him food/);
  assert.ok(ending.swordFree(g));
  g.state.odric = 'escaped';
  ending.takeSword(g);
  assert.equal(g.member('brannoc').weapon.plus, 2);
  assert.ok(g.state.realerted);
  const orc = g.foes.find((f) => f.kind === 'orc' && f.alive);
  assert.equal(orc.state, 'alert', 'the survivors wait at the ways out');
  // a priest beside the wielder: the hum
  const pr = foeOf(g, 'kithar');
  Object.assign(pr, { tile: at(g, 14, 30), x: 14.5, z: 30.5 });
  const b = g.member('brannoc'); Object.assign(b, { tile: at(g, 12, 30), x: 12.5, z: 30.5 });
  assert.equal(ending.hum(g)?.foe, pr);
});

test('broken underpriests surrender, and can be bound', () => {
  const g = inDungeon(16, [[22, 18], [21, 18], [22, 19], [21, 19]]);
  assert.equal(S.priests.broke(g), true);
  const pr = g.foes.filter((f) => f.group === 'priests');
  assert.ok(pr.every((f) => f.state === 'surrendered'));
  const bind = S.priests.actions(g, g.scriptState.priests ||= {}).find((a) => a.id === 'bind');
  bind.run();
  assert.ok(pr.every((f) => f.state === 'bound'));
});

test("the Arch-deaconess, guided to room 21, takes her statue and goes", () => {
  const g = inDungeon(17, [[20, 10], [21, 10], [20, 11], [21, 11]]);
  g.visited.add('21');
  const f = foeOf(g, 'archdeaconess'), s = g.scriptState.deaconess ||= {};
  S.deaconess.open(g, s, f);
  pickOption(g, /^Tell her where it is/);
  pickOption(g, /^Guide her/);
  assert.equal(f.state, 'ally');
  assert.ok(g.followers.includes(f));
  Object.assign(f, { tile: at(g, 30, 29), x: 30.5, z: 29.5 });
  S.deaconess.step(g, s);
  assert.ok(g.state.statueGone);
  assert.equal(g.state.deaconess, 'guided');
});
