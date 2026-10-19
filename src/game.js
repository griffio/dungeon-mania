import { Dungeon, TILE, T, LINK_COST } from './dungeon.js';
import { Camera, Instances, FlatList, KNEE } from './renderer.js';
import { SceneBuilder } from './scene.js';
import { clamp, lerp, hash2, makeRng } from './util.js';
import * as DUNGEON from './dungeon-data.js';
import * as SURFACE from './surface-data.js';
import { LIGHT_KINDS, PARTY, START_ORDER, START_LIGHTS, TORCH_MINUTES, OIL_MINUTES, MONSTERS } from './defs.js';
import {
  die, roll, inSix, percent, doorChance, searchChance, minutesFor, SMASH_BREAK, mod,
  hitBase, attackRoll, hitChance, damage, moraleCheck, surprise, initiative, save, rangeMod,
} from './rules.js';
import { groupTargets } from './party.js';
import { drawHero, drawRat, drawSlime, drawSkeleton, drawRockman, drawLizard, drawCentipede, drawLocust } from './models.js';
import { foeTurn, canSee } from './ai.js';
import { SCRIPTS } from './scripts/rooms.js';
import * as magic from './magic.js';
import * as skills from './skills.js';
import * as traps from './traps.js';
import * as treasure from './treasure.js';
import * as recruits from './recruits.js';
import * as dialogue from './dialogue.js';
import * as ending from './ending.js';
import * as NARRATION from './narration.js';
import * as wanderers from './wanderers.js';
import { heroes, DIFFICULTIES, DEFAULTS } from './settings.js';
import { MIN_DIST, MAX_DIST } from './input.js';

const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Exploration (M2): the party walks the dark dungeon in marching order, opens doors, searches
// for secret ones and burns through its torches while the dungeon clock runs (PLAN.md 3.2-3.7).
const KEY_DIR = [-0.45, 0.85, 0.3];
// The dungeon is dark; "map light" adds an overview light and lifts the fog, for looking at
// the whole map (a viewing aid, not part of play).
const MAP_LIGHT = { key: [0.55, 0.52, 0.46], sky: [0.32, 0.31, 0.3], ground: [0.1, 0.095, 0.09] };
const DARK = { key: [0, 0, 0], sky: [0.012, 0.013, 0.018], ground: [0.004, 0.004, 0.005] };
// Fire: a few out-of-step sines, so no two flames move together.
const flicker = (t, s) => 0.08 * Math.sin(t * 7.3 + s) + 0.05 * Math.sin(t * 17.9 + s * 2.1) + 0.04 * Math.sin(t * 31.3 + s * 5.7);
const WALK_SPEED = 4;     // tiles per second
const FOLLOW_DELAY = 0.2; // seconds between members setting off, so the line strings out
const FOG_RATE = 8;       // how fast tiles fade in and out of sight, per second
// Cutaway around the camera's focus: walls inside CUT_IN drop to knee height and rise back to
// full height by CUT_OUT. Zoomed out past CUT_MAX_DIST the walls barely hide anything, so it's off.
const CUT_IN = 4.5, CUT_OUT = 6.5, CUT_MAX_DIST = 32;
const SEARCH_RADIUS = 2, HINT_RADIUS = 3.5; // tiles (PLAN.md 3.6)
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DOWNED_ROUNDS = 3; // a downed hero dies at the end of their third round unless bandaged (PLAN.md 3.4)
// The levels: the temple ruins on the surface, and the dungeon 40 ft below.
const LEVELS = { surface: SURFACE, dungeon: DUNGEON };
// What each level keeps for itself; the game reads them through accessors on the current level.
const PER_LEVEL = ['data', 'dungeon', 'scene', 'lit', 'visible', 'explored', 'sightTmp', 'fogCur', 'fog', 'walls', 'fixedLit',
  'shafts', 'staticDecals', 'foes', 'traps', 'chests', 'cells', 'caches', 'fogVersion', 'exploredVersion', 'wallsVersion', 'staticDecalsVersion'];
// Foes in these states aren't part of a fight: hidden in rubbish, waiting on a wall, charmed,
// cowering, watching without interest, talking, off searching rubble, guarding without a quarrel,
// held captive, surrendered (or bound), or walking with the party.
const ASIDE = new Set(['hidden', 'lurking', 'charmed', 'cowering', 'watching', 'parley', 'searching', 'guarding', 'captive', 'surrendered', 'bound', 'ally']);
export { ASIDE };

export class Game {
  // difficulty: 'story' | 'normal' | 'classic' (PLAN.md 3.8). prefs: the player's settings
  // (settings.js); without them (the tests), the defaults with no wandering monsters.
  constructor({ ui, seed = (Math.random() * 1e9) | 0, difficulty = 'normal', prefs = null }) {
    this.ui = ui;
    this.seed = seed;
    this.rng = makeRng(seed);
    this.difficulty = DIFFICULTIES[difficulty] ? difficulty : 'normal';
    this.level = DIFFICULTIES[this.difficulty].level;
    this.prefs = prefs || { ...DEFAULTS, wanderers: false, reduceMotion: false };
    this.camera = new Camera();
    this.view = { lowWalls: false, tintRooms: false, labels: true, secrets: false, mapLight: false };
    this.dyn = { box: new Instances(256), cyl: new Instances(128), sph: new Instances(128), cone: new Instances(16), ico: new Instances(8) };
    this.dice = []; // dice rolling on the table (PLAN.md 7.4)
    this.decals = new FlatList(16, 256);
    this.xray = new FlatList(16, 256);
    this.motes = new FlatList(8, 256);
    this.time = 0;
    this.clock = 0; // minutes since the party reached the temple
    this.log = [];
    this.searches = new Map(); // door (or 'lever') -> searches made for it
    this.state = { casesMoved: false, leverFound: false, leverPulled: false, rope: false, bridge: false, urns: DUNGEON.URNS.count, robes: false };
    this.piles = [];          // heaps of coins too heavy to just scoop up
    this.rested = new Set();  // rooms the party has caught its breath in
    this.probing = false;     // walking with the 10' pole out in front
    this.casting = null;      // a spell waiting for its target
    this.detectEvil = 0;      // clock time Detect Evil runs out
    this.heard = null;        // silhouettes heard through a door
    this.visited = new Set();
    this.levels = {};
    for (const [id, data] of Object.entries(LEVELS)) this.levels[id] = this.makeLevel(id, data);
    this.L = this.levels.surface;
    const d = this.dungeon;

    // the party, in marching order, front to back
    this.order = [...START_ORDER];
    this.party = heroes(this.difficulty, this.rng).map((def) => this.makeMember(def, d.idx(...this.data.PARTY_START[START_ORDER.indexOf(def.id)])));
    // what the party carries off: coins by kind, treasure items, keys, food; and the tally
    this.purse = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
    this.treasure = [];
    this.keys = new Set();
    this.rations = this.party.reduce((n, m) => n + (m.def.kit.rations || 0), 0);
    this.kills = [];          // defs of the denizens slain, for the XP tally
    this.escort = null;       // freed prisoners following the party (one huddle)
    this.followers = [];      // who walks behind the party: the prisoners, a guided Arch-deaconess
    this.dialogue = null;     // someone talking, waiting for the party's answer
    this.roundsFought = 0;
    this.audio = null;        // set by main.js in the browser; every sound call is a no-op without it
    this.autosave = null;     // set by main.js: called on entering a room and after each round (PLAN.md 7.7)
    // groups of denizens share morale and a room script
    this.groups = {};
    for (const L of Object.values(this.levels)) for (const f of L.foes) (this.groups[f.group] ||= { count: 0, deaths: 0, first: false, half: false }).count++;
    this.scriptState = {};
    this.mode = 'explore'; this.enc = null;
    this.anims = []; this.floats = [];
    this.selected = null;
    this.hoverTile = -1; this.target = -1; this.preview = null; this.pending = null; this.focusDoor = -1;

    this.sightKey = '';
    this.updateSight();
    this.say('Sunset over the ruined temple of Kollchap. By the hole at the far end, two hobgoblins sit at a fire.');
    this.focusParty(true);
  }

  // A party member, standing on tile i: a hero, or a recruit who has just joined.
  makeMember(def, i) {
    const [x, y] = this.dungeon.xy(i);
    return {
      def, id: def.id, tile: i, x: x + 0.5, z: y + 0.5, yaw: Math.PI / 2, // facing west, into the dungeon
      route: null, k: 0, wait: 0, walk: 0, moving: 0,
      light: null, torchLeft: 0, torches: def.kit.torches, stub: 0,
      oil: def.kit.lantern ? OIL_MINUTES : 0, flasks: def.kit.oil || 0, shut: false, broken: false, flame: null,
      side: 'party', hp: def.hp, maxHp: def.hp, downed: 0, dead: false, moved: false, acted: false,
      ammo: def.missile.ammo, flash: 0, off: [0, 0], diseased: false, status: {},
      memorised: [...(def.spells?.memorised || [])], items: { potion: def.kit.potions || 0, poolWater: 0, scrollCure: 0, scrollProtection: 0 }, empty: def.kit.flasks || 0,
    };
  }

  // A level: its map, scene, fog of war and denizens.
  makeLevel(id, data) {
    const d = new Dungeon(data), n = d.n, prev = this.L;
    const L = {
      id, data, dungeon: d, scene: new SceneBuilder(d),
      lit: new Uint8Array(n), visible: new Uint8Array(n), explored: new Uint8Array(n), sightTmp: new Uint8Array(n),
      fogCur: new Float32Array(n * 2), fog: new Uint8Array(n * 4), fogVersion: 0, exploredVersion: 0, wallsVersion: 0, staticDecalsVersion: 0,
      shafts: new Instances(4),
      foes: (data.FOES || []).map((f, k) => ({
        id: `${id}-${f.kind}${k}`, def: f.name ? { ...MONSTERS[f.kind], name: f.name, proper: true } : MONSTERS[f.kind], kind: f.kind, side: 'foe', group: f.group, guard: !!f.guard,
        loot: f.loot ? structuredClone(f.loot) : null,
        home: d.idx(...f.at), tile: d.idx(...f.at), x: f.at[0] + 0.5, z: f.at[1] + 0.5, yaw: hash2(f.at[0], f.at[1]) * Math.PI * 2,
        hp: f.hp, maxHp: f.hp, state: f.state, alive: true, dead: false, fled: false, status: {}, spotted: false, on: null,
        route: null, k: 0, wait: 0, walk: 0, moving: 0, flash: 0, off: [0, 0], moved: false, acted: false,
      })),
      traps: (data.TRAPS || []).map((t) => ({ ...t, i: d.idx(...t.at), found: !t.hidden })),
      chests: (data.CHESTS || []).map((c) => ({ ...structuredClone(c), i: d.idx(Math.floor(c.at[0]), Math.floor(c.at[1])), opened: false, found: !c.trap, sprung: false })),
      cells: (data.CELLS || []).map((c) => ({ ...c, i: d.idx(...c.gate), freed: false })),
      caches: (data.CACHES || []).map((c) => ({ ...structuredClone(c), found: false })),
    };
    this.L = L;
    this.rebuild();
    this.updateWalls();
    for (const sh of data.SHAFTS || []) {
      const [x, z] = sh.at, i = d.idx(Math.floor(x), Math.floor(z));
      L.shafts.add(x, L.scene.floorH(i), z, sh.r * 2, sh.len, sh.r * 2, sh.yaw, sh.col, 0, sh.i, -sh.lean);
    }
    this.L = prev;
    return L;
  }

  // Move the party to another level, standing on `tiles` (in marching order).
  useLevel(id, tiles) {
    this.L = this.levels[id];
    // the healing pool's water turns to poison in daylight (PLAN.md 6.3)
    if (this.data.DAYLIGHT) for (const m of this.party) if (m.items.poolWater) m.tainted = true;
    const d = this.dungeon;
    // more of us than the spots given (the recruits): gather round the first one
    if (tiles.length < this.order.length) tiles = this.standAround(id, ...tiles[0]);
    this.order.forEach((oid, k) => {
      const m = this.member(oid), [x, y] = tiles[k];
      Object.assign(m, { tile: d.idx(x, y), x: x + 0.5, z: y + 0.5, route: null, yaw: Math.PI / 2 });
    });
    this.target = -1; this.preview = null; this.hoverTile = -1; this.focusDoor = -1;
    this.sightKey = ''; this.updateSight();
    this.ui.levelChanged?.(this);
    this.focusParty(true);
  }

  // ---------- the party ----------
  member(id) { return this.party.find((m) => m.id === id); }
  get leader() { return this.member(this.order[0]); }
  get mover() { return this.selected ? this.member(this.selected) : this.leader; }
  get busy() { return this.units.some((m) => m.route) || this.anims.length > 0 || this.enc?.phase === 'foes'; }
  get units() { return this.escort && !this.escort.fled ? [...this.party, ...this.foes, this.escort] : [...this.party, ...this.foes]; }
  memberAt(i) { return this.party.find((m) => m.tile === i && !m.dead); }
  // Can't act: held, paralysed, struck down by poison. A hero who has bolted (Belisarius) is out
  // of the fight until it's over.
  helpless(u) { const s = u.status; return !!(s.paralysed || s.held || s.stricken); }
  canAct(m) { return !m.dead && !m.downed && !this.helpless(m) && !m.status.bolted; }
  // a living foe on tile i that the party can see (or any, under the map light); bodies don't count
  foeAt(i) { return this.foes.find((f) => f.tile === i && f.alive && this.foeShown(f)); }
  foeShown(f) { return !f.fled && f.state !== 'hidden' && (!this.fogOn || this.visible[f.tile]); }
  // tiles another living unit stands on: nobody walks through anybody
  blockedFor(u) {
    // a slime riding someone takes no room of its own
    // sized to the current level: the surface and the dungeon are different sizes
    let b = this.blockedTmp;
    if (!b || b.length !== this.dungeon.n) b = this.blockedTmp = new Uint8Array(this.dungeon.n);
    b.fill(0);
    for (const o of this.units) if (o !== u && !o.dead && !o.fled && o.state !== 'hidden' && !(o.def.rig === 'slime')) b[o.tile] = 1;
    return b;
  }
  get burdened() { return treasure.burdened(this); }

