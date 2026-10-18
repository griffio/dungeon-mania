import { test } from 'node:test';
import assert from 'node:assert/strict';
import { die, roll, mod, inSix, percent, doorChance, searchChance, minutesFor, clockText } from '../src/rules.js';
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
