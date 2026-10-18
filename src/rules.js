// Pure rules (PLAN.md 3): dice and the checks exploration uses. Every roll returns what was
// rolled and what was needed, so the log can explain it.

// One die of n sides, 1..n.
export const die = (rng, n) => 1 + Math.floor(rng() * n);

// "NdM+K" -> total.
export function roll(rng, spec) {
  const m = /^(\d*)d(\d+)([+-]\d+)?$/.exec(spec);
  if (!m) throw new Error(`bad dice: ${spec}`);
  let t = Number(m[3] || 0);
  for (let k = 0; k < Number(m[1] || 1); k++) t += die(rng, Number(m[2]));
  return t;
}

// B/X ability modifier.
export function mod(score) {
  if (score <= 3) return -3;
  if (score <= 5) return -2;
  if (score <= 8) return -1;
  if (score <= 12) return 0;
  if (score <= 15) return 1;
  if (score <= 17) return 2;
  return 3;
}

// "x in 6": succeeds on a d6 roll of x or less.
export function inSix(rng, x) {
  const r = die(rng, 6);
  return { roll: r, need: x, ok: r <= x, text: `d6 ${r}, needed ${x <= 1 ? '1' : `1–${x}`}` };
}

// Percentile skill: succeeds on d100 at or under the chance.
export function percent(rng, chance) {
  const r = die(rng, 100);
  return { roll: r, need: chance, ok: r <= chance, text: `d100 ${r}, needed ${chance} or less` };
}

// Opening a door (PLAN.md 3.6): every door in Kollchap is stiff and opens on 1–2, or 1–3 with a
// strength bonus.
export const doorChance = (str) => (mod(str) > 0 ? 3 : 2);

// Searching for a secret door: 1 in 6, and each earlier search of the same door adds one, so
// nobody gets stuck (capped at 5 in 6).
export const searchChance = (earlier) => Math.min(5, 1 + earlier);

// Smashing a lock: certain, but each blow risks the weapon (room 14's rule, PLAN.md 3.6).
export const SMASH_BREAK = 20;

// Exploration time (PLAN.md 3.7): 120 ft of walking is one 10-minute turn. Path costs are in
// 5 ft tiles (difficult ground costs more), so a cost of 24 is one turn.
export const minutesFor = (cost) => (cost * 5 * 10) / 120;
export const TURN = 10;
// "Turn 3, 0:20": the clock as the HUD shows it.
export function clockText(minutes) {
  const turn = Math.floor(minutes / TURN) + 1, h = Math.floor(minutes / 60), m = Math.floor(minutes % 60);
  return { turn, time: `${h}:${String(m).padStart(2, '0')}` };
}

// ---------- combat (PLAN.md 3.3-3.4) ----------

// d20 roll needed to hit armour class `ac`, before modifiers. `base` is the attacker's row of the
// B/X attack matrix as "the roll that hits AC 0": 19 for characters of level 1-3 and monsters of
// up to 1 HD, 18 for 1+ to 2 HD, 17 for 2+ to 3, 16 for 3+ to 4.
export const hitBase = (hd) => (hd <= 1 ? 19 : hd <= 2 ? 18 : hd <= 3 ? 17 : 16);

// An attack. mods: [{ label, value }] added to the roll. A natural 20 always hits, a natural 1
// always misses. Returns the roll, what it needed, and the lines that explain it.
export function attackRoll(rng, base, ac, mods = []) {
  const bonus = mods.reduce((a, m) => a + m.value, 0), need = base - ac - bonus;
  const r = die(rng, 20);
  const hit = r === 20 || (r !== 1 && r >= need);
  return { roll: r, need: Math.max(2, Math.min(20, need)), hit, natural: r === 20 ? 20 : r === 1 ? 1 : 0 };
}
// The chance (0..1) an attack hits, for the panel's odds.
export function hitChance(base, ac, mods = []) {
  const need = Math.max(2, Math.min(20, base - ac - mods.reduce((a, m) => a + m.value, 0)));
  return (21 - need) / 20;
}

// Damage: never less than 1 on a hit.
export const damage = (rng, dice, bonus = 0) => Math.max(1, roll(rng, dice) + bonus);

// Morale: 2d6 against morale; over it, the group breaks. ML 12 never breaks.
export function moraleCheck(rng, ml) {
  if (ml >= 12) return { roll: 0, ml, broke: false, text: 'fearless' };
  const r = roll(rng, '2d6');
  return { roll: r, ml, broke: r > ml, text: `2d6 ${r} against morale ${ml}` };
}

// Surprise: each side is surprised on 1-2 on d6. Group initiative: d6 each, the party wins ties.
export const surprise = (rng) => inSix(rng, 2);
export function initiative(rng) {
  const party = die(rng, 6), foes = die(rng, 6);
  return { party, foes, partyFirst: party >= foes };
}

// Saving throws, B/X, for levels 1-3: [death/poison, wands, paralysis/stone, breath, spells].
export const SAVES = {
  Fighter: [12, 13, 14, 15, 16], Cleric: [11, 12, 14, 16, 15], 'Magic-User': [13, 14, 13, 16, 15],
  Thief: [13, 14, 13, 16, 15], NM: [14, 15, 16, 17, 18],
};
export const SAVE = { poison: 0, wands: 1, paralysis: 2, breath: 3, spells: 4 };
export function save(rng, cls, kind) {
  const need = (SAVES[cls] || SAVES.NM)[SAVE[kind]], r = die(rng, 20);
  return { roll: r, need, ok: r >= need, text: `save vs ${kind}: d20 ${r}, needed ${need}` };
}

// Missile range bands in tiles [short, medium, long]: +1 short, 0 medium, -1 long, beyond out of range.
export function rangeMod(dist, [s, m, l]) {
  if (dist <= s) return 1;
  if (dist <= m) return 0;
  if (dist <= l) return -1;
  return null;
}

// ---------- magic (PLAN.md 4) ----------

// Turn Undead, B/X, for clerics of level 1-3: the 2d6 roll needed, 'T' turned automatically,
// or null (can't be turned at this level).
export const TURN_TABLE = {
  1: { skeleton: 7, zombie: 9, ghoul: 11 },
  2: { skeleton: 'T', zombie: 7, ghoul: 9 },
  3: { skeleton: 'T', zombie: 'T', ghoul: 7 },
};
export function turnUndead(rng, level, kind) {
  const need = TURN_TABLE[level]?.[kind];
  if (need === undefined || need === null) return { ok: false, need: null, text: 'cannot be turned' };
  if (need === 'T') return { ok: true, need: 'T', roll: 0, text: 'turned' };
  const r = roll(rng, '2d6');
  return { ok: r >= need, need, roll: r, text: `2d6 ${r}, needed ${need}` };
}

// Sleep: 2d8 hit dice of creatures fall asleep, the smallest first; none above 4+1 HD, and a
// creature only sleeps if the dice left cover all of it (B/X). hds: each creature's hit dice.
// Returns the indexes of those asleep, and the dice rolled.
export function sleepTargets(rng, hds) {
  let left = roll(rng, '2d8');
  const total = left, order = hds.map((hd, k) => ({ hd, k })).filter((c) => c.hd <= 4.1).sort((a, b) => a.hd - b.hd);
  const asleep = [];
  for (const c of order) {
    const cost = Math.max(1, Math.ceil(c.hd));
    if (cost > left) break;
    left -= cost; asleep.push(c.k);
  }
  return { asleep, roll: total };
}
