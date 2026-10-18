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