  // ---------- traps ----------
  hiddenTrapAt(i) { return this.traps?.find((t) => t.i === i && !t.found) || null; }
  // traps nobody has found yet, the slime among them (it hangs on a wall, unnoticed)
  unfoundTraps() {
    return [...this.traps.filter((t) => !t.found),
      ...this.foes.filter((f) => f.def.rig === 'slime' && f.alive && !f.spotted).map((f) => ({ kind: 'slime', i: f.tile, foe: f }))];
  }
  revealTrap(t, text) {
    if (t.foe) t.foe.spotted = true; else t.found = true;
    this.bark(this.party.find((m) => !m.dead), 'trap');
    this.say(`${text}.`);
    this.rebuild();
    this.refreshPreview();
  }
  distTo(a, b) { const [ax, ay] = this.dungeon.xy(a), [bx, by] = this.dungeon.xy(b); return Math.hypot(ax - bx, ay - by); }
  // Stop the whole party where it stands (someone fell, or was caught): u stays on tile.
  haltParty(u, tile) {
    const d = this.dungeon, taken = new Set([tile]);
    u.route = null; u.tile = tile; [u.x, u.z] = d.xy(tile).map((v) => v + 0.5);
    for (const m of this.party) {
      if (m === u || !m.route) continue;
      const a = m.route[Math.floor(m.k)];
      m.route = null;
      m.tile = taken.has(a) ? this.freeTileNear(a, m) : a;
      taken.add(m.tile);
      [m.x, m.z] = d.xy(m.tile).map((v) => v + 0.5);
    }
    this.pending = null;
  }
  // a little burst of light where a spell lands
  sparkle(x, z, kind) { (this.sparkles ||= []).push({ x, z, t: 0, kind }); }

  // The walkable tile nearest to i (i itself if it's free) that nobody but u is standing on.
  freeTileNear(i, u) {
    const d = this.dungeon, taken = this.blockedFor(u), [x0, y0] = d.xy(i);
    let best = i, bd = Infinity;
    for (let y = y0 - 3; y <= y0 + 3; y++) for (let x = x0 - 3; x <= x0 + 3; x++) {
      if (!d.inside(x, y)) continue;
      // prefer the same room, but spill out of a crowded one
      const j = d.idx(x, y), dist = Math.hypot(x - x0, y - y0) + (d.roomOf(j) === d.roomOf(i) ? 0 : 2);
      if (!taken[j] && TILE[d.t[j]].walk && !TILE[d.t[j]].door && d.t[j] !== T.PIT && dist < bd) { bd = dist; best = j; }
    }
    return best;
  }
  // Can someone on tile a hit someone on tile b in melee? Next to each other, and not across the
  // corner of a wall or through a doorway diagonally.
  inMelee(a, b) {
    const d = this.dungeon, [ax, ay] = d.xy(a), [bx, by] = d.xy(b);
    if (Math.max(Math.abs(ax - bx), Math.abs(ay - by)) !== 1) return false;
    return d.step(a, b, { closed: false, pits: true, through: new Set([b]) }) < Infinity;
  }
  // the tile a member is on, or passing through
  eyeOf(m) { return m.route ? m.route[Math.min(Math.round(m.k), m.route.length - 1)] : m.tile; }

  select(id) {
    if (this.busy) return;
    const m = this.member(id);
    if (this.mode === 'encounter') {
      // in an encounter, tapping a hero picks who acts next (there's no moving alone to undo)
      if (!this.canAct(m)) return;
      this.selected = id; this.attackPlan = null;
    } else {
      this.selected = this.selected === id ? null : id;
    }
    if (this.selected) this.bark(m, 'select', 0.6);
    this.cancel();
  }

  // Swap two places in the marching order.
  swapOrder(a, b) {
    const o = this.order, i = o.indexOf(a), j = o.indexOf(b);
    if (i < 0 || j < 0 || i === j) return;
    if (recruits.refusesPlace(this, a, j) || recruits.refusesPlace(this, b, i)) { this.say('"Not in front," says Belisarius. "I\'ll watch the back."'); this.ui.update(this); return; }
    [o[i], o[j]] = [o[j], o[i]];
    this.say(`Marching order: ${o.map((id) => this.member(id).def.name).join(', ')}.`);
    this.ui.update(this);
  }

  say(text) {
    this.log.push({ at: this.clock, text });
    if (this.log.length > 60) this.log.shift();
    this.audio?.sayQuotes(text);
    this.ui?.update(this);
  }

  // A first-time hint (ui.js).
  tip(id) { this.ui?.tip?.(id); }

  // ---------- sound (PLAN.md 8.1) ----------
  // A sound effect, at a unit or a tile (or everywhere).
  sfx(id, at, vol = 1) {
    if (!this.audio) return;
    const pos = at === undefined || at === null ? null : typeof at === 'number' ? this.dungeon.xy(at).map((v) => v + 0.5) : [at.x, at.z];
    this.audio.play(id, { pos, vol });
  }
  // A footstep as someone walks onto tile i: a muted scuff (one of three), a splash in water.
  // Everyone the party can see makes them, the leader a little louder. (Math.random, not the
  // game's dice: sound never changes what happens.)
  footstep(u, i) {
    if (!this.audio || (u.side === 'foe' && !this.foeShown(u))) return;
    const water = this.dungeon.t[i] === T.WATER;
    const vol = u === this.leader ? 0.55 : u.side === 'foe' ? 0.45 : 0.3;
    this.sfx(water ? 'splash' : `step_${1 + Math.floor(Math.random() * 3)}`, u, water ? vol + 0.2 : vol);
  }
  // A party member says something about what just happened (now and then, never over a voice).
  bark(m, event, chance = 1) {
    if (!this.audio || !m || m.side !== 'party' || m.dead || this.rng() > chance) return;
    this.audio.bark(m.id, event, { force: event === 'downed' });
  }
  // The narrator: the line goes in the log, and is read aloud.
  narrate(key) {
    const [kind, id] = key.split(':'), text = kind === 'room' ? NARRATION.ROOMS[id] : kind === 'end' ? NARRATION.ENDINGS[id] : NARRATION.MOMENTS[id];
    if (!text) return;
    this.log.push({ at: this.clock, text, narr: true });
    this.audio?.narrate(kind === 'room' ? `nar_room_${id}` : kind === 'end' ? `nar_end_${id}` : `nar_${id}`);
    this.ui?.update(this);
  }

  // ---------- time and light ----------
  // Let dungeon time pass: torches burn down and the lantern uses oil (PLAN.md 3.5, 3.7).
  advance(minutes) {
    this.clock += minutes;
    magic.tickStatus(this, minutes);
    wanderers.tick(this, minutes);
    for (const m of this.party) {
      if (m.light === 'torch') {
        if (m.torchLeft > 10 && m.torchLeft - minutes <= 10) { this.bark(m, 'lowtorch'); this.tip('torch'); }
        m.torchLeft -= minutes;
        if (m.torchLeft <= 0) { m.light = null; m.torchLeft = 0; this.say(`${m.def.name}'s torch gutters out.`); }
      } else if (m.light === 'lantern') {
        m.oil -= minutes;
        if (m.oil <= 0) {
          if (m.flasks > 0) { m.flasks--; m.oil += OIL_MINUTES; this.say(`${m.def.name} refills the lantern (${m.flasks} flask${m.flasks === 1 ? '' : 's'} left).`); }
          else { m.oil = 0; m.light = null; this.say(`${m.def.name}'s lantern runs dry.`); }
        }
      }
    }
  }

  // Light a torch: the half-burnt stub first if there is one.
  lightTorch(m, quiet = false) {
    if (m.stub > 0) { m.torchLeft = m.stub; m.stub = 0; }
    else if (m.torches > 0) { m.torches--; m.torchLeft = TORCH_MINUTES; }
    else return false;
    if (m.light === 'lantern') m.shut = false;
    m.light = 'torch';
    this.sfx('torch_light', m);
    if (!quiet) this.say(`${m.def.name} lights a torch (${m.torches} left).`);
    return true;
  }

  // Lights the party carries, for sight: where they are and how far they reach.
  carriedLights() {
    const out = [];
    for (const m of this.party) {
      if (m.dead) continue;
      const [x, y] = this.dungeon.xy(this.eyeOf(m));
      if (m.status.lightSpell) out.push({ x: x + 0.5, z: y + 0.5, reach: LIGHT_KINDS.spell.reach });
      if (m.light !== 'torch' && !(m.light === 'lantern' && !m.shut)) continue;
      out.push({ x: x + 0.5, z: y + 0.5, reach: LIGHT_KINDS[m.light].reach });
    }
    return out;
  }

  // ---------- fog of war ----------
  // Recompute what the party sees: the fixed lights and the carried ones light the tiles, and
  // each member sees the lit tiles in view plus the ones beside them (PLAN.md 3.5).
  updateSight() {
    const d = this.dungeon;
    this.lit.set(this.fixedLit);
    d.light(this.carriedLights(), this.lit);
    this.visible.fill(0);
    for (const m of this.party) {
      if (m.dead) continue;
      d.sight(this.eyeOf(m), this.lit, this.sightTmp);
      for (let i = 0; i < d.n; i++) this.visible[i] |= this.sightTmp[i];
    }
    let found = false;
    for (let i = 0; i < d.n; i++) if (this.visible[i] && !this.explored[i]) { this.explored[i] = 1; found = true; }
    if (found) { this.exploredVersion++; this.ui.viewKey = null; }
  }
  // what decides sight: where everyone is and who is carrying a light
  sightState() { return this.party.map((m) => `${this.eyeOf(m)}${m.light === 'torch' || (m.light === 'lantern' && !m.shut) ? '*' : ''}${m.status.lightSpell ? '+' : ''}`).join() + this.wallsVersion + this.foes.map((f) => f.tile).join(); }

  // Ease each tile's fog toward its target so things fade into and out of sight.
  updateFog(dt) {
    const k = 1 - Math.exp(-dt * FOG_RATE), cur = this.fogCur, fog = this.fog;
    let changed = false;
    for (let i = 0; i < this.dungeon.n; i++) {
      for (let c = 0; c < 2; c++) {
        const want = c ? this.explored[i] : this.visible[i], v = cur[i * 2 + c];
        if (v === want) continue;
        const nv = Math.abs(want - v) < 0.01 ? want : v + (want - v) * k;
        cur[i * 2 + c] = nv; fog[i * 4 + c] = nv * 255; changed = true;
      }
    }
    if (changed) this.fogVersion++;
  }

  // no fog on the surface in daylight, or under the map light
  get fogOn() { return !this.view.mapLight && !this.data.DAYLIGHT; }
  known(i) { return !this.fogOn || this.explored[i] === 1; }
  // A secret door nobody has found is just wall, as far as the player can tell.
  hiddenDoor(i) { const door = this.dungeon.doors.get(i); return !!door && !door.found; }

  // Tiles light can't pass: rock and closed doors (bars and the pool let it through). The fixed
  // lights' reach changes with the doors too.
  updateWalls() {
    const d = this.dungeon, hts = this.scene.heights;
    this.walls = this.walls || new Uint8Array(d.n * 4);
    for (let i = 0; i < d.n; i++) {
      const [x, y] = d.xy(i);
      this.walls[i * 4] = d.clear(x, y) ? 0 : 255;
      this.walls[i * 4 + 1] = Math.min(255, Math.round((hts?.[i] || 0) * 255 / 4));
      this.walls[i * 4 + 2] = Math.round((this.scene.round?.[i] || 0) * 255);
    }
    this.wallsVersion = (this.wallsVersion || 0) + 1;
    this.fixedLit = d.light((this.data.LIGHTS || []).map((l) => ({ x: l.at[0], z: l.at[1], reach: LIGHT_KINDS[l.kind].reach })));
    // in daylight every tile is lit: sight is just line of sight
    if (this.data.DAYLIGHT) this.fixedLit.fill(1);
  }

  rebuild() {
    this.state.bridged = new Set(traps.bridgeTiles(this));
    this.state.openChests = new Set((this.chests || []).filter((c) => c.opened).map((c) => `${c.at[0]},${c.at[1]}`));
    this.state.hiddenPits = new Set((this.traps || []).filter((t) => !t.found && t.kind === 'pit').map((t) => t.i));
    this.scene.build(this.view, this.state);
    this.staticDecals = this.scene.decals(this.view);
    this.staticDecalsVersion++;
  }

  toggle(name) {
    this.view[name] = !this.view[name];
    if (name === 'lowWalls' || name === 'tintRooms' || name === 'secrets') this.rebuild();
    if (name === 'labels' || name === 'mapLight') this.ui.viewKey = null;
    this.refreshPreview();
    this.ui.update(this);
  }

  // ---------- secret doors and the torch-lean hint ----------
  // Doors the party hasn't found yet (secret ones), and the lever while it's hidden.
  hidden() {
    const out = [];
    for (const door of this.dungeon.doors.values()) if (!door.found) out.push({ i: door.i, door });
    if (!this.state.leverFound) {
      const lever = [...this.dungeon.doors.values()].find((x) => x.lever >= 0);
      if (lever) out.push({ i: lever.lever, lever: true });
    }
    return out;
  }
  // The nearest hidden door within HINT_RADIUS of (x, z), as a lean vector toward it, or null.
  hintAt(x, z) {
    let best = null, bd = HINT_RADIUS;
    for (const h of this.hidden()) {
      if (h.lever) continue;
      const [hx, hy] = this.dungeon.xy(h.i), dx = hx + 0.5 - x, dz = hy + 0.5 - z, dist = Math.hypot(dx, dz);
      if (dist < bd) { bd = dist; best = [dx / dist, dz / dist, 1 - dist / HINT_RADIUS, hx + 0.5, hy + 0.5]; }
    }
    return best;
  }

  // ---------- walking ----------
  pathOpts() {
    return {
      pits: true,                  // climbing down and up a pit is slow but possible (M4 adds the risk)
      links: this.explored[this.dungeon.links[0].a] === 1, // the 9-18 tunnel, once the hatch is seen
      keys: new Set(),
      known: this.fogOn ? this.explored : null, // under fog, paths only cross ground the party has seen
      secrets: false,
      floorPits: this.floorPits(),               // a covered pit looks like floor; a bridged one is crossed like it
    };
  }

  floorPits() {
    const out = new Set(this.traps.filter((t) => !t.found && t.kind === 'pit').map((t) => t.i));
    for (const i of traps.bridgeTiles(this)) out.add(i);
    return out;
  }

  // Plan a walk for whoever moves (the leader, or the selected member alone) to tile `goal`.
  // The walk stops short of the first closed door; arriving there tries to open it.
  plan(goal) {
    const d = this.dungeon, mover = this.mover;
    if (goal < 0 || !TILE[d.t[goal]].walk || this.hiddenDoor(goal)) return null;
    const other = this.memberAt(goal);
    if (this.selected && other && other !== mover) return { blocked: `${other.def.name} is standing there` };
    const through = TILE[d.t[goal]].door ? new Set([goal]) : null;
    const p = d.pathTo(mover.tile, goal, { ...this.pathOpts(), through });
    if (!p) return null;
    let cut = p.tiles.length - 1, door = -1;
    for (let k = 1; k < p.tiles.length; k++) {
      const dd = d.doors.get(p.tiles[k]);
      if (dd && !dd.open) { cut = k - 1; door = p.tiles[k]; break; }
    }
    const path = p.tiles.slice(0, cut + 1);
    let cost = 0;
    for (let k = 1; k < path.length; k++) cost += this.stepCost(path[k - 1], path[k]);
    return { path, door, goal, cost, full: p.tiles };
  }
  stepCost(a, b) {
    const d = this.dungeon, [ax, ay] = d.xy(a), [bx, by] = d.xy(b);
    if (Math.max(Math.abs(ax - bx), Math.abs(ay - by)) > 1) return LINK_COST; // the 9-18 tunnel
    const c = d.step(a, b, { pits: true, closed: true, through: new Set([b]) });
    return c < Infinity ? c : 1;
  }

