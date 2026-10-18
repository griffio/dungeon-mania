import { Dungeon, TILE } from './dungeon.js';
import { Camera, Instances, FlatList, KNEE } from './renderer.js';
import { SceneBuilder } from './scene.js';
import { clamp, lerp, hash2 } from './util.js';
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
import { LIGHTS, SHAFTS, CIRCLE_12 } from './dungeon-data.js';
import { LIGHT_KINDS } from './defs.js';
import { MIN_DIST, MAX_DIST } from './input.js';

// The map viewer (M0) lit by torchlight under fog of war (M1). One token stands in for the
// party and carries the torch: hover or tap a tile to preview the path to it, tap the same tile
// again to walk there. The full game grows out of this class.
const KEY_DIR = [-0.45, 0.85, 0.3];
// The dungeon is dark; "map light" adds the M0 overview light back and lifts the fog, for
// looking at the whole map.
const MAP_LIGHT = { key: [0.55, 0.52, 0.46], sky: [0.32, 0.31, 0.3], ground: [0.1, 0.095, 0.09] };
const DARK = { key: [0, 0, 0], sky: [0.012, 0.013, 0.018], ground: [0.004, 0.004, 0.005] };
// Fire: a few out-of-step sines, so no two flames move together.
const flicker = (t, s) => 0.08 * Math.sin(t * 7.3 + s) + 0.05 * Math.sin(t * 17.9 + s * 2.1) + 0.04 * Math.sin(t * 31.3 + s * 5.7);
const WALK_SPEED = 5; // tiles per second
const FT_PER_TILE = 5, FT_PER_TURN = 120; // exploration: 120 ft per 10-minute turn
const FOG_RATE = 8; // how fast tiles fade in and out of sight, per second
// Cutaway around the camera's focus: walls inside CUT_IN drop to knee height and rise back to
// full height by CUT_OUT. Zoomed out past CUT_MAX_DIST the walls barely hide anything, so it's off.
const CUT_IN = 4.5, CUT_OUT = 6.5, CUT_MAX_DIST = 32;

export class Game {
  constructor({ ui }) {
    this.ui = ui;
    this.dungeon = new Dungeon();
    this.camera = new Camera();
    this.scene = new SceneBuilder(this.dungeon);
    this.view = { lowWalls: false, tintRooms: false, labels: true, secrets: true, pits: false, links: false, mapLight: false };
    this.dyn = { box: new Instances(64), cyl: new Instances(64), sph: new Instances(64) };
    this.decals = new FlatList(16, 256);
    this.xray = new FlatList(16, 256);
    this.motes = new FlatList(8, 256);
    this.shafts = new Instances(4);
    this.time = 0;
    const [x, y] = this.dungeon.xy(this.dungeon.start);
    this.token = { tile: this.dungeon.start, x: x + 0.5, z: y + 0.5, route: null, k: 0 };
    this.hoverTile = -1; this.target = -1; this.preview = null;
    this.staticDecalsVersion = 0;
    this.rebuild();
    this.updateWalls();
    for (const sh of SHAFTS) {
      const [x, z] = sh.at, i = this.dungeon.idx(Math.floor(x), Math.floor(z));
      this.shafts.add(x, this.scene.floorH(i), z, sh.r * 2, sh.len, sh.r * 2, sh.yaw, sh.col, 0, sh.i, -sh.lean);
    }
    // fog of war: what the party sees now, what it has seen, and the eased values drawn
    const n = this.dungeon.n;
    this.fixedLit = this.dungeon.light(LIGHTS.map((l) => ({ x: l.at[0], z: l.at[1], reach: LIGHT_KINDS[l.kind].reach })));
    this.lit = new Uint8Array(n); this.visible = new Uint8Array(n); this.explored = new Uint8Array(n);
    this.fogCur = new Float32Array(n * 2); this.fog = new Uint8Array(n * 4); this.fogVersion = 0; this.exploredVersion = 0;
    this.eye = -1;
    this.updateSight();
  }

  // The tile the party sees from: where the token stands, or is passing through.
  eyeTile() {
    const tk = this.token;
    return tk.route ? tk.route[Math.round(Math.min(tk.k, tk.route.length - 1))] : tk.tile;
  }

