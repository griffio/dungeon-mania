// Settings (PLAN.md 7.6, 3.8): difficulty for a new game, and the player's preferences. Kept in
// localStorage when it's there (it may not be: private windows), with plain defaults otherwise.
import { PARTY } from './defs.js';
import { die, mod } from './rules.js';

const KEY = 'kollchap-settings';
export const DEFAULTS = {
  difficulty: 'normal',  // story | normal | classic (for the next new game)
  showDice: true,        // roll the dice out on the table
  partyFirst: false,     // the party always wins initiative
  wanderers: true,       // wandering monsters (PLAN.md 3.7)
  reduceMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  textSize: 1,           // 0.85 .. 1.3
  volume: 0.9, voices: 1, music: 0.32,
  tips: true,            // the first-time hints
  tipsSeen: [],
};

export function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

// ---------- difficulty (PLAN.md 3.8) ----------
//   Story: level 3, more hit points, 2 more potions, and the downed get up when the fight ends.
//   Normal: level 2 with the hit points of PLAN.md 4, downed for 3 rounds.
//   Classic: level 1, hit points rolled (1s and 2s rerolled), 0 HP is death, and the cleric has
//   no spells yet (B/X).
export const DIFFICULTIES = {
  story: { name: 'Story', level: 3, note: 'Level 3, more hit points, 4 potions. The fallen get up when a fight ends.' },
  normal: { name: 'Normal', level: 2, note: 'Level 2. A fallen hero bleeds to death in 3 rounds unless bandaged.' },
  classic: { name: 'Classic', level: 1, note: 'Level 1, hit points rolled (1s and 2s rerolled). 0 HP is death.' },
};
// Thief skills by level (B/X): open locks, find/remove traps, move silently, hide, climb.
const THIEF = { 1: [15, 10, 20, 10, 87], 2: [20, 15, 25, 15, 88], 3: [25, 20, 30, 20, 89] };
const HIT_DIE = { Fighter: 8, Cleric: 6, 'Magic-User': 4, Thief: 4 };
// A rolled hit die, rerolling 1s and 2s (a common table rule: nobody starts on 1 HP).
const hitDie = (rng, sides) => { let r; do r = die(rng, sides); while (r <= 2); return r; };

// The heroes for a difficulty: copies of the defs, adjusted.
export function heroes(difficulty, rng) {
  const d = DIFFICULTIES[difficulty] ? difficulty : 'normal', level = DIFFICULTIES[d].level;
  return PARTY.map((base) => {
    const def = structuredClone(base);
    if (d === 'story') def.hp = Math.round(base.hp * 1.5);
    if (d === 'classic') def.hp = hitDie(rng, HIT_DIE[def.cls]) + (def.cls === 'Fighter' ? mod(14) : 0);
    if (def.kit.potions) def.kit.potions = d === 'story' ? base.kit.potions + 2 : d === 'classic' ? 0 : base.kit.potions;
    if (def.skills) {
      const [openLocks, findTraps, moveSilently, hideInShadows, climbWalls] = THIEF[level];
      Object.assign(def.skills, { openLocks, findTraps, moveSilently, hideInShadows, climbWalls });
    }
    if (def.spells) {
      // the magic-user memorises one spell at level 1, two after; the cleric none at 1, one at 2, two at 3
      const slots = def.cls === 'Cleric' ? level - 1 : level === 1 ? 1 : 2;
      def.spells.slots = slots;
      def.spells.memorised = def.cls === 'Cleric' ? ['cure', 'protection'].slice(0, slots) : ['sleep', 'missile'].slice(0, slots);
    }
    return def;
  });
}
