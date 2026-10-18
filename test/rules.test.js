import { test } from 'node:test';
import assert from 'node:assert/strict';
import { die, roll, mod, inSix, percent, doorChance, searchChance, minutesFor, clockText, hitBase, attackRoll, hitChance, damage, moraleCheck, initiative, save, rangeMod, turnUndead, sleepTargets } from '../src/rules.js';
import { makeRng } from '../src/util.js';

test('dice stay in range and cover every face', () => {
  const rng = makeRng(7), seen = new Set();
  for (let k = 0; k < 600; k++) { const r = die(rng, 6); assert.ok(r >= 1 && r <= 6); seen.add(r); }
  assert.equal(seen.size, 6);
  for (let k = 0; k < 200; k++) { const r = roll(rng, '2d4+1'); assert.ok(r >= 3 && r <= 9); }
  assert.throws(() => roll(rng, 'two dice'));
});

test('B/X ability modifiers', () => {
  assert.deepEqual([3, 5, 8, 9, 12, 13, 16, 17, 18].map(mod), [-3, -2, -1, 0, 0, 1, 2, 2, 3]);
});

test('x-in-6 and percentile checks report the roll and the target', () => {
  const always = () => 0, never = () => 0.999;
  assert.deepEqual([inSix(always, 2).ok, inSix(never, 2).ok], [true, false]);
  assert.equal(inSix(always, 2).text, 'd6 1, needed 1–2');
  assert.equal(percent(always, 20).ok, true);
  assert.equal(percent(never, 20).ok, false);
});

test('doors open on 1-2, or 1-3 with a strength bonus', () => {
  assert.equal(doorChance(16), 3); // Brannoc
  assert.equal(doorChance(13), 3); // Aldwin, STR 13 is +1
  assert.equal(doorChance(10), 2);
});

test('repeated searches get easier, up to 5 in 6', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(searchChance), [1, 2, 3, 4, 5, 5, 5]);
});

test('the clock: 120 ft of walking is one 10-minute turn', () => {
  assert.equal(minutesFor(24), 10);
  assert.deepEqual(clockText(0), { turn: 1, time: '0:00' });
  assert.deepEqual(clockText(75), { turn: 8, time: '1:15' });
});

const fixed = (...vals) => { let k = 0; return () => vals[k++ % vals.length]; };
const d20 = (n) => (n - 1) / 20 + 0.001; // rng value that rolls n on a d20

test('the B/X attack matrix: level 1-3 and 1 HD need 19 - AC; bigger monsters need less', () => {
  assert.deepEqual([0.5, 1, 1.01, 2, 3, 4].map(hitBase), [19, 19, 18, 18, 17, 16]);
  assert.equal(attackRoll(fixed(d20(13)), 19, 6).hit, true, 'an orc (AC 6) is hit on 13');
  assert.equal(attackRoll(fixed(d20(12)), 19, 6).hit, false);
  assert.equal(attackRoll(fixed(d20(11)), 19, 6, [{ label: 'STR', value: 2 }]).hit, true, '+2 lowers the roll needed to 11');
  assert.equal(attackRoll(fixed(d20(20)), 19, -5).hit, true, 'a natural 20 always hits');
  assert.equal(attackRoll(fixed(d20(1)), 19, 9, [{ label: 'big', value: 30 }]).hit, false, 'a natural 1 always misses');
  assert.equal(hitChance(19, 6), 0.4);
  assert.equal(hitChance(19, 2), 0.05 * 4, 'AC 2 needs 17: 17-20 is 4 in 20');
});

test('damage is at least 1', () => {
  assert.equal(damage(() => 0, '1d6', -3), 1);
  assert.equal(damage(() => 0.999, '1d8', 1), 9);
});

test('morale breaks on 2d6 over ML, and ML 12 never breaks', () => {
  assert.equal(moraleCheck(() => 0.999, 8).broke, true, '12 > 8');
  assert.equal(moraleCheck(() => 0, 8).broke, false, '2 is not over 8');
  assert.equal(moraleCheck(() => 0.999, 12).broke, false);
});

test('initiative: the party wins ties', () => {
  assert.equal(initiative(fixed(0.5, 0.5)).partyFirst, true);
  assert.equal(initiative(fixed(0.1, 0.9)).partyFirst, false);
});

test('saving throws by class', () => {
  assert.equal(save(fixed(d20(12)), 'Fighter', 'poison').ok, true);
  assert.equal(save(fixed(d20(11)), 'Fighter', 'poison').ok, false);
  assert.equal(save(fixed(d20(13)), 'Magic-User', 'paralysis').ok, true);
});

test('missile range bands', () => {
  assert.deepEqual([3, 8, 12, 20, 40].map((d) => rangeMod(d, [8, 16, 32])), [1, 1, 0, -1, null]);
});

test('Turn Undead follows the B/X table for levels 1-3', () => {
  assert.equal(turnUndead(() => 0, 2, 'skeleton').ok, true, 'skeletons are turned at level 2');
  assert.equal(turnUndead(() => 0, 2, 'zombie').ok, false, '2d6 of 2 is under 7');
  assert.equal(turnUndead(() => 0.999, 2, 'zombie').ok, true, '12 beats 7');
  assert.equal(turnUndead(() => 0.999, 1, 'ghoul').need, 11);
  assert.equal(turnUndead(() => 0.999, 2, 'dragon').ok, false);
});

test('Sleep spends 2d8 hit dice on the smallest creatures first', () => {
  // 2d8 of 16: four 1 HD goblins and a 4+1 HD ogre (4.1 -> 5 dice): 4 + 5 = 9 fits
  assert.deepEqual(sleepTargets(() => 0.999, [1, 1, 4.1, 1, 1]).asleep.sort(), [0, 1, 2, 3, 4]);
  // 2d8 of 2: just two small ones
  assert.deepEqual(sleepTargets(() => 0, [1, 2, 1, 1]).asleep, [0, 2]);
  // nothing above 4+1 HD
  assert.deepEqual(sleepTargets(() => 0.999, [6]).asleep, []);
});