  // Set the party walking along a plan: the mover's path, the others following in marching
  // order (or nobody, when a member moves alone).
  go(plan) {
    const d = this.dungeon;
    // the pole finds a covered pit before anyone steps on it
    if (this.probing && !this.selected) {
      const path = traps.probe(this, plan.path);
      if (path.length < plan.path.length) plan = { ...plan, path, door: -1, goal: path[path.length - 1] };
    }
    this.pending = { door: plan.door, goal: plan.goal, actor: this.mover };
    if (plan.path.length > 4) this.bark(this.mover, 'move', 0.2);
    if (plan.door >= 0) this.focusDoor = plan.door;
    const solo = !!this.selected;
    const start = (m, tiles, wait) => {
      if (!tiles || tiles.length < 2) return;
      m.route = tiles; m.k = 0; m.wait = wait;
    };
    if (solo) start(this.mover, plan.path, 0);
    else {
      // the party in marching order, then whoever follows it (the dead stay where they fell)
      const line = [...this.order.map((id) => this.member(id)).filter((m) => !m.dead), ...recruits.followers(this)];
      const chain = line.map((m) => m.tile);
      const ok = (i) => TILE[d.t[i]].walk && !TILE[d.t[i]].door && this.known(i) && d.t[i] !== T.PIT;
      const targets = groupTargets(d, plan.path, chain, ok);
      const follow = { ...this.pathOpts(), closed: false };
      line.forEach((m, k) => {
        if (k === 0) start(m, plan.path, 0);
        else if (targets[k] !== undefined && targets[k] !== m.tile) start(m, d.pathTo(m.tile, targets[k], follow)?.tiles, k * FOLLOW_DELAY);
      });
    }
    this.target = -1; this.preview = null;
    if (!this.busy) this.arrived();
    this.ui.update(this);
  }

  // Everyone has stopped: deal with the door the walk stopped at. (Room 21's block shuts by
  // itself, on its own count: scripts/rooms.js.)
  arrived() {
    const p = this.pending;
    this.pending = null;
    if (p && p.door >= 0 && this.adjacentTo(p.door).length) {
      if (this.tryOpen(p.door) && p.goal !== p.door) {
        // the way is open: carry on to where the player was going
        const next = this.plan(p.goal);
        if (next && next.path.length > 1) this.go(next);
      }
    }
    this.refreshPreview();
    this.ui.update(this);
  }

  // ---------- doors ----------
  // Members on a tile beside door tile i (across one of its four sides).
  adjacentTo(i) {
    const [x, y] = this.dungeon.xy(i);
    return this.party.filter((m) => !m.route && N4.some(([dx, dy]) => m.tile === this.dungeon.idx(x + dx, y + dy)));
  }
  // The door the action bar works on: the one the party walked to, else the nearest known door
  // beside anyone.
  activeDoor() {
    const d = this.dungeon;
    if (this.focusDoor >= 0 && this.adjacentTo(this.focusDoor).length && d.doors.get(this.focusDoor).found) return d.doors.get(this.focusDoor);
    let best = null, bd = Infinity;
    for (const door of d.doors.values()) {
      if (!door.found || !this.adjacentTo(door.i).length) continue;
      const [x, y] = d.xy(door.i), [lx, ly] = d.xy(this.mover.tile), dist = Math.hypot(x - lx, y - ly);
      if (dist < bd) { bd = dist; best = door; }
    }
    return best;
  }
  doorName(door) {
    const t = this.dungeon.t[door.i];
    return t === T.GATE ? 'cell gate' : t === T.BLOCK ? 'stone block' : TILE[t].secret ? 'secret door' : 'door';
  }
  doorsChanged() { this.updateWalls(); this.rebuild(); this.sightKey = ''; }

  // Try to open a door: locks and handles first, then the stiff-door roll (PLAN.md 3.6).
  tryOpen(i) {
    const d = this.dungeon, door = d.doors.get(i), who = this.adjacentTo(i);
    if (!who.length || door.open) return door.open;
    const name = this.doorName(door);
    if (door.key === 'lever') { this.say(`The ${name} has no handle or keyhole. Something else must work it.`); return false; }
    if (door.opensFrom >= 0 && !who.some((m) => m.tile === door.opensFrom)) { this.say(`There is no handle on this side of the ${name}.`); return false; }
    if (door.key === 'odric' && this.keys.has('odric')) { door.key = null; this.say(`One of Odric's keys turns the lock of the ${name}.`); }
    if (door.key) { this.say(`The ${name} is locked.`); return false; }
    // the strongest of those at the door puts a shoulder to it
    const m = who.reduce((a, b) => (doorChance(b.def.str) > doorChance(a.def.str) ? b : a));
    const r = inSix(this.rng, doorChance(m.def.str));
    this.advance(1);
    this.noise(i, 10); // forcing a stiff door is loud (PLAN.md 3.6)
    if (!r.ok) { this.sfx('door_stuck', i); this.tip('door'); this.say(`${m.def.name} heaves at the ${name}, but it's stuck (${r.text}).`); return false; }
    door.open = true;
    this.sfx(this.dungeon.t[i] === T.GATE ? 'gate_open' : TILE[this.dungeon.t[i]].secret || this.dungeon.t[i] === T.BLOCK ? 'door_secret' : 'door_open', i);
    this.say(`${m.def.name} forces the ${name} open (${r.text}).`);
    this.doorsChanged();
    this.runScripts('opened', door);
    return true;
  }
  closeDoor(door) {
    if (this.memberAt(door.i)) return;
    door.open = false;
    this.sfx('door_close', door.i);
    this.say(`The ${this.doorName(door)} is pulled shut.`);
    this.doorsChanged();
  }
  pickLock(door) {
    const m = this.member('fennick'), r = percent(this.rng, m.def.skills.openLocks);
    if (!r.ok) { this.advance(10); this.say(`Fennick works at the lock for a turn, without luck (${r.text}).`); this.ui.update(this); return; }
    this.advance(1);
    door.key = null;
    this.sfx('lock_pick', door.i);
    this.say(`The lock clicks under Fennick's picks (${r.text}).`);
    this.tryOpen(door.i);
  }
  smash(door) {
    const who = this.adjacentTo(door.i), m = who.reduce((a, b) => (mod(b.def.str) > mod(a.def.str) ? b : a));
    const r = percent(this.rng, SMASH_BREAK);
    this.advance(1);
    door.key = null; door.open = true; door.smashed = true;
    this.noise(door.i, 16);
    this.sfx('door_smash', door.i);
    this.say(`${m.def.name} smashes the lock off the ${this.doorName(door)}. The noise echoes down the passages.`);
    if (r.ok && !m.broken) { m.broken = true; this.say(`${m.def.name}'s weapon cracks in the blow (${r.text}).`); }
    this.doorsChanged();
    this.runScripts('opened', door);
  }

  // ---------- searching ----------
  // Everyone searches around themselves for a turn: each hidden door or lever within reach is
  // found on 1 in 6, better each time it has been searched for (PLAN.md 3.6).
  search() {
    const d = this.dungeon;
    this.advance(10);
    this.sfx('search', this.leader);
    const near = this.hidden().filter((h) => {
      const [hx, hy] = d.xy(h.i);
      return this.party.some((m) => { const [x, y] = d.xy(m.tile); return Math.hypot(hx - x, hy - y) <= SEARCH_RADIUS; });
    });
    let found = false;
    for (const h of near) {
      if (h.door?.behind === 'cases' && !this.state.casesMoved) {
        this.state.casesMoved = true;
        this.advance(10);
        this.say('It takes a turn to drag the packing cases away from the north wall.');
        this.rebuild();
      }
      const key = h.lever ? 'lever' : h.i, n = this.searches.get(key) || 0;
      this.searches.set(key, n + 1);
      const r = inSix(this.rng, searchChance(n));
      if (!r.ok) continue;
      found = true;
      if (h.lever) {
        this.state.leverFound = true;
        this.say(`Under the bed, a lever is set into the floor (${r.text}).`);
      } else {
        h.door.found = true;
        this.bark(this.party.find((m) => !m.dead && this.distTo(m.tile, h.i) <= SEARCH_RADIUS), 'secret');
        this.say(`A secret door! The outline of a hidden ${h.door.key === 'lever' ? 'panel' : 'door'} shows in the stonework (${r.text}).`);
      }
    }
    // traps too, on 1 in 6 (the thief does better with Find Traps)
    for (const t of this.unfoundTraps()) {
      if (!this.party.some((m) => this.distTo(m.tile, t.i) <= SEARCH_RADIUS) || !inSix(this.rng, 1).ok) continue;
      found = true;
      this.revealTrap(t, t.kind === 'pit' ? 'Searching, someone notices a seam in the floor: a covered pit' : 'Searching, someone notices a wet green sheen on the wall: green slime');
    }
    if (treasure.searchCaches(this)) found = true;
    if (treasure.searchChests(this)) found = true;
    if (!found) this.say('The party searches the walls and floor for a turn, and finds nothing.');
    this.doorsChanged();
    this.runScripts('search');
  }
  pullLever() {
    const door = [...this.dungeon.doors.values()].find((x) => x.lever >= 0);
    this.state.leverPulled = true;
    door.found = true; door.key = null; door.open = true;
    this.sfx('lever', door.lever);
    this.say('The lever moves with a clunk, and a section of the north-west wall grinds open.');
    this.doorsChanged();
  }
  nearLever() {
    const door = [...this.dungeon.doors.values()].find((x) => x.lever >= 0);
    if (!door || !this.state.leverFound || this.state.leverPulled) return false;
    const [lx, ly] = this.dungeon.xy(door.lever);
    return this.party.some((m) => { const [x, y] = this.dungeon.xy(m.tile); return Math.max(Math.abs(x - lx), Math.abs(y - ly)) <= 1; });
  }

  // ---------- the action bar ----------
  // What the party can do right now, in exploration (PLAN.md 3.2). Each action names who does it.
  actions() {
    if (this.mode === 'encounter') return this.encounterActions();
    const out = [], idle = !this.busy;
    const door = idle ? this.activeDoor() : null;
    out.push({ id: 'search', icon: '⌕', label: 'Search', hint: 'Everyone searches nearby walls for a turn', ok: idle, run: () => this.search() });
    if (door) {
      const name = this.doorName(door);
      if (!door.open) {
        out.push({ id: 'open', icon: '⊓', label: `Open ${name}`, ok: true, run: () => { this.tryOpen(door.i); this.refreshPreview(); } });
        if (door.key && door.key !== 'lever') {
          const fennick = this.adjacentTo(door.i).includes(this.member('fennick'));
          out.push({ id: 'pick', icon: '⚷', label: 'Pick lock', hint: fennick ? 'Fennick: Open Locks 20%' : 'Fennick must be at the door', ok: fennick, run: () => this.pickLock(door) });
          out.push({ id: 'smash', icon: '⚒', label: 'Smash lock', hint: 'Loud, and the weapon may break', ok: true, run: () => this.smash(door) });
        }
      } else if (TILE[this.dungeon.t[door.i]].door && this.dungeon.t[door.i] !== T.BLOCK && !door.smashed) {
        out.push({ id: 'close', icon: '⊔', label: `Close ${name}`, ok: !this.memberAt(door.i), run: () => this.closeDoor(door) });
      }
    }
    if (idle && this.nearLever()) out.push({ id: 'lever', icon: '⟋', label: 'Pull the lever', ok: true, run: () => this.pullLever() });
    // the hole down, and the tunnel back up
    const link = this.dungeon.links.find((l) => l.kind === 'climb'), exit = this.dungeon.links.find((l) => l.id === 'entrance');
    if (idle && link && this.near(link.a, 1)) {
      const roper = this.party.find((m) => m.def.kit.rope && !m.dead && !m.downed);
      if (!this.state.rope && roper) out.push({ id: 'rope', icon: '⥿', label: 'Fix the rope', hint: `${roper.def.name} spikes the rope at the lip: a turn, and then no falls`, ok: true, run: () => this.fixRope(roper) });
      out.push({ id: 'climb', icon: '⤓', label: 'Climb down', hint: this.state.rope ? 'Down the rope' : 'A DEX check each, or fall 1d6', ok: true, run: () => this.climbDown() });
    }
    if (idle && exit && this.near(exit.a, 1)) out.push({ id: 'climbup', icon: '⤒', label: 'Climb the tunnel', hint: 'Back up to the surface', ok: true, run: () => this.climbUp() });
    // Odric's stairs: from room 15 up to the trees behind the temple, and back down
    const stairs = this.dungeon.links.find((l) => l.kind === 'stairs');
    if (idle && stairs && this.near(stairs.a, 1)) {
      out.push(this.L.id === 'dungeon'
        ? { id: 'stairsup', icon: '⤒', label: 'Climb the stairs', hint: 'Up to the surface, behind the temple', ok: true, run: () => this.takeStairs('surface') }
        : { id: 'stairsdown', icon: '⤓', label: 'Go down the stairs', hint: "Odric's stairs, to room 15", ok: true, run: () => this.takeStairs('dungeon') });
    }
    // the cult's robes from room 15: a disguise at a distance
    if (idle && this.state.robes) out.push({ id: 'robes', icon: '👘', label: this.state.robesOn ? 'Take off the robes' : 'Put on the robes', hint: this.state.robesOn ? 'Back in your own colours' : 'Cultists ignore you until you are close', ok: true, run: () => { this.state.robesOn = !this.state.robesOn; this.say(this.state.robesOn ? 'The party pulls the green and white robes on over its armour.' : 'The robes come off.'); } });
    // light: the selected member, or the first in line without one
    const sel = this.selected && this.member(this.selected);
    const dark = sel || this.order.map((id) => this.member(id)).find((m) => !m.light && (m.torches || m.stub));
    if (dark && dark.light !== 'torch' && (dark.torches || dark.stub) && !this.data.DAYLIGHT) {
      out.push({ id: 'light', icon: '🔥', label: `${dark.def.name}: light torch`, hint: `${dark.torches} torch${dark.torches === 1 ? '' : 'es'} left`, ok: idle, run: () => { this.lightTorch(dark); this.sightKey = ''; } });
    }
    if (sel && sel.light === 'torch') {
      out.push({ id: 'douse', icon: '◌', label: `${sel.def.name}: douse torch`, hint: 'Keeps the rest of it for later', ok: idle, run: () => { sel.stub = sel.torchLeft; sel.light = null; this.say(`${sel.def.name} douses the torch.`); this.sightKey = ''; } });
    }
    const ys = this.party.find((m) => m.def.kit.lantern);
    if (ys && (ys.oil > 0 || ys.flasks > 0) && !this.data.DAYLIGHT) {
      const label = ys.light !== 'lantern' ? 'light lantern' : ys.shut ? 'open the hood' : 'shutter lantern';
      out.push({
        id: 'lantern', icon: '☼', label: `${ys.def.name}: ${label}`, hint: `Oil for ${Math.ceil(ys.oil / 10)} turns, ${ys.flasks} flask${ys.flasks === 1 ? '' : 's'}`, ok: idle,
        run: () => {
          if (ys.light !== 'lantern') {
            if (ys.light === 'torch') { ys.stub = ys.torchLeft; }
            if (ys.oil <= 0) { ys.flasks--; ys.oil = OIL_MINUTES; }
            ys.light = 'lantern'; ys.shut = false;
            this.say(`${ys.def.name} lights the hooded lantern.`);
          } else {
            ys.shut = !ys.shut;
            this.say(ys.shut ? `${ys.def.name} closes the lantern's hood. Darkness.` : `${ys.def.name} opens the lantern's hood.`);
          }
          this.sightKey = '';
        },
      });
    }
    if (this.casting) out.push({ id: 'uncast', icon: '✕', label: 'Stop casting', ok: true, run: () => { this.casting = null; this.ui.update(this); } });
    const extra = [...ending.actions(this), ...magic.actions(this), ...skills.actions(this), ...traps.actions(this), ...treasure.actions(this)];
    for (const [group, script] of Object.entries(SCRIPTS)) if (script.actions && (!script.level || script.level === this.L.id)) extra.push(...script.actions(this, this.scriptState[group] ||= {}));
    return [...out, ...extra];
  }
  act(id) {
    if (this.dialogue) return;
    const a = this.actions().find((x) => x.id === id);
    if (!a || !a.ok) return;
    a.run();
    this.refreshPreview();
    this.ui.update(this);
  }

