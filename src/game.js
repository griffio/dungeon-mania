import { Dungeon, TILE, T, LINK_COST } from './dungeon.js';
import { Camera, Instances, FlatList, KNEE } from './renderer.js';
import { SceneBuilder } from './scene.js';
import { clamp, lerp, hash2, makeRng } from './util.js';
import { LIGHTS, SHAFTS, CIRCLE_12, PARTY_START } from './dungeon-data.js';
import { LIGHT_KINDS, PARTY, START_ORDER, START_LIGHTS, TORCH_MINUTES, OIL_MINUTES } from './defs.js';
import { inSix, percent, doorChance, searchChance, minutesFor, SMASH_BREAK, mod } from './rules.js';
import { groupTargets } from './party.js';
import { drawHero } from './models.js';
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

export class Game {
  constructor({ ui, seed = (Math.random() * 1e9) | 0 }) {
    this.ui = ui;
    this.rng = makeRng(seed);
    const d = (this.dungeon = new Dungeon());
    this.camera = new Camera();
    this.scene = new SceneBuilder(d);
    this.view = { lowWalls: false, tintRooms: false, labels: true, secrets: false, mapLight: false };
    this.dyn = { box: new Instances(256), cyl: new Instances(128), sph: new Instances(128), cone: new Instances(16) };
    this.decals = new FlatList(16, 256);
    this.xray = new FlatList(16, 256);
    this.motes = new FlatList(8, 256);
    this.shafts = new Instances(4);
    this.time = 0;
    this.clock = 0; // dungeon minutes since the party came down the tunnel
    this.log = [];
    this.searches = new Map(); // door (or 'lever') -> searches made for it
    this.state = { casesMoved: false, leverFound: false, leverPulled: false };
    this.visited = new Set();

    // the party, in marching order, front to back
    this.order = [...START_ORDER];
    this.party = PARTY.map((def) => {
      const [x, y] = PARTY_START[START_ORDER.indexOf(def.id)];
      return {
        def, id: def.id, tile: d.idx(x, y), x: x + 0.5, z: y + 0.5, yaw: Math.PI / 2, // facing west, into the dungeon
        route: null, k: 0, wait: 0, walk: 0, moving: 0,
        light: null, torchLeft: 0, torches: def.kit.torches, stub: 0,
        oil: def.kit.lantern ? OIL_MINUTES : 0, flasks: def.kit.oil || 0, shut: false, broken: false, flame: null,
      };
    });
    for (const id of START_LIGHTS) this.lightTorch(this.member(id), true);
    this.selected = null;
    this.hoverTile = -1; this.target = -1; this.preview = null; this.pending = null; this.focusDoor = -1;

    this.staticDecalsVersion = 0;
    this.rebuild();
    this.updateWalls();
    for (const sh of SHAFTS) {
      const [x, z] = sh.at, i = d.idx(Math.floor(x), Math.floor(z));
      this.shafts.add(x, this.scene.floorH(i), z, sh.r * 2, sh.len, sh.r * 2, sh.yaw, sh.col, 0, sh.i, -sh.lean);
    }
    // fog of war: what the party sees now, what it has seen, and the eased values drawn
    const n = d.n;
    this.lit = new Uint8Array(n); this.visible = new Uint8Array(n); this.explored = new Uint8Array(n); this.sightTmp = new Uint8Array(n);
    this.fogCur = new Float32Array(n * 2); this.fog = new Uint8Array(n * 4); this.fogVersion = 0; this.exploredVersion = 0;
    this.sightKey = '';
    this.updateSight();
    this.say('The party climbs down the tunnel into the dark. Brannoc leads; Ysolde and Fennick carry torches.');
    this.focusParty(true);
  }

  // ---------- the party ----------
  member(id) { return this.party.find((m) => m.id === id); }
  get leader() { return this.member(this.order[0]); }
  get mover() { return this.selected ? this.member(this.selected) : this.leader; }
  get busy() { return this.party.some((m) => m.route); }
  memberAt(i) { return this.party.find((m) => m.tile === i); }
  // the tile a member is on, or passing through
  eyeOf(m) { return m.route ? m.route[Math.min(Math.round(m.k), m.route.length - 1)] : m.tile; }

  select(id) {
    if (this.busy) return;
    this.selected = this.selected === id ? null : id;
    this.cancel();
  }

  // Swap two places in the marching order.
  swapOrder(a, b) {
    const o = this.order, i = o.indexOf(a), j = o.indexOf(b);
    if (i < 0 || j < 0 || i === j) return;
    [o[i], o[j]] = [o[j], o[i]];
    this.say(`Marching order: ${o.map((id) => this.member(id).def.name).join(', ')}.`);
    this.ui.update(this);
  }