  // Recompute sight from the party's tile: the fixed lights plus the torch, then what's in view.
  updateSight() {
    const d = this.dungeon, eye = (this.eye = this.eyeTile()), [x, y] = d.xy(eye);
    this.lit.set(this.fixedLit);
    d.light([{ x: x + 0.5, z: y + 0.5, reach: LIGHT_KINDS.torch.reach }], this.lit);
    d.sight(eye, this.lit, this.visible);
    let found = false;
    for (let i = 0; i < d.n; i++) if (this.visible[i] && !this.explored[i]) { this.explored[i] = 1; found = true; }
    if (found) { this.exploredVersion++; this.ui.viewKey = null; }
  }

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

  // Dust motes hanging in the torchlight: a few per tile near the party, fixed to the world and
  // drifting slowly down, shown by how much torchlight reaches them. Only in sight.
  addMotes(torch) {
    const d = this.dungeon, out = this.motes, t = this.time, [lx, ly, lz, r] = torch;
    out.clear();
    const x0 = Math.max(0, Math.floor(lx - 4)), x1 = Math.min(d.W - 1, Math.floor(lx + 4));
    const z0 = Math.max(0, Math.floor(lz - 4)), z1 = Math.min(d.H - 1, Math.floor(lz + 4));
    for (let y = z0; y <= z1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * d.W + x;
      if (!TILE[d.t[i]].walk || (this.fogOn && !this.visible[i])) continue;
      for (let k = 0; k < 2; k++) {
        const s = hash2(x * 7 + k, y * 13 - k), s2 = hash2(y * 5 + k, x * 3);
        const px = x + s + 0.25 * Math.sin(t * 0.21 + s * 40), pz = y + s2 + 0.25 * Math.cos(t * 0.17 + s2 * 40);
        const py = 0.15 + 1.75 * (1 - ((s * 3.7 + t * 0.025 * (0.5 + s2)) % 1));
        const dd = (px - lx) ** 2 + (py - ly) ** 2 + (pz - lz) ** 2, q = 1 - dd / (r * r);
        if (q <= 0) continue;
        const tw = 0.55 + 0.45 * Math.sin(t * 1.3 + s * 30);
        out.push(px, py, pz, 0.016, 1, 0.78, 0.5, q * q * tw * 0.9);
      }
    }
  }

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
    if (TILE[this.dungeon.t[i]].walk) return this.scene.floorH(i);
    const [x, y] = this.dungeon.xy(i);
    const h = this.scene.wallH;
    return lerp(h, Math.min(KNEE, h), this.cutAmount(x + 0.5, y + 0.5));
  }
  known(i) { return !this.fogOn || this.explored[i] === 1; }

  // Tiles light can't pass: rock and closed doors (bars and the pool let it through).
  updateWalls() {
    const d = this.dungeon;
    this.walls = this.walls || new Uint8Array(d.n);
    for (let i = 0; i < d.n; i++) { const [x, y] = d.xy(i); this.walls[i] = d.clear(x, y) ? 0 : 255; }
    this.wallsVersion = (this.wallsVersion || 0) + 1;
  }

  // This frame's lights: the fixed ones, then the party's torch.
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
    const tk = this.token;
    add('torch', tk.x + 0.22, tk.h + 1.3, tk.z, 1.234);
    return out;
  }

  rebuild() {
    this.scene.build(this.view);
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

  pathOpts() {
    const v = this.view;
    // under fog, paths only cross ground the party has seen
    return { secrets: v.secrets, pits: v.pits, links: v.links, keys: new Set(['odric']), known: this.fogOn ? this.explored : null };
  }

  hover(i) {
    if (i === this.hoverTile) return;
    this.hoverTile = i;
    if (this.target < 0) this.refreshPreview();
    this.ui.update(this);
  }

  // First tap previews, a second tap on the same tile goes there.
  tap(i) {
    if (i < 0 || !TILE[this.dungeon.t[i]].walk) { this.cancel(); return; }
    if (i === this.target && this.preview && !this.token.route) {
      this.token.route = this.preview.tiles; this.token.k = 0;
      this.target = -1; this.preview = null;
    } else {
      this.target = i;
      this.refreshPreview();
    }
    this.ui.update(this);
  }

  cancel() { this.target = -1; this.refreshPreview(); this.ui.update(this); }

  refreshPreview() {
    const goal = this.target >= 0 ? this.target : this.hoverTile;
    const walkable = goal >= 0 && TILE[this.dungeon.t[goal]].walk;
    this.preview = walkable && !this.token.route ? this.dungeon.pathTo(this.token.tile, goal, this.pathOpts()) : null;
    this.previewGoal = goal;
  }

  // Exploration time for a path cost, in the book's 10-minute turns.
  static minutes(cost) { return (cost * FT_PER_TILE / FT_PER_TURN) * 10; }

  frameAll() {
    const c = this.camera;
    // far enough back that the whole width fits the screen, and the depth too
    const k = 2 * Math.tan(c.fov / 2);
    c.goal = [this.dungeon.W / 2, this.dungeon.H / 2 + 2.5];
    c.distGoal = clamp(Math.max(this.dungeon.W / (k * c.aspect), this.dungeon.H * Math.sin(c.pitch) / k) * 1.05, MIN_DIST, MAX_DIST);
  }

  focusToken() { const c = this.camera; c.goal = [this.token.x, this.token.z]; c.distGoal = 18; }

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

    // walk the token along its route, one tile at a time
    const tk = this.token;
    if (tk.route) {
      tk.k += dt * WALK_SPEED;
      const n = tk.route.length - 1, k = Math.min(tk.k, n), a = Math.floor(k), b = Math.min(n, a + 1), f = k - a;
      const [ax, ay] = d.xy(tk.route[a]), [bx, by] = d.xy(tk.route[b]);
      tk.x = lerp(ax, bx, f) + 0.5; tk.z = lerp(ay, by, f) + 0.5;
      // close up, the camera (and so the cutaway) follows the party; the overview stays put
      if (c.dist < CUT_MAX_DIST) c.goal = [tk.x, tk.z];
      if (tk.k >= n) { tk.tile = tk.route[n]; tk.route = null; this.refreshPreview(); this.ui.update(this); }
    }
    if (this.eyeTile() !== this.eye) this.updateSight();
    this.updateFog(dt);
  }

  frame(renderer, cssW, cssH) {
    const d = this.dungeon, cam = this.camera.matrices(cssW, cssH);
    const { box, cyl, sph } = this.dyn;
    box.clear(); cyl.clear(); sph.clear(); this.decals.clear(); this.xray.clear();

    // the party token: a brass-rimmed base with a grey figure on it, holding up a torch
    const tk = this.token, h = (tk.h = this.scene.floorH(tk.route ? tk.route[Math.round(Math.min(tk.k, tk.route.length - 1))] : tk.tile));
    cyl.add(tk.x, h, tk.z, 0.7, 0.06, 0.7, 0, [0.5, 0.33, 0.1], 0, 0.15);
    cyl.add(tk.x, h + 0.06, tk.z, 0.32, 0.55, 0.32, 0, [0.42, 0.42, 0.44]);
    sph.add(tk.x, h + 0.6, tk.z, 0.26, 0.26, 0.26, 0, [0.42, 0.42, 0.44]);
    cyl.add(tk.x + 0.2, h + 0.55, tk.z, 0.05, 0.6, 0.05, 0, [0.12, 0.07, 0.03]);
    const fl = 1 + flicker(this.time * 1.7, 9);
    sph.add(tk.x + 0.2, h + 1.12, tk.z, 0.13 * fl, 0.22 * fl, 0.13 * fl, 0, [1, 0.55, 0.2], 4, 3);

    // hover frame, path dots and goal ring; the path also shows faintly through walls
    const mark = (i, shape, size, col, a, p = 0.15, list = this.decals) => {
      const [x, y] = d.xy(i);
      list.push(x + 0.5, this.scene.floorH(i) + 0.02, y + 0.5, 0, size, size, shape, 0, col[0], col[1], col[2], a, p, i, 0, 0);
    };
    if (this.hoverTile >= 0) mark(this.hoverTile, 3, 0.98, [0.95, 0.85, 0.55], 0.9, 0.08);
    const goal = this.previewGoal;
    if (this.preview) {
      const t = this.preview.tiles;
      for (let k = 1; k < t.length - 1; k++) {
        mark(t[k], 2, 0.32, [1, 0.78, 0.3], 0.95, 0.3);
        mark(t[k], 2, 0.26, [1, 0.78, 0.3], 0.35, 0.3, this.xray);
      }
      mark(goal, this.target >= 0 ? 9 : 1, 0.9, [1, 0.78, 0.3], 0.95, 0.14);
      mark(goal, 1, 0.8, [1, 0.78, 0.3], 0.35, 0.14, this.xray);
    } else if (goal >= 0) {
      mark(goal, 1, 0.8, [1, 0.3, 0.2], 0.8, 0.14);
    }

    const amb = this.view.mapLight ? MAP_LIGHT : DARK;
    const lights = this.gatherLights();
    this.addMotes(lights[lights.length - 1]); // the torch is the last light
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