  // ---------- encounters (PLAN.md 3.2-3.4) ----------
  // Promise-based animation, as in the chopper: tween(seconds, fn(0..1)).
  tween(dur, fn) { return new Promise((res) => this.anims.push({ t: 0, dur, fn, res })); }
  sleep(ms) { return this.tween(ms / 1000, () => {}); }
  // Walk a unit along a route and wait for it to get there.
  walk(u, route) {
    if (!route || route.length < 2) return Promise.resolve();
    return new Promise((res) => { u.route = route; u.k = 0; u.wait = 0; u.done = res; });
  }
  // Roll a die across the table, from (x0, z0) toward (x1, z1): it bounces, tumbles and settles,
  // and its number pops up as it stops. The result is already decided; this shows it.
  // kind: 'd20' or 'd6'; tint: its colour. Resolves when it has settled.
  rollDie(kind, value, [x0, z0], [x1, z1], tint = [0.85, 0.8, 0.68], dur = 0.75) {
    // the dice can be turned off, or hurried for reduced motion: the number still shows
    if (!this.prefs.showDice) { this.floats.push({ x: x1, z: z1, y: this.scene.floorH(this.dungeon.idx(Math.floor(x1), Math.floor(z1))) + 0.55, text: String(value), cls: `die ${kind}`, t: 0 }); return this.sleep(150); }
    if (this.prefs.reduceMotion) dur *= 0.35;
    this.sfx(kind === 'd20' ? 'dice_d20' : 'dice_d6', { x: x1, z: z1 });
    const die = { kind, value, x: x0, z: z0, y: 0.6, rx: 0, ry: 0, rz: 0, tint, life: 2.2,
      spin: [6 + Math.random() * 6, 5 + Math.random() * 6, 4 + Math.random() * 5] };
    this.dice.push(die);
    const floor = this.scene.floorH(this.dungeon.idx(Math.floor(x1), Math.floor(z1)));
    return this.tween(dur, (k) => {
      const e = 1 - (1 - k) ** 2;
      die.x = x0 + (x1 - x0) * e; die.z = z0 + (z1 - z0) * e;
      const r = kind === 'd20' ? 0.2 : 0.15;
      die.y = floor + r + Math.abs(Math.sin(k * Math.PI * 2.5)) * (1 - k) * 0.7;
      const f = (1 - k) ** 2;
      die.rx = die.spin[0] * f; die.ry = die.spin[1] * f; die.rz = die.spin[2] * f;
      if (k >= 1) this.floats.push({ x: die.x, z: die.z, y: floor + 0.55, text: String(value), cls: `die ${kind}`, t: 0 });
    });
  }
  float(u, text, cls) { this.floats.push({ x: u.x, z: u.z, y: this.scene.floorH(u.tile) + 1.4, text, cls, t: 0 }); }

  // A wandering monster takes a step (in exploration, as the clock runs: wanderers.js).
  onWanderStep(f, a, b) {
    const [x, y] = this.dungeon.xy(b);
    f.tile = b; f.x = x + 0.5; f.z = y + 0.5; f.yaw = Math.atan2(-(b % this.dungeon.W - a % this.dungeon.W), ((b / this.dungeon.W) | 0) - ((a / this.dungeon.W) | 0));
    traps.onEnter(this, f, a, b);
  }

  // A denizen appears that wasn't there (the rat in the coffin).
  spawn(kind, i, group, hp, state = 'resting') {
    const [x, y] = this.dungeon.xy(i);
    const f = { id: `${this.L.id}-${kind}${this.foes.length}`, def: MONSTERS[kind], kind, side: 'foe', group, guard: false, loot: null,
      home: i, tile: i, x: x + 0.5, z: y + 0.5, yaw: 0, hp, maxHp: hp, state, alive: true, dead: false, fled: false, status: {}, spotted: false, on: null,
      route: null, k: 0, wait: 0, walk: 0, moving: 0, flash: 0, off: [0, 0], moved: false, acted: false };
    this.foes.push(f);
    (this.groups[group] ||= { count: 0, deaths: 0, first: false, half: false }).count++;
    return f;
  }

  // Something loud: room scripts may hear it (the orcs, PLAN.md 6.3).
  noise(i, r) { const [x, y] = this.dungeon.xy(i); this.runScripts('noise', x + 0.5, y + 0.5, r); }
  runScripts(hook, ...args) {
    for (const [group, script] of Object.entries(SCRIPTS)) {
      if (!script[hook] || (script.level && script.level !== this.L.id)) continue;
      script[hook](this, (this.scriptState[group] ||= {}), ...args);
    }
  }

  // Exploration -> encounter, when either side sees the other (PLAN.md 3.2).
  checkEncounter() {
    for (const f of this.foes) {
      if (!f.alive || f.fled || ASIDE.has(f.state) || f.def.npc || f.status.asleep) continue;
      // in the cult's robes, the party passes for cultists until it's close (PLAN.md 6.3, room 15)
      if (this.state.robesOn && f.def.cult && f.state !== 'alert' && !this.party.some((m) => !m.dead && this.distTo(m.tile, f.tile) <= 3)) continue;
      const seen = this.visible[f.tile];
      const sees = this.party.some((m) => !m.dead && canSee(this, f, m));
      if (seen || sees) { this.startEncounter(f.group, {}); return; }
    }
  }