  say(text) {
    this.log.push({ at: this.clock, text });
    if (this.log.length > 60) this.log.shift();
    this.ui?.update(this);
  }

  // ---------- time and light ----------
  // Let dungeon time pass: torches burn down and the lantern uses oil (PLAN.md 3.5, 3.7).
  advance(minutes) {
    this.clock += minutes;
    for (const m of this.party) {
      if (m.light === 'torch') {
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
    if (!quiet) this.say(`${m.def.name} lights a torch (${m.torches} left).`);
    return true;
  }

  // Lights the party carries, for sight: where they are and how far they reach.
  carriedLights() {
    const out = [];
    for (const m of this.party) {
      if (m.light !== 'torch' && !(m.light === 'lantern' && !m.shut)) continue;
      const [x, y] = this.dungeon.xy(this.eyeOf(m));
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
      d.sight(this.eyeOf(m), this.lit, this.sightTmp);
      for (let i = 0; i < d.n; i++) this.visible[i] |= this.sightTmp[i];
    }
    let found = false;
    for (let i = 0; i < d.n; i++) if (this.visible[i] && !this.explored[i]) { this.explored[i] = 1; found = true; }
    if (found) { this.exploredVersion++; this.ui.viewKey = null; }
  }
  // what decides sight: where everyone is and who is carrying a light
  sightState() { return this.party.map((m) => `${this.eyeOf(m)}${m.light === 'torch' || (m.light === 'lantern' && !m.shut) ? '*' : ''}`).join() + this.wallsVersion; }

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

  get fogOn() { return !this.view.mapLight; }
  known(i) { return !this.fogOn || this.explored[i] === 1; }
  // A secret door nobody has found is just wall, as far as the player can tell.
  hiddenDoor(i) { const door = this.dungeon.doors.get(i); return !!door && !door.found; }

  // Tiles light can't pass: rock and closed doors (bars and the pool let it through). The fixed
  // lights' reach changes with the doors too.
  updateWalls() {
    const d = this.dungeon;
    this.walls = this.walls || new Uint8Array(d.n);
    for (let i = 0; i < d.n; i++) { const [x, y] = d.xy(i); this.walls[i] = d.clear(x, y) ? 0 : 255; }
    this.wallsVersion = (this.wallsVersion || 0) + 1;
    this.fixedLit = d.light(LIGHTS.map((l) => ({ x: l.at[0], z: l.at[1], reach: LIGHT_KINDS[l.kind].reach })));
  }

  rebuild() {
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
    };
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
    this.pending = { door: plan.door, goal: plan.goal, actor: this.mover };
    if (plan.door >= 0) this.focusDoor = plan.door;
    const solo = !!this.selected;
    const start = (m, tiles, wait) => {
      if (!tiles || tiles.length < 2) return;
      m.route = tiles; m.k = 0; m.wait = wait;
    };
    if (solo) start(this.mover, plan.path, 0);
    else {
      const chain = this.order.map((id) => this.member(id).tile);
      const ok = (i) => TILE[d.t[i]].walk && !TILE[d.t[i]].door && this.known(i) && d.t[i] !== T.PIT;
      const targets = groupTargets(d, plan.path, chain, ok);
      const follow = { ...this.pathOpts(), closed: false };
      this.order.forEach((id, k) => {
        const m = this.member(id);
        if (k === 0) start(m, plan.path, 0);
        else if (targets[k] !== m.tile) start(m, d.pathTo(m.tile, targets[k], follow)?.tiles, k * FOLLOW_DELAY);
      });
    }
    this.target = -1; this.preview = null;
    if (!this.busy) this.arrived();
    this.ui.update(this);
  }

  // Everyone has stopped: shut the one-way block if nobody is in it, then deal with the door the
  // walk stopped at.
  arrived() {
    const d = this.dungeon;
    for (const door of d.doors.values()) {
      if (d.t[door.i] === T.BLOCK && door.open && !this.memberAt(door.i)) {
        door.open = false;
        this.doorsChanged();
        this.say('With a heavy grinding, the stone block slides back into place.');
      }
    }
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
    if (door.key) { this.say(`The ${name} is locked.`); return false; }
    // the strongest of those at the door puts a shoulder to it
    const m = who.reduce((a, b) => (doorChance(b.def.str) > doorChance(a.def.str) ? b : a));
    const r = inSix(this.rng, doorChance(m.def.str));
    this.advance(1);
    if (!r.ok) { this.say(`${m.def.name} heaves at the ${name}, but it's stuck (${r.text}).`); return false; }
    door.open = true;
    this.say(`${m.def.name} forces the ${name} open (${r.text}).`);
    this.doorsChanged();
    return true;
  }
  closeDoor(door) {
    if (this.memberAt(door.i)) return;
    door.open = false;
    this.say(`The ${this.doorName(door)} is pulled shut.`);
    this.doorsChanged();
  }
  pickLock(door) {
    const m = this.member('fennick'), r = percent(this.rng, m.def.skills.openLocks);
    if (!r.ok) { this.advance(10); this.say(`Fennick works at the lock for a turn, without luck (${r.text}).`); this.ui.update(this); return; }
    this.advance(1);
    door.key = null;
    this.say(`The lock clicks under Fennick's picks (${r.text}).`);
    this.tryOpen(door.i);
  }
  smash(door) {
    const who = this.adjacentTo(door.i), m = who.reduce((a, b) => (mod(b.def.str) > mod(a.def.str) ? b : a));
    const r = percent(this.rng, SMASH_BREAK);
    this.advance(1);
    door.key = null; door.open = true; door.smashed = true;
    this.say(`${m.def.name} smashes the lock off the ${this.doorName(door)}. The noise echoes down the passages.`);
    if (r.ok && !m.broken) { m.broken = true; this.say(`${m.def.name}'s weapon cracks in the blow (${r.text}).`); }
    this.doorsChanged();
  }

  // ---------- searching ----------
  // Everyone searches around themselves for a turn: each hidden door or lever within reach is
  // found on 1 in 6, better each time it has been searched for (PLAN.md 3.6).
  search() {
    const d = this.dungeon;
    this.advance(10);
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
        this.say(`A secret door! The outline of a hidden ${h.door.key === 'lever' ? 'panel' : 'door'} shows in the stonework (${r.text}).`);
      }
    }
    if (!found) this.say('The party searches the walls and floor for a turn, and finds nothing.');
    this.doorsChanged();
  }
  pullLever() {
    const door = [...this.dungeon.doors.values()].find((x) => x.lever >= 0);
    this.state.leverPulled = true;
    door.found = true; door.key = null; door.open = true;
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
    // light: the selected member, or the first in line without one
    const sel = this.selected && this.member(this.selected);
    const dark = sel || this.order.map((id) => this.member(id)).find((m) => !m.light && (m.torches || m.stub));
    if (dark && dark.light !== 'torch' && (dark.torches || dark.stub)) {
      out.push({ id: 'light', icon: '🔥', label: `${dark.def.name}: light torch`, hint: `${dark.torches} torch${dark.torches === 1 ? '' : 'es'} left`, ok: idle, run: () => { this.lightTorch(dark); this.sightKey = ''; } });
    }
    if (sel && sel.light === 'torch') {
      out.push({ id: 'douse', icon: '◌', label: `${sel.def.name}: douse torch`, hint: 'Keeps the rest of it for later', ok: idle, run: () => { sel.stub = sel.torchLeft; sel.light = null; this.say(`${sel.def.name} douses the torch.`); this.sightKey = ''; } });
    }
    const ys = this.party.find((m) => m.def.kit.lantern);
    if (ys && (ys.oil > 0 || ys.flasks > 0)) {
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
    return out;
  }
  act(id) {
    const a = this.actions().find((x) => x.id === id);
    if (!a || !a.ok) return;
    a.run();
    this.refreshPreview();
    this.ui.update(this);
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
    if (this.busy) return;
    const m = i >= 0 && this.memberAt(i);
    if (m && i !== this.target) { this.select(m.id); return; }
    if (i < 0 || !TILE[this.dungeon.t[i]].walk) { this.cancel(); return; }
    if (i === this.target && this.preview && !this.preview.blocked) { this.go(this.preview); return; }
    this.target = i;
    this.refreshPreview();
    this.ui.update(this);
  }

  cancel() { this.target = -1; this.refreshPreview(); this.ui.update(this); }

  refreshPreview() {
    const goal = this.target >= 0 ? this.target : this.hoverTile;
    this.preview = !this.busy && goal >= 0 && this.known(goal) ? this.plan(goal) : null;
    this.previewGoal = goal;
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
    const wasBusy = this.busy, clockKeeper = this.pending?.actor;
    for (const m of this.party) {
      m.moving += ((m.route && m.wait <= 0 ? 1 : 0) - m.moving) * (1 - Math.exp(-dt * 10));
      if (!m.route) continue;
      if (m.wait > 0) { m.wait -= dt; continue; }
      const n = m.route.length - 1, before = Math.floor(m.k);
      m.k = Math.min(n, m.k + dt * WALK_SPEED);
      const a = Math.floor(m.k), b = Math.min(n, a + 1), f = m.k - a;
      for (let s = before + 1; s <= a; s++) {
        if (m !== clockKeeper) continue;
        this.advance(minutesFor(this.stepCost(m.route[s - 1], m.route[s])));
        this.ui.update(this);
      }
      const [ax, ay] = d.xy(m.route[a]), [bx, by] = d.xy(m.route[b]);
      // the 9-18 tunnel isn't a step: jump to the far end
      const jump = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) > 1;
      const nx = lerp(ax, bx, jump ? (f > 0.5 ? 1 : 0) : f) + 0.5, nz = lerp(ay, by, jump ? (f > 0.5 ? 1 : 0) : f) + 0.5;
      if (Math.hypot(nx - m.x, nz - m.z) > 1e-4 && !jump) m.yaw = Math.atan2(-(nx - m.x), nz - m.z);
      m.walk += Math.hypot(nx - m.x, nz - m.z) * Math.PI * 1.1;
      m.x = nx; m.z = nz;
      if (m.k >= n) { m.tile = m.route[n]; m.route = null; }
      const room = d.roomOf(this.eyeOf(m));
      if (room && !room.passage && !this.visited.has(room.id)) { this.visited.add(room.id); this.ui.viewKey = null; this.ui.update(this); }
    }
    // close up, the camera (and so the cutaway) follows whoever is leading
    if (this.busy && c.dist < CUT_MAX_DIST) { const m = clockKeeper || this.mover; c.goal = [m.x, m.z]; }
    if (wasBusy && !this.busy) this.arrived();
    const key = this.sightState();
    if (key !== this.sightKey) { this.sightKey = key; this.updateSight(); }
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
    LIGHTS.forEach((l, n) => add(l.kind, l.at[0], l.h, l.at[1], n * 7.7));
    this.party.forEach((m, n) => { if (m.flame) add(m.light, m.flame[0], m.flame[1], m.flame[2], 1.234 + n * 3.3); });
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
      const h = this.scene.floorH(this.eyeOf(m));
      const lit = m.light === 'lantern' ? (m.shut ? 'shut' : 'lantern') : m.light;
      const hint = lit === 'torch' ? this.hintAt(m.x, m.z) : null;
      m.flame = drawHero(this.dyn, m.def, {
        x: m.x, z: m.z, y: h, yaw: m.yaw, walk: m.walk, moving: m.moving, breath: hash2(m.def.str, m.def.dex) * 6,
        light: lit, lean: hint ? [hint[0] * hint[2], hint[1] * hint[2]] : null,
        selected: this.selected === m.id, leader: !this.selected && this.order[0] === m.id,
      }, this.time);
    }

    // hover frame, path dots and goal ring; the path also shows faintly through walls
    const mark = (i, shape, size, col, a, p = 0.15, list = this.decals) => {
      const [x, y] = d.xy(i);
      list.push(x + 0.5, this.scene.floorH(i) + 0.02, y + 0.5, 0, size, size, shape, 0, col[0], col[1], col[2], a, p, i, 0, 0);
    };
    if (this.hoverTile >= 0) mark(this.hoverTile, 3, 0.98, [0.95, 0.85, 0.55], 0.9, 0.08);
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

    const amb = this.view.mapLight ? MAP_LIGHT : DARK;
    const lights = this.gatherLights();
    this.addMotes();
    renderer.render({
      viewProj: cam.vp, camPos: cam.eye, camRight: cam.right, camUp: cam.up,
      mapW: d.W, mapH: d.H, time: this.time, keyDir: KEY_DIR, keyCol: amb.key, sky: amb.sky, ground: amb.ground,
      lights, walls: this.walls, wallsVersion: this.wallsVersion,
      fog: this.fog, fogVersion: this.fogVersion, fogOn: this.fogOn, focus: this.focus,
      inlay: [CIRCLE_12.at[0], CIRCLE_12.at[1], CIRCLE_12.r, 0], shafts: this.shafts, motes: this.motes,
      staticSets: this.scene.sets, staticVersion: this.scene.version, staticDecals: this.staticDecals, staticDecalsVersion: this.staticDecalsVersion,
      dynSets: this.dyn, decals: this.decals, xray: this.xray,
    });
  }
}
