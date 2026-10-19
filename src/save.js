// Save and load (PLAN.md 7.7). A save is versioned JSON of everything that changes in play: the
// party and what it carries, each level's doors, denizens, traps, chests, cells and fog of war,
// the room scripts' state, the clock, and the dice's own state, so a resumed game rolls exactly
// as the original would have. The game autosaves on entering a room and at the end of each
// encounter round; there are three slots besides.
import { Game } from './game.js';
import { MONSTERS, RECRUITS } from './defs.js';
import { VILLAGER } from './recruits.js';

export const VERSION = 1;
export const SLOTS = ['auto', '1', '2', '3'];
const key = (slot) => `kollchap-save-${slot}`;

const MEMBER = ['tile', 'x', 'z', 'yaw', 'hp', 'maxHp', 'downed', 'dead', 'petrified', 'light', 'torchLeft', 'torches', 'stub', 'oil', 'flasks', 'shut',
  'broken', 'ammo', 'spent', 'diseased', 'status', 'memorised', 'items', 'empty', 'weapon', 'tainted'];
const FOE = ['tile', 'x', 'z', 'yaw', 'hp', 'maxHp', 'state', 'alive', 'dead', 'fled', 'status', 'spotted', 'loot', 'loop', 'loopK', 'loopEnd', 'cast', 'spat', 'home', 'guard'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, structuredClone(o[k])]));
// fog of war, packed: one bit a tile, as base64
const pack = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8) { let b = 0; for (let k = 0; k < 8; k++) if (bytes[i + k]) b |= 1 << k; s += String.fromCharCode(b); } return btoa(s); };
const unpack = (str, out) => { const s = atob(str); for (let i = 0; i < out.length; i++) out[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1; };

// Can the game be saved now? Not mid-move, mid-dialogue, mid-spell, or in the foes' phase.
export function canSave(g) {
  return g.mode !== 'over' && !g.dialogue && !g.casting && !g.units.some((u) => u.route) && g.anims.length === 0 && g.enc?.phase !== 'foes';
}

export function snapshot(g) {
  const levels = {};
  for (const [id, L] of Object.entries(g.levels)) {
    levels[id] = {
      explored: pack(L.explored),
      doors: [...L.dungeon.doors.values()].map((d) => [d.i, d.open ? 1 : 0, d.found ? 1 : 0, d.key, d.smashed ? 1 : 0, d.rotten ? 1 : 0]),
      foes: L.foes.map((f) => ({ id: f.id, kind: f.kind, name: f.def.proper && f.def.name !== MONSTERS[f.kind].name ? f.def.name : undefined, group: f.group, on: f.on?.id, ...pick(f, FOE) })),
      traps: L.traps.map((t) => t.found), chests: L.chests.map((c) => pick(c, ['opened', 'lock', 'found', 'disarmed', 'sprung', 'done', 'hidden', 'checked'])),
      cells: L.cells.map((c) => c.freed), caches: L.caches.map((c) => c.found),
    };
  }
  const st = { ...g.state };
  for (const k of ['bridged', 'hiddenPits', 'openChests']) delete st[k];
  return {
    version: VERSION, saved: Date.now(), seed: g.seed, rng: g.rng.getState(), difficulty: g.difficulty,
    where: g.dungeon.roomOf(g.leader.tile)?.name || 'A passage', turn: Math.floor(g.clock / 10) + 1,
    L: g.L.id, levels, clock: g.clock, order: g.order, mode: g.mode,
    enc: g.mode === 'encounter' && g.enc ? { groups: [...g.enc.groups], round: g.enc.round, quiet: g.enc.quiet || 0, glare: !!g.enc.glare } : null,
    party: g.party.map((m) => ({ id: m.id, recruit: !!m.def.recruit, def: m.def.recruit ? null : m.def, ...pick(m, MEMBER) })),
    purse: g.purse, treasure: g.treasure, keys: [...g.keys], rations: g.rations, kills: g.kills.map((d) => d.name),
    piles: g.piles, state: st, rested: [...g.rested], searches: [...g.searches], scriptState: g.scriptState,
    visited: [...g.visited], log: g.log.slice(-20), roundsFought: g.roundsFought, probing: g.probing, detectEvil: g.detectEvil,
    groups: g.groups, swarm: g.swarm || null,
    escort: g.escort && !g.escort.fled ? pick(g.escort, ['tile', 'x', 'z', 'yaw', 'count', 'merchant']) : null,
    followers: g.followers.filter((u) => u.side === 'foe' && !u.fled).map((u) => u.id),
    seen: [...(g.ui?.seen || [])],
  };
}

export function restore(data, { ui, prefs }) {
  if (data?.version !== VERSION) throw new Error('This save is from another version of the game');
  const g = new Game({ ui: { update() {} }, seed: data.seed, difficulty: data.difficulty, prefs });
  g.rng.setState(data.rng);
  // the party: the heroes as they were (their defs carry the difficulty), and any recruits
  g.party = data.party.map((p) => {
    const m = g.makeMember(p.recruit ? RECRUITS[p.id] : p.def, p.tile);
    return Object.assign(m, structuredClone(p), { def: p.recruit ? RECRUITS[p.id] : p.def, route: null });
  });
  for (const k of ['order', 'purse', 'treasure', 'rations', 'piles', 'scriptState', 'log', 'roundsFought', 'probing', 'detectEvil', 'groups', 'clock']) g[k] = structuredClone(data[k]);
  Object.assign(g.state, data.state);
  g.keys = new Set(data.keys); g.rested = new Set(data.rested); g.searches = new Map(data.searches); g.visited = new Set(data.visited);
  g.kills = data.kills.map((name) => Object.values(MONSTERS).find((d) => d.name === name) || { name, xp: 0 });
  for (const [id, L] of Object.entries(g.levels)) {
    const s = data.levels[id];
    unpack(s.explored, L.explored);
    for (const [i, open, found, k, smashed, rotten] of s.doors) Object.assign(L.dungeon.doors.get(i), { open: !!open, found: !!found, key: k, smashed: !!smashed, rotten: !!rotten });
    L.foes = s.foes.map((f) => {
      const def = f.name ? { ...MONSTERS[f.kind], name: f.name, proper: true } : MONSTERS[f.kind];
      return { id: f.id, def, kind: f.kind, side: 'foe', group: f.group, loot: null, on: null, route: null, k: 0, wait: 0, walk: 0, moving: 0, flash: 0, off: [0, 0], moved: false, acted: false, ...structuredClone(f), def };
    });
    for (const f of L.foes) if (f.on) f.on = g.party.find((m) => m.id === f.on) || null;
    L.traps.forEach((t, k) => { t.found = s.traps[k]; });
    L.chests.forEach((c, k) => Object.assign(c, s.chests[k]));
    L.cells.forEach((c, k) => { c.freed = s.cells[k]; });
    L.caches.forEach((c, k) => { c.found = s.caches[k]; });
    const was = g.L;
    g.L = L; g.updateWalls(); g.rebuild(); L.exploredVersion++;
    g.L = was;
  }
  g.L = g.levels[data.L];
  if (data.escort) {
    g.escort = { id: 'prisoners', def: VILLAGER, side: 'escort', route: null, k: 0, wait: 0, walk: 0, moving: 0, flash: 0, off: [0, 0], status: {}, hp: 1, maxHp: 1, dead: false, fled: false, ...data.escort };
    g.followers.push(g.escort);
  }
  for (const id of data.followers) { const f = Object.values(g.levels).flatMap((L) => L.foes).find((x) => x.id === id); if (f) g.followers.push(f); }
  g.swarm = data.swarm;
  g.ui = ui;
  if (ui?.seen) for (const k of data.seen || []) ui.seen.add(k);
  g.sightKey = ''; g.updateSight();
  g.focusParty(true);
  // back into the fight: the next round begins
  if (data.mode === 'encounter' && data.enc) {
    g.mode = 'encounter';
    g.enc = { groups: new Set(data.enc.groups), round: data.enc.round, phase: null, surprised: { party: false, foes: false }, init: null, quiet: data.enc.quiet, glare: data.enc.glare };
    g.runEncounter();
  }
  return g;
}

// ---------- storage ----------
export function write(g, slot) {
  try { localStorage.setItem(key(slot), JSON.stringify(snapshot(g))); return true; } catch { return false; }
}
export function read(slot) {
  try { return JSON.parse(localStorage.getItem(key(slot)) || 'null'); } catch { return null; }
}
export function remove(slot) { try { localStorage.removeItem(key(slot)); } catch {} }
// What each slot holds, for the menus.
export function list() {
  return SLOTS.map((slot) => { const d = read(slot); return { slot, data: d && d.version === VERSION ? d : null }; });
}