  // Start an encounter with a group. surprise can be forced by a room script; otherwise each side
  // rolls (PLAN.md 3.2).
  startEncounter(group, { partySurprised, foesSurprised } = {}) {
    if (this.mode === 'encounter') { for (const f of this.foes) if (f.group === group && f.state !== 'hidden') this.enc.groups.add(group); return; }
    const d = this.dungeon;
    // everyone stops where they are: the tile they're passing through, or the one they just left,
    // whichever nobody else has taken
    const taken = new Set(this.party.filter((m) => !m.route && !m.dead).map((m) => m.tile));
    for (const m of this.party) {
      if (!m.route) continue;
      const a = m.route[Math.floor(m.k)], b = m.route[Math.min(m.route.length - 1, Math.ceil(m.k))];
      const near = Math.round(m.k) === Math.ceil(m.k) ? [b, a] : [a, b];
      m.route = null;
      m.tile = near.find((i) => !taken.has(i)) ?? this.freeTileNear(near[0], m);
      taken.add(m.tile);
      [m.x, m.z] = d.xy(m.tile).map((v) => v + 0.5);
    }
    this.pending = null; this.target = -1; this.preview = null;
    const ps = partySurprised ?? surprise(this.rng).ok, fs = foesSurprised ?? surprise(this.rng).ok;
    this.mode = 'encounter';
    this.enc = { groups: new Set([group]), round: 0, phase: null, surprised: { party: ps, foes: fs }, init: null };
    // (the slime keeps eating, Odric keeps to his rite, and the gecko to its chain)
    for (const f of this.foes) if (f.group === group && !ASIDE.has(f.state) && !['feeding', 'ritual', 'chained', 'looping'].includes(f.state)) f.state = 'fighting';
    // the shaft of sunlight in 23 dazzles the party on the first round (PLAN.md 6.3)
    if (this.party.some((m) => !m.dead && this.dungeon.roomOf(m.tile)?.id === '23')) this.enc.glare = true;
    // a room script may bring others in first (Odric's dead, the gecko)
    this.runScripts('start', group);
    const what = this.foeList(this.activeFoes());
    this.sfx('sting_encounter');
    const cry = this.activeFoes()[0];
    if (cry) this.sfx(`mon_${{ underpriest: 'priest', kithar: 'priest', odric: 'priest', archdeaconess: 'priest', skeleton: 'skeleton', lizardman: 'lizardman' }[cry.kind] || cry.kind}`, cry);
    this.bark(this.leader, 'spotted', 0.7);
    this.tip('fight');
    this.say(`Encounter: ${what}!${ps && !fs ? ' The party is caught by surprise.' : ''}${fs && !ps ? ' They are taken by surprise.' : ''}`);
    this.ui.banner?.(`${what}${ps && !fs ? ' — surprised!' : fs && !ps ? ' — they are surprised' : ''}`);
    this.selected = null;
    this.ui.bestiary?.(this);
    this.runEncounter();
  }
  // "Kithar, Kerzen and Ojar", "4 goblins", "Odric, 3 skeletons and a giant gecko"
  foeList(foes) {
    const by = new Map();
    for (const f of foes) by.set(f.def.proper ? f.def.name : MONSTERS[f.kind].name, (by.get(f.def.proper ? f.def.name : MONSTERS[f.kind].name) || 0) + (f.def.proper ? 0 : 1));
    const parts = [...by].map(([name, n]) => (n === 0 ? name : n === 1 ? `a ${name.toLowerCase()}` : `${n} ${name.toLowerCase().replace(/y$/, 'ie')}s`.replace('mans', 'men')));
    const s = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || 'nothing';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  activeFoes() { return this.foes.filter((f) => this.enc?.groups.has(f.group) && f.alive && !f.fled && !ASIDE.has(f.state)); }
  ableParty() { return this.party.filter((m) => this.canAct(m)); }

  // The round loop: group initiative each round, the winning side's phase, then the other's.
  async runEncounter() {
    while (this.mode === 'encounter') {
      const e = this.enc;
      e.round++;
      this.roundsFought++;
      for (const u of this.units) { u.moved = false; u.acted = false; u.moveMode = null; u.hits = null; }
      e.init = initiative(this.rng);
      // zombies are slow: they always lose initiative (B/X); a setting can give the party it always
      if (this.prefs.partyFirst || (this.activeFoes().length && this.activeFoes().every((f) => f.def.slow))) e.init.partyFirst = true;
      const order = e.init.partyFirst ? ['party', 'foes'] : ['foes', 'party'];
      // the initiative dice: brass for the party, red for the foes
      if (this.activeFoes().length) {
        const L = this.leader, f = this.activeFoes().find((x) => this.foeShown(x)) || L;
        const mx = (L.x + f.x) / 2, mz = (L.z + f.z) / 2;
        await Promise.all([
          this.rollDie('d6', e.init.party, [L.x, L.z], [mx - 0.35, mz + 0.2], [0.7, 0.5, 0.18], 0.6),
          this.rollDie('d6', e.init.foes, [f.x, f.z], [mx + 0.35, mz - 0.2], [0.62, 0.12, 0.08], 0.6),
        ]);
      }
      if (this.activeFoes().length) this.say(`Round ${e.round}: initiative, party ${e.init.party}, foes ${e.init.foes}. ${e.init.partyFirst ? 'The party' : 'The foes'} act first.`);
      for (const side of order) {
        if (this.encounterOver()) break;
        if (e.round === 1 && e.surprised[side === 'party' ? 'party' : 'foes'] && !e.surprised[side === 'party' ? 'foes' : 'party']) {
          this.say(side === 'party' ? 'Surprised, the party can do nothing this round.' : 'The foes are surprised and do nothing this round.');
          continue;
        }
        if (side === 'party') await this.partyPhase(); else await this.foesPhase();
      }
      if (this.mode !== 'encounter') return;
      this.endRound();
      if (!this.encounterOver()) this.autosave?.();
      if (this.encounterOver()) { this.endEncounter(); return; }
    }
  }
  // (someone bleeding keeps the rounds going, so they can be bandaged in time; not on Story)
  encounterOver() { return !this.activeFoes().length && !this.swarm && !(this.difficulty !== 'story' && this.party.some((m) => m.downed && !m.dead)) || !this.ableParty().length; }

  partyPhase() {
    return new Promise((res) => {
      this.enc.phase = 'party';
      this.enc.endPhase = res;
      // retching from a locust's spit costs the whole round
      for (const m of this.party) if (m.status.retching) { delete m.status.retching; m.acted = m.moved = true; this.say(`${m.def.name} is doubled over, retching.`); }
      const first = this.order.map((id) => this.member(id)).find((m) => this.canAct(m) && !m.acted);
      this.selected = first?.id ?? null;
      this.runScripts('partyPhase');
      this.attackPlan = null;
      this.ui.update(this);
    });
  }
  endPhase() {
    if (this.enc?.phase !== 'party' || this.busy) return;
    this.enc.phase = null; this.attackPlan = null; this.target = -1; this.preview = null;
    this.enc.endPhase();
  }
  // When every able hero has acted, the phase ends by itself.
  maybeEndPhase() {
    if (this.enc?.phase === 'party' && !this.ableParty().some((m) => !m.acted)) this.endPhase();
  }

  async foesPhase() {
    this.enc.phase = 'foes';
    this.ui.update(this);
    if (this.swarm) await this.swarmRound();
    for (const f of this.activeFoes()) {
      if (!f.alive || f.fled || this.mode !== 'encounter') continue;
      if (!this.ableParty().length) break;
      if (f.status.asleep || f.def.rig === 'slime' || ASIDE.has(f.state)) continue;
      // a guard holds the door unless the party comes into its room
      if (f.guard && !this.party.some((m) => this.dungeon.roomOf(m.tile) === this.dungeon.roomOf(f.home)) && !this.party.some((m) => this.inMelee(f.tile, m.tile))) continue;
      const plan = foeTurn(this, f);
      if (!plan) continue;
      const shown = this.foeShown(f);
      if (shown) { this.camera.goal = [f.x, f.z]; await this.sleep(250); }
      if (plan.route) {
        await this.freeAttacks(f, plan.route);
        if (!f.alive) continue;
        await this.walk(f, plan.route);
      }
      if (f.state === 'fleeing') {
        // out of sight and well away: gone
        if (!this.visible[f.tile]) { f.fled = true; this.say(`The ${f.def.name.toLowerCase()} flees out of sight.`); }
        continue;
      }
      if (plan.cast) await this.foeCast(f, plan.cast);
      else if (plan.spit) await this.spit(f, plan.spit);
      else if (plan.target) {
        // claw, claw, bite: each of a monster's attacks, while the target is still standing
        const n = f.def.attacks?.length || 1;
        for (let k = 0; k < n && !plan.target.dead && !plan.target.downed && f.alive; k++) await this.attack(f, plan.target, 'melee', k);
      }
      await this.sleep(shown ? 200 : 0);
    }
    this.enc.phase = null;
  }

  endRound() {
    magic.tickStatus(this, 1 / 6);
    traps.slimeRound(this);
    this.runScripts('round');
    for (const f of this.foes) if (f.status.turned && --f.status.turned <= 0) { delete f.status.turned; if (f.alive) f.state = 'fighting'; }
    // out of contact: nobody in sight on either side for a whole round ends the encounter, and
    // the foes still about go back to watching for the party
    const e = this.enc;
    const contact = this.activeFoes().some((f) => f.state === 'looping' || f.def.rig === 'slime' || this.visible[f.tile] || this.party.some((m) => !m.dead && canSee(this, f, m)));
    e.quiet = contact ? 0 : (e.quiet || 0) + 1;
    if (e.quiet >= 1 && this.activeFoes().length) {
      for (const f of this.activeFoes()) if (f.state === 'fighting') f.state = 'alert';
      e.groups.clear();
      this.say('The foes have drawn back out of sight.');
    }
    // the downed bleed (PLAN.md 3.4)
    for (const m of this.party) {
      if (!m.downed || m.dead || this.difficulty === 'story') continue;
      m.downed--;
      if (m.downed <= 0) { m.dead = true; m.light = null; this.say(`${m.def.name} dies.`); this.sightKey = ''; }
      else this.say(`${m.def.name} is bleeding: ${m.downed} round${m.downed === 1 ? '' : 's'} left to bandage them.`);
    }
    this.ui.update(this);
  }

  endEncounter() {
    if (!this.ableParty().length) {
      this.say('The party has fallen. Kollchap keeps its sword.');
      ending.finish(this, 'dead');
      return;
    }
    // anyone still standing who wasn't in the thick of it goes back to watching for the party
    for (const f of this.foes) if (f.alive && f.state === 'fighting') f.state = 'alert';
    this.mode = 'explore'; this.enc = null; this.selected = null; this.attackPlan = null;
    for (const m of this.party) { delete m.status.retching; delete m.status.held; }
    this.say('The fight is over.');
    // Story: the fallen get up when it's over
    if (this.difficulty === 'story') for (const m of this.party) if (m.downed && !m.dead) { m.downed = 0; m.hp = 1; this.say(`${m.def.name} staggers back up.`); }
    // what was shot or thrown can mostly be picked up again: daggers and sling stones, and half
    // the arrows (the rest break)
    let found = 0;
    for (const m of this.party) {
      if (!m.spent || m.dead) continue;
      const back = /bow/.test(m.def.missile.name) ? Math.floor(m.spent / 2) : m.spent;
      m.ammo = Math.min(m.def.missile.ammo, m.ammo + back); found += back; m.spent = 0;
    }
    if (found) this.say(`The party gathers up ${found} of the arrows, stones and daggers it loosed.`);
    this.runScripts('ended');
    this.sightKey = '';
    this.ui.update(this);
  }

  // ----- the party's phase: move, then act (or act, then move if they haven't yet) -----
  // Where the selected hero can still move to this round.
  reachFor(m) {
    if (!m || m.moved || !this.canAct(m) || m.status.slimed) return null;
    // sick (the centipede) or loaded down with treasure: half speed
    const base = m.def.mv >> ((m.status.sick ? 1 : 0) + (this.burdened ? 1 : 0)) || 1;
    const mv = m.moveMode === 'dash' ? base * 2 : m.moveMode === 'withdraw' ? Math.max(1, Math.floor(base / 2)) : base;
    return this.dungeon.reach(m.tile, mv, { closed: false, pits: false, blocked: this.blockedFor(m), known: this.fogOn ? this.explored : null, floorPits: this.floorPits() });
  }
  encounterPlan(goal) {
    const m = this.selected && this.member(this.selected);
    if (!m || this.enc?.phase !== 'party') return null;
    const f = this.foeAt(goal);
    if (f) return null;
    const reach = this.reachFor(m);
    if (!reach || reach[goal] === Infinity || goal === m.tile) return null;
    const p = this.dungeon.pathTo(m.tile, goal, { closed: false, pits: false, blocked: this.blockedFor(m), known: this.fogOn ? this.explored : null, floorPits: this.floorPits() });
    return p ? { path: p.tiles, full: p.tiles, door: -1, goal, cost: p.cost } : null;
  }
  async tapEncounter(i) {
    if (this.enc?.phase !== 'party') return;
    if (this.casting) { this.castAt(i); return; }
    const own = this.memberAt(i);
    if (own) { this.select(own.id); return; }
    const m = this.selected && this.member(this.selected);
    if (!m) return;
    const f = this.foeAt(i);
    if (f && f.alive) { this.attackPlan = this.planAttack(m, f); this.ui.update(this); return; }
    if (i === this.target && this.preview) {
      const route = this.preview.path;
      this.target = -1; this.preview = null; m.moved = true;
      if (m.moveMode === 'withdraw' || m.moveMode === 'dash') m.acted = true;
      if (m.moveMode !== 'withdraw') await this.freeAttacks(m, route);
      if (!m.dead && !m.downed) await this.walk(m, route);
      this.afterAction(m);
      return;
    }
    this.attackPlan = null;
    this.target = i; this.refreshPreview(); this.ui.update(this);
  }

  // What an attack would take, before it's made: weapon, every modifier and the odds
  // (PLAN.md 3.4: listed in the attack panel before you commit).
  planAttack(a, t, k = 0) {
    const d = this.dungeon, [ax, ay] = d.xy(a.tile), [tx, ty] = d.xy(t.tile);
    const dist = Math.hypot(ax - tx, ay - ty);
    const party = a.side === 'party';
    if (t.def.onlyFire) return { a, t, ok: false, why: 'Only fire will harm it' };
    let kind = this.inMelee(a.tile, t.tile) ? 'melee' : party && a.ammo > 0 ? 'missile' : null;
    const why = !kind ? (party ? `Out of ${a.def.missile.name} ammunition` : 'Too far') : null;
    if (!kind) return { a, t, ok: false, why };
    if (party && a.status.sick) return { a, t, ok: false, why: `${a.def.name} is too sick to fight` };
    const weapon = party ? (kind === 'melee' && a.weapon) || a.def[kind] : a.def.attacks?.[k] || { name: 'attack', dmg: a.def.dmg };
    const mods = [];
    let ok = true, reason = null;
    if (kind === 'missile') {
      const band = rangeMod(dist, weapon.range);
      if (band === null) { ok = false; reason = `Out of range for the ${weapon.name}`; }
      else if (!d.los(ax, ay, tx, ty)) { ok = false; reason = 'No clear line to shoot'; }
      else {
        if (band) mods.push({ label: band > 0 ? 'Short range' : 'Long range', value: band });
        if (mod(a.def.dex)) mods.push({ label: `DEX ${a.def.dex}`, value: mod(a.def.dex) });
      }
    } else if (party && mod(a.def.str)) mods.push({ label: `STR ${a.def.str}`, value: mod(a.def.str) });
    if (weapon.plus) mods.push({ label: weapon.name, value: weapon.plus });
    // the sun through the shaft in 23, in the eyes on the first round (PLAN.md 3.4)
    if (party && this.enc?.glare && this.enc.round === 1) mods.push({ label: 'Sun glare', value: -2 });
    if (this.swarm) mods.push({ label: 'Bat swarm', value: -2 });
    if (kind === 'melee' && a.status?.hidden) mods.push({ label: 'Backstab', value: 4 });
    if (t.status?.protection && a.def.align === 'C') mods.push({ label: 'Protection from Evil', value: -1 });
    // darkness: an attacker who can't see the target (PLAN.md 3.4)
    if (!this.lit[t.tile] && !(a.def.infravision)) mods.push({ label: 'In darkness', value: -4 });
    // from behind
    const fx = -Math.sin(t.yaw), fz = Math.cos(t.yaw), dx = ax - tx, dz = ay - ty, l = Math.hypot(dx, dz) || 1;
    if ((fx * dx + fz * dz) / l < -0.5) mods.push({ label: 'From behind', value: 2 });
    const base = party ? 19 : hitBase(a.def.hd);
    // Shield: AC 2 against missiles, 4 in melee (PLAN.md 3.4)
    const ac = t.status?.shield ? Math.min(t.def.ac, kind === 'missile' ? 2 : 4) : t.def.ac;
    // a sleeping, held or paralysed target is hit automatically
    const helpless = !!(t.status?.asleep || t.status?.paralysed || t.status?.held);
    return { a, t, kind, weapon, mods, base, ac, helpless, backstab: kind === 'melee' && !!a.status?.hidden,
      need: helpless ? 1 : Math.max(2, Math.min(20, base - ac - mods.reduce((s, m) => s + m.value, 0))), chance: helpless ? 1 : hitChance(base, ac, mods), ok, why: reason };
  }
  async confirmAttack() {
    const p = this.attackPlan;
    if (!p || !p.ok || this.enc?.phase !== 'party' || p.a.acted) return;
    this.attackPlan = null;
    p.a.acted = true;
    await this.attack(p.a, p.t, p.kind);
    this.afterAction(p.a);
  }
  afterAction(m) {
    if (this.encounterOver() && this.enc) { this.enc.phase = null; this.enc.endPhase?.(); return; }
    // next hero who still has something to do
    if (m.acted) {
      const next = this.order.map((id) => this.member(id)).find((x) => this.canAct(x) && !x.acted);
      if (next) this.selected = next.id;
    }
    this.refreshPreview();
    this.ui.update(this);
    this.maybeEndPhase();
  }

  // Make an attack: roll, lunge, and on a hit, damage (PLAN.md 3.4).
  async attack(a, t, kind, k = 0) {
    const p = this.planAttack(a, t, k);
    if (!p.ok) return;
    const d = this.dungeon, [ax, ay] = d.xy(a.tile), [tx, ty] = d.xy(t.tile);
    a.yaw = Math.atan2(-(tx - ax), ty - ay);
    if (kind === 'missile') { a.ammo--; a.spent = (a.spent || 0) + 1; }
    const r = attackRoll(this.rng, p.base, p.ac, p.mods);
    if (p.helpless) r.hit = true;
    // the d20, rolled out from the attacker's side toward the target
    const mx = (a.x + t.x) / 2, mz = (a.z + t.z) / 2, sx = -(t.z - a.z), sz = t.x - a.x, sl = Math.hypot(sx, sz) || 1;
    if (a.side === 'party') this.bark(a, 'attack', 0.3);
    this.sfx(kind === 'missile' ? (/bow/.test(p.weapon.name) ? 'bow' : /sling/.test(p.weapon.name) ? 'sling' : 'throw') : 'swing', a);
    await this.rollDie('d20', r.roll, [a.x + sx / sl * 0.4, a.z + sz / sl * 0.4], [mx + sx / sl * 0.55, mz + sz / sl * 0.55], a.side === 'party' ? [0.86, 0.8, 0.66] : [0.62, 0.12, 0.08], a.side === 'party' ? 0.75 : 0.5);
    // a lunge toward the target (a short jab for missiles)
    const dx = (tx - ax) / (Math.hypot(tx - ax, ty - ay) || 1), dz = (ty - ay) / (Math.hypot(tx - ax, ty - ay) || 1);
    const reach = kind === 'melee' ? 0.35 : 0.12;
    await this.tween(0.28, (k) => { const s = Math.sin(k * Math.PI) * reach; a.off = [dx * s, dz * s]; });
    a.off = [0, 0];
    this.noise(a.tile, 12);
    const who = a.side === 'party' ? a.def.name : `The ${a.def.name.toLowerCase()}`;
    const whom = t.side === 'party' ? t.def.name : `the ${t.def.name.toLowerCase()}`;
    const text = `d20 ${r.roll}, needed ${p.need}`;
    if (!r.hit) {
      this.sfx('miss', t);
      this.float(t, 'miss', 'miss');
      this.say(`${who} ${kind === 'missile' ? `shoots at ${whom}` : `attacks ${whom}`} and misses (${text}).`);
      this.ui.lastRoll?.({ ...p, roll: r });
      return;
    }
    const bonus = (a.side === 'party' && kind === 'melee' ? mod(a.def.str) : 0) + (p.weapon.plus || 0);
    let n = damage(this.rng, p.weapon.dmg, bonus) * (p.backstab ? 2 : 1);
    if (a.status?.hidden) skills.unhide(this, a, p.backstab ? 'strikes from the shadows: a backstab' : 'gives away their hiding place');
    // a sleeping foe struck in melee dies at once (B/X Sleep)
    if (p.helpless && kind === 'melee' && t.status?.asleep) n = Math.max(n, t.hp);
    const how = kind === 'missile' ? `hits ${whom} with the ${p.weapon.name}` : `hits ${whom}${a.side !== 'party' && p.weapon.name !== 'attack' ? ` (${p.weapon.name})` : ''}`;
    this.say(`${who} ${how} for ${n} (${p.helpless ? 'helpless' : text}${p.backstab ? ', backstab x2' : ''}).`);
    this.ui.lastRoll?.({ ...p, roll: r, dmg: n });
    this.sfx(t.def.ac <= 4 && t.def.rig !== 'rockman' ? 'clang' : /mace|club/.test(p.weapon.name) ? 'mace' : 'hit', t);
    this.hurt(t, n, a);
    if (t.side === 'party' && !t.dead) this.afflict(a, t, p.weapon);
  }

  hurt(u, n, by) {
    u.hp -= n; u.flash = 1;
    this.float(u, `-${n}`, 'dmg');
    if (u.side === 'party') {
      // Classic: 0 HP is death. Story: the downed aren't finished off
      if (u.hp <= 0 && this.difficulty === 'classic') { u.hp = 0; u.dead = true; u.downed = 0; u.light = null; this.bark(u, 'downed'); this.say(`${u.def.name} falls, and does not get up.`); this.float(u, 'slain', 'kill'); this.sightKey = ''; return; }
      if (u.downed && this.difficulty === 'story') { u.hp = 0; return; }
      if (u.downed) { u.dead = true; u.downed = 0; u.light = null; this.say(`${u.def.name} is killed.`); this.sightKey = ''; return; }
      if (u.hp <= 0) { u.hp = 0; u.downed = DOWNED_ROUNDS; this.bark(u, 'downed'); this.tip('downed'); this.say(`${u.def.name} falls, bleeding.`); this.float(u, 'downed', 'kill'); this.runScripts('downed', u); }
      else if (by?.def.disease && u.maxHp > 1) {
        const s = save(this.rng, u.def.cls, 'poison');
        if (!s.ok && !u.diseased) { u.diseased = true; u.maxHp--; this.say(`The bite festers: ${u.def.name} is diseased, -1 max HP until rested (${s.text}).`); }
      }
      if (u.hp > 0) this.bark(u, 'hurt', 0.4);
      return;
    }
    if (u.hp > 0) { if (u.status.asleep) { delete u.status.asleep; this.say(`The ${u.def.name.toLowerCase()} wakes with a howl.`); } return; }
    u.alive = false; u.dead = true; u.route = null;
    if (u.on) { delete u.on.status.slimed; u.on = null; }
    this.say(`${this.theName(u)} is slain.`);
    this.sfx(u.kind === 'skeleton' ? 'mon_skeleton_die' : 'body_fall', u);
    if (by?.side === 'party') this.bark(by, 'kill', 0.5);
    this.float(u, 'slain', 'kill');
    this.kills.push(u.def);
    this.runScripts('killed', u);
    const g = this.groups[u.group];
    g.deaths++;
    // morale: at the group's first death, and again when half are down (PLAN.md 3.4)
    const check = (!g.first && (g.first = true)) || (!g.half && g.deaths * 2 >= g.count && (g.half = true));
    const left = this.foes.filter((f) => f.group === u.group && f.alive && !f.fled && f.state !== 'hidden');
    if (check && left.length) {
      const r = moraleCheck(this.rng, left[0].def.ml);
      if (!r.broke) { this.say(`The ${u.group} stand firm (${r.text}).`); return; }
      this.say(`The ${u.group} break and run (${r.text})!`);
      if (SCRIPTS[u.group]?.broke?.(this, this.scriptState[u.group] ||= {})) return;
      for (const f of left) f.state = 'fleeing';
    }
  }

  // How a unit is named in the log: heroes and named denizens by name, the rest as "the orc".
  theName(u) { return u.side === 'party' || u.def.proper ? u.def.name : `The ${u.def.keepCase ? u.def.name : u.def.name.toLowerCase()}`; }

  // What a monster's hit does beyond damage (PLAN.md 3.4): the ghoul's paralysing touch, the
  // rockmen's petrifying fists (both landing in one round), the centipede's sickening bite.
  afflict(a, t, weapon) {
    if (t.downed || t.dead) return;
    if (weapon.paralyse && !t.status.paralysed) {
      const s = save(this.rng, t.def.cls, 'paralysis');
      if (s.ok) this.say(`${t.def.name} shrugs off the numbing touch (${s.text}).`);
      else { t.status.paralysed = roll(this.rng, '2d4') / 6; this.say(`${t.def.name} goes rigid: paralysed for ${Math.round(t.status.paralysed * 6)} rounds (${s.text}). Cure Light Wounds will free them.`); this.float(t, 'paralysed', 'kill'); }
    }
    if (a.def.petrify) {
      a.hits = a.hits?.t === t ? { t, n: a.hits.n + 1 } : { t, n: 1 };
      if (a.hits.n === 2) {
        const s = save(this.rng, t.def.cls, 'paralysis');
        if (s.ok) this.say(`Stone creeps over ${t.def.name}'s skin, and fades (${s.text}).`);
        else this.petrify(t, s);
      }
    }
    if (a.def.poison === 'sick' && !t.status.sick) {
      const s = save(this.rng, t.def.cls, 'poison');
      if (s.ok) this.say(`${t.def.name} feels the poison burn, and throws it off (${s.text}).`);
      else { t.status.sick = true; this.say(`The bite's poison takes hold: ${t.def.name} is sick, at half speed and unable to fight until the party makes camp (${s.text}).`); }
    }
  }
  // Turned to stone: out of the mission, a statue where they stood (PLAN.md 6.3: on Normal, until
  // the end of the mission).
  petrify(m, s) {
    m.dead = true; m.petrified = true; m.downed = 0; m.light = null; m.route = null;
    this.sfx('mon_rockman', m);
    this.say(`${m.def.name} turns to stone where they stand (${s.text})!`);
    this.float(m, 'stone', 'kill');
    this.sightKey = '';
  }
  // A locust's spit: save vs poison, or retch through the next round.
  async spit(f, t) {
    const d = this.dungeon, [fx, fy] = d.xy(f.tile), [tx, ty] = d.xy(t.tile);
    f.yaw = Math.atan2(-(tx - fx), ty - fy);
    f.spat = this.enc.round;
    this.sfx('mon_spit', f);
    await this.tween(0.3, (k) => { const s = Math.sin(k * Math.PI) * 0.12; f.off = [Math.sin(-f.yaw) * -s, Math.cos(f.yaw) * s]; });
    f.off = [0, 0];
    this.sparkle(t.x, t.z, 'spit');
    const s = save(this.rng, t.def.cls, 'poison');
    if (s.ok) this.say(`${this.theName(f)} spits foul juice at ${t.def.name}, who wipes it away (${s.text}).`);
    else { t.status.retching = true; this.say(`${this.theName(f)} spits foul juice in ${t.def.name}'s face: retching, they lose their next round (${s.text}).`); }
  }
  // A denizen's spell (PLAN.md 9): the Arch-deaconess's Hold Person, Kithar's Cure Light Wounds.
  async foeCast(f, { spell, target }) {
    (f.cast ||= {})[spell] = true;
    this.camera.goal = [f.x, f.z];
    await this.tween(0.5, (k) => { f.off = [0, Math.sin(k * Math.PI) * 0.001]; });
    this.sparkle(target.x, target.z, spell === 'hold' ? 'charm' : 'cure');
    this.sfx(spell === 'hold' ? 'spell_hold' : 'spell_cure', target);
    if (spell === 'hold') {
      // one person: the save is at -2 (B/X). Held, they are helpless for 1d4+2 rounds (a long
      // fight's worth; the book's 9 turns would end any fight on the spot)
      const s = save(this.rng, target.def.cls, 'spells'), ok = s.roll - 2 >= s.need;
      const text = `save vs spells at -2: d20 ${s.roll}, needed ${s.need + 2}`;
      if (ok) this.say(`${this.theName(f)} points at ${target.def.name} and speaks a word of binding. ${target.def.name} fights it off (${text}).`);
      else { target.status.held = (roll(this.rng, '1d4') + 2) / 6; this.say(`${this.theName(f)} points at ${target.def.name} and speaks a word of binding: Hold Person! ${target.def.name} cannot move (${text}).`); this.float(target, 'held', 'kill'); }
    } else if (spell === 'cure') {
      const n = roll(this.rng, '1d6+1'), was = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + n);
      this.float(target, `+${target.hp - was}`, 'heal');
      this.say(`${this.theName(f)} lays hands on ${this.theName(target).toLowerCase()} and prays: ${target.hp - was} wounds close.`);
    }
    await this.sleep(250);
  }

