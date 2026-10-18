// Game definitions (PLAN.md 7.2): light sources and the party.
//
// reach: how far, in tiles, the light is bright enough to see by (PLAN.md 3.5: a torch lights
// 30 ft, 6 tiles). r: where its glow fades to nothing, a little further out. col, i: colour and
// intensity. flicker / pulse: how much the flame dances or the glow breathes.
export const LIGHT_KINDS = {
  torch: { reach: 6, r: 7, col: [1, 0.6, 0.28], i: 2.4, flicker: 1 },
  lantern: { reach: 6, r: 7, col: [1, 0.72, 0.42], i: 2.1, flicker: 0.25 },
  brazier: { reach: 6, r: 7.5, col: [0.55, 1, 0.45], i: 2.2, flicker: 1 },
  campfire: { reach: 5, r: 6, col: [1, 0.55, 0.22], i: 2.4, flicker: 1.2 },
  lamp: { reach: 4, r: 5, col: [1, 0.68, 0.36], i: 1.6, flicker: 0.4 },
  candles: { reach: 3, r: 4, col: [1, 0.72, 0.42], i: 1.1, flicker: 0.6 },
  sconce: { reach: 4, r: 5.5, col: [1, 0.62, 0.3], i: 1.8, flicker: 1 },
  pool: { reach: 1.5, r: 2.6, col: [0.3, 0.95, 0.65], i: 0.9, pulse: 1 },
  sun: { reach: 5, r: 6.5, col: [1, 0.94, 0.82], i: 2.4 },
  daylight: { reach: 3, r: 4.5, col: [0.72, 0.8, 0.95], i: 1.4 },
};

// Burn times in minutes (PLAN.md 3.5): a torch lasts 6 turns, a flask of oil 24.
export const TORCH_MINUTES = 60, OIL_MINUTES = 240;

// The party (PLAN.md 4). str/dex/... are ability scores; mv: encounter move in tiles.
// melee / missile: weapon name and damage; a missile's range bands are in tiles (5 ft), from the
// B/X ranges (short bow 50/100/150 ft, sling 40/80/160, thrown dagger 10/20/30), and ammo is
// arrows, stones or daggers.
// look: paint colours for the miniature (linear rgb). kit: what each carries into the dungeon.
// gear: what fills the hands, which decides who can carry a light (a torch takes a hand).
export const PARTY = [
  {
    id: 'brannoc', name: 'Brannoc', cls: 'Fighter', str: 16, dex: 11, hp: 15, ac: 2, mv: 4,
    look: { skin: [0.55, 0.36, 0.25], body: [0.32, 0.33, 0.36], trim: [0.42, 0.05, 0.04], hair: [0.12, 0.07, 0.04] },
    gear: { sword: true, shield: true, helm: true },
    melee: { name: 'sword', dmg: '1d8' }, missile: { name: 'short bow', dmg: '1d6', range: [10, 20, 30], ammo: 20 },
    kit: { torches: 3, rope: true, spikes: true },
  },
  {
    id: 'ysolde', name: 'Ysolde', cls: 'Magic-User', str: 9, dex: 13, hp: 6, ac: 9, mv: 8,
    look: { skin: [0.62, 0.42, 0.32], body: [0.06, 0.1, 0.3], trim: [0.55, 0.42, 0.12], hair: [0.35, 0.12, 0.04] },
    gear: { robe: true, hat: true },
    melee: { name: 'dagger', dmg: '1d4' }, missile: { name: 'throwing dagger', dmg: '1d4', range: [2, 4, 6], ammo: 3 },
    kit: { torches: 2, lantern: true, oil: 2 },
  },
  {
    id: 'aldwin', name: 'Aldwin', cls: 'Cleric', str: 13, dex: 10, hp: 10, ac: 4, mv: 4,
    look: { skin: [0.5, 0.33, 0.24], body: [0.28, 0.29, 0.3], trim: [0.62, 0.6, 0.55], hair: [0.3, 0.3, 0.3] },
    gear: { mace: true, shield: true, tabard: true },
    melee: { name: 'mace', dmg: '1d6' }, missile: { name: 'sling', dmg: '1d4', range: [8, 16, 32], ammo: 20 },
    kit: { torches: 2, holyWater: 2 },
  },
  {
    id: 'fennick', name: 'Fennick', cls: 'Thief', str: 10, dex: 17, hp: 7, ac: 5, mv: 6,
    look: { skin: [0.58, 0.4, 0.28], body: [0.18, 0.1, 0.05], trim: [0.1, 0.18, 0.08], hair: [0.08, 0.06, 0.04] },
    gear: { dagger: true, hood: true },
    melee: { name: 'short sword', dmg: '1d6' }, missile: { name: 'sling', dmg: '1d4', range: [8, 16, 32], ammo: 20 },
    kit: { torches: 2, tools: true, pole: true },
    skills: { openLocks: 20, findTraps: 15, moveSilently: 25, hideInShadows: 15, climbWalls: 88, hearNoise: 2 },
  },
];

// Starting marching order, front to back, and who carries the two lit torches: one near the
// front and one at the rear. Ysolde has no shield to give up (PLAN.md 3.5).
export const START_ORDER = ['brannoc', 'ysolde', 'aldwin', 'fennick'];
export const START_LIGHTS = ['ysolde', 'fennick'];

// Denizens (PLAN.md Appendix A). hd: hit dice, for the attack matrix; mv: encounter move in
// tiles; dmg: per attack; ml: morale; infravision: sees 60 ft (12 tiles) in the dark.
// rig: which miniature (models.js); look: its paint.
export const MONSTERS = {
  hobgoblin: {
    name: 'Hobgoblin', ac: 6, hd: 1.01, mv: 6, dmg: '1d8', ml: 8, align: 'C', infravision: true, xp: 15, save: 'Fighter',
    rig: 'biped', look: { skin: [0.42, 0.18, 0.06], body: [0.18, 0.14, 0.1], trim: [0.45, 0.08, 0.04], hair: [0.05, 0.04, 0.03] }, gear: { sword: true, shield: true, tusks: true },
  },
  orc: {
    name: 'Orc', ac: 6, hd: 1, mv: 8, dmg: '1d6', ml: 8, align: 'C', infravision: true, xp: 10, save: 'Fighter',
    rig: 'biped', look: { skin: [0.16, 0.24, 0.08], body: [0.14, 0.11, 0.08], trim: [0.25, 0.2, 0.14], hair: [0.03, 0.03, 0.02] }, gear: { axe: true, tusks: true, hunch: true },
  },
  rat: {
    name: 'Giant rat', ac: 7, hd: 0.5, mv: 8, dmg: '1d3', ml: 8, align: 'N', infravision: false, xp: 5, save: 'Fighter', disease: true,
    rig: 'rat', look: { body: [0.12, 0.09, 0.07], trim: [0.5, 0.32, 0.3] },
  },
};