  // Bandage a downed ally beside you: back on their feet with 1 HP (PLAN.md 3.4).
  bandage(m, ally) {
    ally.downed = 0; ally.hp = 1;
    m.acted = true;
    this.say(`${m.def.name} binds ${ally.def.name}'s wounds. ${ally.def.name} is back on their feet with 1 HP.`);
    if (this.mode === 'encounter') this.afterAction(m); else this.ui.update(this);
  }

  // Leaving a fight: each awake enemy beside the mover gets a free blow as they go (PLAN.md 3.3:
  // B/X's fighting withdrawal avoids it).
  async freeAttacks(u, route) {
    if (!route || route.length < 2) return;
    const enemies = u.side === 'party'
      ? this.activeFoes().filter((f) => !f.status.asleep && f.def.rig !== 'slime')
      : this.party.filter((m) => !m.dead && !m.downed && !m.status.slimed);
    for (const e of enemies) {
      if (!this.inMelee(e.tile, u.tile) || this.inMelee(e.tile, route[1])) continue;
      if (u.dead || u.downed || (u.side === 'foe' && !u.alive)) return;
      this.say(`${e.side === 'party' ? e.def.name : `The ${e.def.name.toLowerCase()}`} gets a free blow as ${u.side === 'party' ? u.def.name : `the ${u.def.name.toLowerCase()}`} breaks away.`);
      await this.attack(e, u, 'melee');
    }
  }

  // A spell's target, tapped on the map.
  castAt(i) {
    const why = magic.targetProblem(this, i);
    if (why) { this.say(why); return; }
    const { caster, spell } = this.casting;
    magic.resolve(this, caster, spell, i);
  }

  encounterActions() {
    const out = [], e = this.enc, m = this.selected && this.member(this.selected);
    const mine = e?.phase === 'party' && !this.busy;
    out.push({ id: 'end', icon: '⏭', label: 'End the round', hint: 'The rest of the party waits', ok: mine, run: () => this.endPhase() });
    if (this.casting) out.push({ id: 'uncast', icon: '✕', label: 'Stop casting', ok: true, run: () => { this.casting = null; this.ui.update(this); } });
    if (m && mine && !m.moved && !m.acted && !m.moveMode) {
      out.push({ id: 'dash', icon: '⇶', label: 'Dash', hint: 'Twice as far, but no action', ok: true, run: () => { m.moveMode = 'dash'; this.ui.update(this); } });
      if (this.activeFoes().some((f) => this.inMelee(f.tile, m.tile) && !f.status.asleep)) {
        out.push({ id: 'withdraw', icon: '⇠', label: 'Withdraw', hint: 'Half a move, back out of the fight: no free blows', ok: true, run: () => { m.moveMode = 'withdraw'; this.ui.update(this); } });
      }
    }
    if (m && mine && !m.acted) {
      const hurt = this.party.find((x) => x.downed && !x.dead && x !== m && this.inMelee(m.tile, x.tile));
      if (hurt) out.push({ id: 'bandage', icon: '✚', label: `Bandage ${hurt.def.name}`, ok: true, run: () => this.bandage(m, hurt) });
      const door = this.activeDoor();
      if (door && !door.open && !door.key && this.adjacentTo(door.i).includes(m)) {
        out.push({ id: 'open', icon: '⊓', label: `Open ${this.doorName(door)}`, hint: 'Takes the action', ok: true, run: () => { m.acted = true; this.tryOpen(door.i); this.afterAction(m); } });
      }
      if (this.swarm && m.light === 'torch') out.push({ id: 'wave', icon: '🔥', label: 'Wave torch at the bats', hint: 'Scatters them on 1–3 in 6', ok: true, run: () => this.waveTorch(m) });
      if (!m.light && (m.torches || m.stub) && !this.data.DAYLIGHT) out.push({ id: 'light', icon: '🔥', label: `${m.def.name}: light torch`, hint: 'Takes the action', ok: true, run: () => { m.acted = true; this.lightTorch(m); this.sightKey = ''; this.afterAction(m); } });
    }
    return [...out, ...magic.actions(this), ...skills.actions(this), ...traps.actions(this)];
  }

  // ---------- the way down (PLAN.md 6.3: the surface and the entrance tunnel) ----------
  near(i, r) { const [x, y] = this.dungeon.xy(i); return this.party.some((m) => { const [mx, my] = this.dungeon.xy(m.tile); return !m.dead && Math.max(Math.abs(mx - x), Math.abs(my - y)) <= r; }); }
  fixRope(m) {
    this.advance(10);
    this.state.rope = true;
    this.say(`${m.def.name} drives iron spikes into the lip of the hole and lets the rope down. The climb will be safe.`);
  }
  // Climbing down the 40 ft tunnel: a DEX check each, or a fall for 1d6 (none with the rope).
  // The hobgoblins won't let it happen while they watch.
  climbDown() {
    const watchers = this.foes.filter((f) => f.alive && f.state === 'watching');
    if (watchers.length) {
      this.say(`As ${this.leader.def.name} swings a leg over the edge, the hobgoblins leap up, swords out!`);
      this.startEncounter(watchers[0].group, {});
      return;
    }
    this.advance(10);
    for (const id of this.order) {
      const m = this.member(id);
      if (m.dead || this.state.rope) continue;
      const r = die(this.rng, 20);
      if (r <= m.def.dex) continue;
      const n = die(this.rng, 6);
      m.hp -= n;
      this.say(`${m.def.name} slips on the steep rock and falls, for ${n} damage (d20 ${r} against DEX ${m.def.dex}).`);
      if (m.hp <= 0) { m.hp = 0; m.downed = DOWNED_ROUNDS; this.say(`${m.def.name} lies still at the bottom.`); }
    }
    this.say(this.state.rope ? 'One by one the party lets itself down the rope into the dark.' : 'One by one the party clambers down the steep tunnel into the dark.');
    this.useLevel('dungeon', this.levels.dungeon.data.PARTY_START);
    this.state.wentDown = true;
    // light the way: the two torch-bearers, if nobody has a light yet
    if (!this.party.some((m) => m.light)) for (const id of START_LIGHTS) { const m = this.member(id); if (!m.dead && !m.downed) this.lightTorch(m); }
    this.sightKey = '';
    if (!this.state.batsGone) this.startSwarm();
  }
  climbUp() {
    this.advance(10);
    this.say('The party hauls itself back up the tunnel, into the open air.');
    const [hx, hy] = this.levels.surface.dungeon.xy(this.levels.surface.dungeon.links[0].a);
    this.useLevel('surface', this.standAround('surface', hx + 1, hy));
    ending.reachSurface(this);
  }
  // Odric's stairs, between room 15 and the trees behind the temple.
  takeStairs(to) {
    this.advance(5);
    const L = this.levels[to], link = L.dungeon.links.find((l) => l.kind === 'stairs'), [x, y] = L.dungeon.xy(link.a);
    if (to === 'surface') this.say('Up the narrow stairs, through a trapdoor under a fallen slab: the party comes out among the trees behind the temple.');
    else { this.say('Down the narrow stairs, into the changing room.'); this.state.wentDown = true; }
    this.useLevel(to, this.standAround(to, x, y));
    if (to === 'surface') ending.reachSurface(this);
  }
  // Free walkable tiles around (x, y) on a level, one for each in the marching order.
  standAround(id, x, y) {
    const d = this.levels[id].dungeon, out = [];
    for (let r = 0; out.length < this.order.length && r < 6; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || out.length >= this.order.length || !d.inside(x + dx, y + dy)) continue;
        const i = d.idx(x + dx, y + dy), t = TILE[d.t[i]];
        if (t.walk && !t.door && d.t[i] !== T.PIT && d.t[i] !== T.HOLE) out.push([x + dx, y + dy]);
      }
    }
    return out;
  }

  // The bats (PLAN.md 6.3): a shrieking swarm, not a set of monsters. While it lasts, everyone is
  // at -2 to hit (and can't cast); a torch waved at it scatters it. The racket carries.
  startSwarm() {
    this.swarm = { rounds: 2 + die(this.rng, 4) + die(this.rng, 4) };
    this.sfx('mon_bats');
    this.say('Leathery wings everywhere: a swarm of bats bursts from the roof of the tunnel!');
    this.ui.banner?.('Bats!');
    this.ui.bestiary?.(this);
    this.mode = 'encounter';
    this.enc = { groups: new Set(), round: 0, phase: null, surprised: { party: false, foes: false }, init: null };
    this.selected = null;
    this.runEncounter();
  }
  startRounds() {
    this.say(`${this.party.find((m) => m.downed && !m.dead).def.name} is down and bleeding: bandage them, quickly!`);
    this.mode = 'encounter';
    this.enc = { groups: new Set(), round: 0, phase: null, surprised: { party: false, foes: false }, init: null };
    this.selected = null;
    this.runEncounter();
  }
  async swarmRound() {
    const s = this.swarm;
    this.noise(this.leader.tile, 14);
    if (--s.rounds <= 0) { this.swarm = null; this.state.batsGone = true; this.say('The bats stream away up the tunnel, and the shrieking fades.'); }
    else this.say('The bats whirl and shriek about the party.');
    await this.sleep(400);
  }
  waveTorch(m) {
    m.acted = true;
    const r = inSix(this.rng, 3);
    if (r.ok) { this.swarm = null; this.state.batsGone = true; this.say(`${m.def.name} sweeps the torch through the swarm, and the bats scatter up the tunnel (${r.text}).`); }
    else this.say(`${m.def.name} waves the torch, but the bats keep coming (${r.text}).`);
    this.afterAction(m);
  }

  // ---------- pointer ----------
  hover(i) {
    if (i === this.hoverTile) return;
    this.hoverTile = i;
    if (this.target < 0) this.refreshPreview();
    this.ui.update(this);
  }

  // Tap a party member to select them (they then move alone); tap a tile once to preview the
  // walk there, and again to go.
  tap(i) {
    if (this.busy || this.dialogue) return;
    if (this.mode === 'encounter') { this.tapEncounter(i); return; }
    if (this.casting) { this.castAt(i); return; }
    // tapping a foe who isn't fighting yet (the watching hobgoblins): attack them
    const foe = i >= 0 && this.foeAt(i);
    if (foe && !foe.def.npc && !ASIDE.has(foe.state) || foe?.state === 'watching') { this.say(`The party goes for the ${foe.def.name.toLowerCase()}s!`); foe.state = 'fighting'; this.startEncounter(foe.group, {}); return; }
    const m = i >= 0 && this.memberAt(i);
    if (m && i !== this.target) { this.select(m.id); return; }
    if (i < 0 || !TILE[this.dungeon.t[i]].walk) { this.cancel(); return; }
    if (i === this.target && this.preview && !this.preview.blocked) { this.go(this.preview); return; }
    this.target = i;
    this.refreshPreview();
    this.ui.update(this);
  }

  cancel() { this.target = -1; this.refreshPreview(); this.ui.update(this); }
  choose(k) { dialogue.choose(this, k); }
  submit(text) { dialogue.submit(this, text); }

  refreshPreview() {
    const goal = this.target >= 0 ? this.target : this.hoverTile;
    this.previewGoal = goal;
    if (this.mode === 'encounter') { this.preview = !this.busy && goal >= 0 ? this.encounterPlan(goal) : null; return; }
    this.preview = !this.busy && goal >= 0 && this.known(goal) ? this.plan(goal) : null;
  }

  // ---------- camera ----------
  frameAll() {
    const c = this.camera;
    // far enough back that the whole width fits the screen, and the depth too
    const k = 2 * Math.tan(c.fov / 2);
    c.goal = [this.dungeon.W / 2, this.dungeon.H / 2 + 2.5];
    c.distGoal = clamp(Math.max(this.dungeon.W / (k * c.aspect), this.dungeon.H * Math.sin(c.pitch) / k) * 1.05, MIN_DIST, MAX_DIST);
  }
  focusParty(now = false) {
    const c = this.camera, m = this.mover;
    c.goal = [m.x, m.z]; c.distGoal = 14;
    if (now) { c.tx = m.x; c.tz = m.z; c.dist = 14; }
  }

  // ---------- per frame ----------
  update(dt) {
    this.time += dt;
    const c = this.camera, d = this.dungeon;
    if (c.goal) {
      const k = 1 - Math.exp(-dt * 5);
      c.tx += (c.goal[0] - c.tx) * k; c.tz += (c.goal[1] - c.tz) * k;
      if (Math.abs(c.goal[0] - c.tx) < 0.05 && Math.abs(c.goal[1] - c.tz) < 0.05) c.goal = null;
    }
    if (c.distGoal) {
      c.dist += (c.distGoal - c.dist) * (1 - Math.exp(-dt * 4));
      if (Math.abs(c.distGoal - c.dist) < 0.05) c.distGoal = null;
    }
    if (c.yawGoal !== null) {
      c.yaw += (c.yawGoal - c.yaw) * (1 - Math.exp(-dt * 9));
      if (Math.abs(c.yawGoal - c.yaw) < 0.002) { c.yaw = c.yawGoal; c.yawGoal = null; }
    }
    c.tx = clamp(c.tx, 0, d.W); c.tz = clamp(c.tz, 0, d.H);

    // walk each member along its route, a tile at a time; whoever leads keeps the clock
    for (let k = this.anims.length - 1; k >= 0; k--) {
      const a = this.anims[k];
      a.t += dt;
      const p = Math.min(1, a.t / a.dur);
      a.fn(p);
      if (p >= 1) { this.anims.splice(k, 1); a.res(); }
    }
    for (const u of this.units) u.flash = Math.max(0, u.flash - dt * 2.5);
    for (let k = this.dice.length - 1; k >= 0; k--) if ((this.dice[k].life -= dt) <= 0) this.dice.splice(k, 1);
    for (let k = this.floats.length - 1; k >= 0; k--) if ((this.floats[k].t += dt) > 1.6) this.floats.splice(k, 1);
    const wasBusy = this.units.some((m) => m.route), clockKeeper = this.pending?.actor;
    for (const m of this.units) {
      m.moving += ((m.route && m.wait <= 0 ? 1 : 0) - m.moving) * (1 - Math.exp(-dt * 10));
      if (!m.route) continue;
      if (m.wait > 0) { m.wait -= dt; continue; }
      const n = m.route.length - 1, before = Math.floor(m.k);
      m.k = Math.min(n, m.k + dt * WALK_SPEED);
      const a = Math.floor(m.k), b = Math.min(n, a + 1), f = m.k - a;
      const route = m.route;
      for (let s = before + 1; s <= a; s++) {
        traps.onEnter(this, m, route[s - 1], route[s]);
        this.footstep(m, route[s]);
        if (m.status?.hidden && this.lit[route[s]]) skills.unhide(this, m, 'steps into the light and is seen');
        if (m === clockKeeper && this.mode === 'explore') {
          // probing with the pole, or weighed down with treasure: half speed
          this.advance(minutesFor(this.stepCost(route[s - 1], route[s])) * (this.probing ? 2 : 1) * (this.burdened ? 2 : 1));
          this.ui.update(this);
        }
        if (m.route !== route) break; // the walk was cut short (a fall, the slime)
      }
      if (m.route !== route) continue;
      const [ax, ay] = d.xy(m.route[a]), [bx, by] = d.xy(m.route[b]);
      // the 9-18 tunnel isn't a step: jump to the far end
      const jump = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) > 1;
      const nx = lerp(ax, bx, jump ? (f > 0.5 ? 1 : 0) : f) + 0.5, nz = lerp(ay, by, jump ? (f > 0.5 ? 1 : 0) : f) + 0.5;
      if (Math.hypot(nx - m.x, nz - m.z) > 1e-4 && !jump) m.yaw = Math.atan2(-(nx - m.x), nz - m.z);
      m.walk += Math.hypot(nx - m.x, nz - m.z) * Math.PI * 1.1;
      m.x = nx; m.z = nz;
      if (m.k >= n) { m.tile = m.route[n]; m.route = null; m.done?.(); m.done = null; }
      if (m.side !== 'party') continue;
      const room = d.roomOf(this.eyeOf(m));
      if (room && (!room.passage || room.id === 'entrance' || room.id === 'temple') && !this.visited.has(room.id)) { this.visited.add(room.id); this.narrate(`room:${room.id}`); this.ui.viewKey = null; this.ui.update(this); this.wantSave = true; }
    }
    // close up, the camera (and so the cutaway) follows whoever is walking: the leader, or the
    // unit taking its turn
    const walker = clockKeeper?.route ? clockKeeper : this.units.find((u) => u.route && (u.side === 'party' || this.foeShown(u)));
    if (walker && c.dist < CUT_MAX_DIST) c.goal = [walker.x, walker.z];
    if (wasBusy && !this.units.some((m) => m.route) && this.mode === 'explore') this.arrived();
    // a new room reached: save once everyone has stopped
    if (this.wantSave && !this.units.some((m) => m.route) && !this.dialogue) { this.wantSave = false; this.autosave?.(); }
    // someone downed outside a fight (a fall): count the rounds, so they can be bandaged in time
    if (this.mode === 'explore' && !this.units.some((m) => m.route) && this.party.some((m) => m.downed && !m.dead)) this.startRounds();
    const key = this.sightState();
    if (key !== this.sightKey) {
      this.sightKey = key; this.updateSight();
      if (this.mode === 'explore') { this.runScripts('step'); this.checkEncounter(); }
    }
    this.updateFog(dt);
  }

  // ---------- drawing ----------
  // The cutaway's focus and radii for the shader, [x, z, inner, outer]; inner 0 turns it off.
  get focus() {
    const c = this.camera, on = !this.view.lowWalls && c.dist < CUT_MAX_DIST;
    return [c.tx, c.tz, on ? CUT_IN : 0, CUT_OUT];
  }
  // How far the wall at world (x, z) is lowered, 1 = to knee height: the shader's cutAt().
  cutAmount(x, z) {
    const [fx, fz, inner, outer] = this.focus, eye = this.camera._eye;
    if (inner <= 0 || !eye) return 0;
    const rx = x - fx, rz = z - fz, cx = eye[0] - fx, cz = eye[2] - fz, l = Math.hypot(cx, cz);
    const along = l > 0.001 ? (rx * cx + rz * cz) / l : rz;
    return (1 - smoothstep(inner, outer, Math.hypot(rx, rz))) * smoothstep(-1, -0.3, along);
  }
  // Height a view ray has to clear over tile i: the floor, or the wall top as currently drawn.
  surfaceH(i) {
    if (TILE[this.dungeon.t[i]].walk && !this.hiddenDoor(i)) return this.scene.floorH(i);
    const [x, y] = this.dungeon.xy(i);
    const h = this.scene.wallH;
    return lerp(h, Math.min(KNEE, h), this.cutAmount(x + 0.5, y + 0.5));
  }

  // This frame's lights: the fixed ones, then each carried flame.
  gatherLights() {
    const t = this.time, out = this.lights || (this.lights = []);
    out.length = 0;
    const add = (kind, x, y, z, seed) => {
      const k = LIGHT_KINDS[kind];
      let i = k.i, jx = 0, jz = 0;
      if (k.flicker) { const f = flicker(t, seed); i *= 1 + f * k.flicker * 1.6; jx = f * 0.25 * k.flicker; jz = flicker(t + 3.1, seed) * 0.25 * k.flicker; }
      if (k.pulse) i *= 0.85 + 0.15 * Math.sin(t * 1.3 + seed);
      out.push([x + jx, y, z + jz, k.r, k.col[0], k.col[1], k.col[2], i]);
    };
    (this.data.LIGHTS || []).forEach((l, n) => add(l.kind, l.at[0], l.h, l.at[1], n * 7.7));
    this.party.forEach((m, n) => {
      if (m.flame) add(m.light, m.flame[0], m.flame[1], m.flame[2], 1.234 + n * 3.3);
      if (m.status.lightSpell && !m.dead) add('spell', m.x, this.scene.floorH(this.eyeOf(m)) + 1.6, m.z, n);
    });
    return out;
  }

  // Dust motes hanging in the light of the carried flames: a few per tile near each, fixed to the
  // world and drifting slowly down, and streaming toward a hidden door nearby (PLAN.md 3.6).
  addMotes() {
    const d = this.dungeon, out = this.motes, t = this.time;
    out.clear();
    const flames = this.party.filter((m) => m.flame).map((m) => [...m.flame, LIGHT_KINDS[m.light].r]);
    if (!flames.length) return;
    let x0 = d.W, x1 = 0, z0 = d.H, z1 = 0;
    for (const [lx, , lz] of flames) { x0 = Math.min(x0, lx - 4); x1 = Math.max(x1, lx + 4); z0 = Math.min(z0, lz - 4); z1 = Math.max(z1, lz + 4); }
    x0 = Math.max(0, Math.floor(x0)); x1 = Math.min(d.W - 1, Math.floor(x1)); z0 = Math.max(0, Math.floor(z0)); z1 = Math.min(d.H - 1, Math.floor(z1));
    for (let y = z0; y <= z1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * d.W + x;
      if (!TILE[d.t[i]].walk || (this.fogOn && !this.visible[i])) continue;
      const hint = this.hintAt(x + 0.5, y + 0.5);
      for (let k = 0; k < 2; k++) {
        const s = hash2(x * 7 + k, y * 13 - k), s2 = hash2(y * 5 + k, x * 3);
        let px = x + s + 0.25 * Math.sin(t * 0.21 + s * 40), pz = y + s2 + 0.25 * Math.cos(t * 0.17 + s2 * 40);
        if (hint) { const drift = ((t * 0.18 + s * 5) % 1) * 0.9 * hint[2]; px += hint[0] * drift; pz += hint[1] * drift; }
        const py = 0.15 + 1.75 * (1 - ((s * 3.7 + t * 0.025 * (0.5 + s2)) % 1));
        let q = 0;
        for (const [lx, ly, lz, r] of flames) q = Math.max(q, 1 - ((px - lx) ** 2 + (py - ly) ** 2 + (pz - lz) ** 2) / (r * r));
        if (q <= 0) continue;
        const tw = 0.55 + 0.45 * Math.sin(t * 1.3 + s * 30);
        out.push(px, py, pz, 0.016, 1, 0.78, 0.5, q * q * tw * 0.9);
      }
    }
  }

  frame(renderer, cssW, cssH) {
    const d = this.dungeon, cam = this.camera.matrices(cssW, cssH);
    for (const s of Object.values(this.dyn)) s.clear();
    this.decals.clear(); this.xray.clear();

    // the miniatures
    for (const m of this.party) {
      // the petrified stand where they were turned, a statue
      const h = this.scene.floorH(this.eyeOf(m)), lying = (m.dead && !m.petrified) || m.downed > 0 || !!m.status.stricken;
      const lit = m.light === 'lantern' ? (m.shut ? 'shut' : 'lantern') : m.light;
      const hint = lit === 'torch' ? this.hintAt(m.x, m.z) : null;
      if (hint && hint[2] > 0.3 && this.mode === 'explore') this.tip('secret');
      m.flame = drawHero(this.dyn, m.def, {
        x: m.x + m.off[0], z: m.z + m.off[1], y: h, yaw: m.yaw, walk: m.walk, moving: m.moving, breath: hash2(m.def.str, m.def.dex) * 6,
        light: lit, lean: hint ? [hint[0] * hint[2], hint[1] * hint[2]] : null, flash: m.flash, lying, hidden: !!m.status.hidden || !!m.status.bolted,
        robed: !!this.state.robesOn, stone: !!m.petrified, frozen: this.helpless(m), frost: !!m.status.paralysed,
        selected: this.selected === m.id, leader: !this.selected && this.order[0] === m.id && this.mode === 'explore',
      }, this.time);
      // a downed bearer's light drops and keeps burning on the floor (PLAN.md 3.5)
      if (lying && (lit === 'torch' || lit === 'lantern')) {
        m.flame = [m.x + 0.3, h + 0.12, m.z];
        this.dyn.sph.add(m.flame[0], h + 0.04, m.flame[2], 0.12, 0.16, 0.12, 0, [1, 0.55, 0.2], 4, 3);
      }
    }
    for (const f of this.foes) {
      // the slime shows on its wall when its tile is in sight (or on whoever it caught)
      const shown = f.def.rig === 'slime' ? f.alive && (f.on || this.visible[f.tile] || !this.fogOn) : this.foeShown(f);
      if (!shown) continue;
      const asleep = !!f.status.asleep;
      const pose = { x: f.x + f.off[0], z: f.z + f.off[1], y: this.scene.floorH(f.tile), yaw: f.yaw, walk: f.walk, moving: f.moving,
        breath: hash2(f.home, 3) * 6, foe: !f.status.charmed && !f.def.npc && !['surrendered', 'bound', 'ally'].includes(f.state), flash: f.flash,
        lying: f.dead || asleep || f.state === 'bound', asleep: asleep || f.state === 'bound',
        selected: this.attackPlan?.t === f, on: f.on, spotted: f.spotted, frozen: f.state === 'captive',
        chainTo: f.state === 'chained' && this.data.CIRCLE_12 ? this.data.CIRCLE_12.at : null };
      const rig = { slime: drawSlime, rat: drawRat, skeleton: drawSkeleton, rockman: drawRockman, lizard: drawLizard, centipede: drawCentipede, locust: drawLocust }[f.def.rig] || drawHero;
      rig(this.dyn, f.def, pose, this.time);
      // a sleeper's z's drift up now and then
      if (asleep && !f.dead && Math.floor(this.time * 0.8 + f.home) !== Math.floor((this.time - 1 / 60) * 0.8 + f.home)) this.float(f, 'z', 'zz');
    }

    // the oracle's eyes: lit once it has woken, burning while it thinks
    if (this.L.id === 'dungeon' && this.scriptState.oracle?.greeted && !this.state.statueGone && (!this.fogOn || this.visible[d.idx(30, 30)])) {
      const glow = this.oracleBusy ? 2.5 + Math.sin(this.time * 9) : 0.8;
      for (const ex of [-0.09, 0.09]) this.dyn.sph.add(30.5 + ex, 1.33, 30.5 + 0.24, 0.05, 0.035, 0.03, 0, [1, 0.75, 0.35], 4, glow);
    }
    // the prisoners: in their cells, and once freed, a huddle trailing the party
    for (const c of this.cells || []) {
      if (c.freed) continue;
      for (let k = 0; k < c.count; k++) {
        const [x, y] = c.at[k % c.at.length], j = d.idx(x, y);
        if (this.fogOn && !this.visible[j]) continue;
        const o = Math.floor(k / c.at.length) * 0.25;
        drawHero(this.dyn, recruits.VILLAGER, { x: x + 0.5 + o, z: y + 0.4 - o, y: this.scene.floorH(j), yaw: Math.PI + hash2(x, y), walk: 0, moving: 0, breath: k * 1.7 + x, foe: false }, this.time);
      }
    }
    if (this.escort && !this.escort.fled) {
      const e = this.escort, n = Math.min(e.count, 4);
      for (let k = 0; k < n; k++) {
        const a = k * 2.4 + 0.6, r = k ? 0.28 : 0;
        drawHero(this.dyn, recruits.VILLAGER, { x: e.x + Math.cos(a) * r, z: e.z + Math.sin(a) * r, y: this.scene.floorH(this.eyeOf(e)), yaw: e.yaw, walk: e.walk + k, moving: e.moving, breath: k * 2.3, foe: false }, this.time);
      }
    }
    // dice on the table
    for (const die of this.dice) {
      const fade = Math.min(1, die.life * 2), s = (die.kind === 'd20' ? 0.42 : 0.3) * fade;
      if (die.kind === 'd20') this.dyn.ico.add(die.x, die.y, die.z, s, s, s, die.ry, die.tint, 0, 0.08, die.rx, die.rz);
      else this.dyn.box.add(die.x, die.y - s / 2, die.z, s, s, s, die.ry, die.tint, 0, 0.08, die.rx, die.rz);
    }
    // the bat swarm, wheeling about the party
    if (this.swarm) {
      let cx = 0, cz = 0, n = 0;
      for (const m of this.party) if (!m.dead) { cx += m.x; cz += m.z; n++; }
      cx /= n || 1; cz /= n || 1;
      const BAT = [0.03, 0.025, 0.022];
      for (let k = 0; k < 11; k++) {
        const s = hash2(k, 17), t = this.time * (1.2 + s) + s * 20;
        const r = 0.6 + 2 * hash2(k, 5), bx = cx + Math.cos(t) * r + Math.sin(t * 2.3) * 0.3, bz = cz + Math.sin(t) * r * 0.7;
        const by = 1.2 + 0.5 * Math.sin(t * 1.7 + k), flap = Math.sin(this.time * 22 + k * 3) * 0.9, yaw = -t;
        this.dyn.sph.add(bx, by, bz, 0.09, 0.08, 0.12, yaw, BAT);
        for (const side of [-1, 1]) this.dyn.box.add(bx + Math.cos(yaw) * side * 0.12, by + 0.03, bz + Math.sin(yaw) * side * 0.12, 0.2, 0.01, 0.12, yaw, BAT, 0, 0, side * flap, 0);
      }
    }
    // hover frame, path dots and goal ring; the path also shows faintly through walls
    const mark = (i, shape, size, col, a, p = 0.15, list = this.decals) => {
      const [x, y] = d.xy(i);
      list.push(x + 0.5, this.scene.floorH(i) + 0.02, y + 0.5, 0, size, size, shape, 0, col[0], col[1], col[2], a, p, i, 0, 0);
    };
    if (this.hoverTile >= 0) mark(this.hoverTile, 3, 0.98, [0.95, 0.85, 0.55], 0.9, 0.08);
    // spells at work: Shield (blue), Protection from Evil (gold), a charmed foe (green), the Light
    // spell's glow, the hidden thief (a faint dashed ring), and evil sensed through walls
    for (const m of this.party) {
      if (m.dead) continue;
      if (m.status.shield) mark(m.tile, 1, 0.92, [0.45, 0.65, 1], 0.7, 0.06);
      if (m.status.protection) mark(m.tile, 1, 0.84, [1, 0.82, 0.35], 0.6, 0.05);
      if (m.status.hidden) mark(m.tile, 9, 0.9, [0.5, 0.5, 0.6], 0.5, 0.05);
      if (m.status.lightSpell) this.dyn.sph.add(m.x, this.scene.floorH(m.tile) + 1.45, m.z, 0.16, 0.16, 0.16, 0, [0.85, 0.9, 1], 4, 2.2);
      if (m.status.slimed) mark(m.tile, 8, 0.95, [0.3, 0.9, 0.2], 0.6, m.status.slimed);
    }
    for (const f of this.foes) if (f.status.charmed && f.alive) mark(f.tile, 1, 0.9, [0.4, 1, 0.5], 0.7, 0.06);
    if (this.detectEvil) {
      for (const f of this.foes) if (f.alive && f.def.align === 'C' && this.distTo(f.tile, this.leader.tile) <= 24) mark(f.tile, 9, 0.9, [1, 0.15, 0.1], 0.75, 0.1, this.xray);
    }
    if (this.heard && this.time < this.heard.until) for (const i of this.heard.tiles) mark(i, 8, 0.8, [1, 0.3, 0.25], 0.5, 0.2, this.xray);
    // the sword hums near Chaos: a pulsing ring on the wielder's base, and a mark on the side the
    // nearest one is, stronger as it closes (PLAN.md 5)
    const h = ending.hum(this);
    if (h) {
      const k = 1 - h.dist / ending.HUM_RANGE, pulse = 0.5 + 0.5 * Math.sin(this.time * (6 + 10 * k));
      mark(h.w.tile, 9, 0.98, [0.55, 0.75, 1], 0.4 + 0.5 * k * pulse, 0.08);
      const [wx, wy] = d.xy(h.w.tile);
      this.decals.push(wx + 0.5 + h.dx * 0.62, this.scene.floorH(h.w.tile) + 0.03, wy + 0.5 + h.dz * 0.62, 0, 0.3, 0.3, 2, 0, 0.6, 0.85, 1, 0.5 + 0.5 * k * pulse, 0.4, h.w.tile, 0, 0);
    }
    // in an encounter: where the selected hero can still move, and a ring under them
    if (this.mode === 'encounter' && this.enc?.phase === 'party' && !this.busy) {
      const m = this.selected && this.member(this.selected), reach = this.reachFor(m);
      if (reach) for (let i = 0; i < d.n; i++) if (reach[i] < Infinity && i !== m.tile) mark(i, 0, 0.94, [0.55, 0.75, 1], 0.16, 0.25);
      if (m) mark(m.tile, 9, 0.95, [0.6, 0.85, 1], 0.9, 0.1);
    }
    const goal = this.previewGoal;
    if (this.preview && !this.preview.blocked) {
      const t = this.preview.full;
      for (let k = 1; k < t.length - 1; k++) {
        const past = k >= this.preview.path.length; // beyond the door the walk stops at
        mark(t[k], 2, past ? 0.22 : 0.32, past ? [0.8, 0.7, 0.55] : [1, 0.78, 0.3], past ? 0.55 : 0.95, 0.3);
        mark(t[k], 2, 0.26, [1, 0.78, 0.3], 0.35, 0.3, this.xray);
      }
      if (this.preview.door >= 0) mark(this.preview.door, 3, 0.9, [1, 0.6, 0.25], 0.95, 0.12);
      mark(goal, this.target >= 0 ? 9 : 1, 0.9, [1, 0.78, 0.3], 0.95, 0.14);
      mark(goal, 1, 0.8, [1, 0.78, 0.3], 0.35, 0.14, this.xray);
    } else if (goal >= 0 && !this.busy && this.known(goal) && !this.memberAt(goal)) {
      mark(goal, 1, 0.8, [1, 0.3, 0.2], 0.8, 0.14);
    }

    const sun = this.data.SUN && !this.view.mapLight ? this.data.SUN : null;
    const amb = this.view.mapLight ? MAP_LIGHT : sun ? { key: sun.col, sky: sun.sky, ground: sun.ground } : DARK;
    const lights = this.gatherLights();
    this.addMotes();
    for (let k = (this.sparkles || []).length - 1; k >= 0; k--) {
      const sp = this.sparkles[k];
      sp.t += 1 / 60;
      if (sp.t > 1.2) { this.sparkles.splice(k, 1); continue; }
      const col = { sleep: [0.6, 0.6, 1], missile: [1, 0.5, 1], cure: [0.5, 1, 0.6], light: [1, 1, 0.9], charm: [1, 0.5, 0.7] }[sp.kind] || [1, 0.85, 0.5];
      for (let n = 0; n < 18; n++) {
        const a = n * 2.4 + sp.t * 3, r = sp.t * (0.6 + hash2(n, 7)), h = this.scene.floorH(this.dungeon.idx(Math.floor(sp.x), Math.floor(sp.z)));
        this.motes.push(sp.x + Math.cos(a) * r, h + 0.3 + sp.t * (0.8 + hash2(n, 3)), sp.z + Math.sin(a) * r, 0.04, col[0], col[1], col[2], (1.2 - sp.t) * 1.5);
      }
    }
    renderer.render({
      viewProj: cam.vp, camPos: cam.eye, camRight: cam.right, camUp: cam.up,
      mapW: d.W, mapH: d.H, time: this.time, keyDir: sun ? sun.dir : KEY_DIR, keyCol: amb.key, sky: amb.sky, ground: amb.ground, sun: !!sun,
      // versions carry the level's id, so switching levels always re-uploads
      lights, walls: this.walls, wallsVersion: `${this.L.id}${this.wallsVersion}`,
      fog: this.fog, fogVersion: `${this.L.id}${this.fogVersion}`, fogOn: this.fogOn, focus: this.focus,
      inlay: this.data.CIRCLE_12 ? [...this.data.CIRCLE_12.at, this.data.CIRCLE_12.r, 0] : [0, 0, 0, 0], shafts: this.shafts, motes: this.motes,
      staticSets: this.scene.sets, staticVersion: `${this.L.id}${this.scene.version}`, staticDecals: this.staticDecals, staticDecalsVersion: `${this.L.id}${this.staticDecalsVersion}`,
      dynSets: this.dyn, decals: this.decals, xray: this.xray,
    });
  }
}

// The current level's own state, read and written through the game.
for (const key of PER_LEVEL) {
  Object.defineProperty(Game.prototype, key, { get() { return this.L[key]; }, set(v) { this.L[key] = v; } });
}
