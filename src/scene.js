import { Instances, FlatList } from './renderer.js';
import { T, TILE } from './dungeon.js';
import { CIRCLE_12 } from './dungeon-data.js';
import { hash2 } from './util.js';

// Dungeon -> instanced grey boxes. World units are tiles (5 ft); tile (x, y) covers world
// x..x+1, z = y..y+1, and the floor is at height 0. Walls are 2 high (10 ft ceilings).
export const WALL_H = 2, LOW_WALL_H = 0.3;
const DOOR_W = 0.6, DOOR_H = 1.2;   // 3 ft by 6 ft oak doors
const WATER_BED = -0.8, WATER_TOP = -0.3, PIT_DEPTH = -2;

const C = {
  rock: [0.075, 0.07, 0.065], rockTop: [0.1, 0.095, 0.088],
  floor: [0.3, 0.29, 0.27], passage: [0.22, 0.215, 0.205], cave: [0.19, 0.16, 0.12],
  liner: [0.07, 0.065, 0.06], pitBottom: [0.02, 0.02, 0.02], water: [0.05, 0.09, 0.11], pool: [0.03, 0.1, 0.08],
  oak: [0.2, 0.12, 0.06], iron: [0.05, 0.05, 0.055], secret: [0.13, 0.07, 0.15], block: [0.16, 0.15, 0.14],
  wood: [0.16, 0.1, 0.05], cloth: [0.22, 0.2, 0.17], stone: [0.3, 0.29, 0.27], red: [0.28, 0.03, 0.03],
};

export class SceneBuilder {
  constructor(d) {
    this.d = d;
    this.sets = { box: new Instances(4096), cyl: new Instances(256), sph: new Instances(256) };
    this.version = 0;
  }

  // Floor height of a walkable tile (pits and room 23 are sunk), or the wall top for rock.
  floorH(i) {
    const t = this.d.t[i];
    if (t === T.PIT) return PIT_DEPTH;
    if (t === T.WATER) return WATER_BED;
    if (t === T.STAIRS) return this.stairs.get(i).low;
    return 0;
  }

  build({ lowWalls = false, showSecrets = true } = {}) {
    const d = this.d, { box, cyl, sph } = this.sets;
    box.clear(); cyl.clear(); sph.clear();
    this.wallH = lowWalls ? LOW_WALL_H : WALL_H;
    this.planStairs();
    const wallH = this.wallH;
    for (let i = 0; i < d.n; i++) {
      const [x, y] = d.xy(i), t = d.t[i], cx = x + 0.5, cz = y + 0.5;
      const seed = hash2(x, y);
      if (t === T.ROCK) {
        // natural rock round the cave (room 20), hewn blocks everywhere else
        let cave = false;
        for (let dy = -1; dy <= 1 && !cave; dy++) for (let dx = -1; dx <= 1; dx++) if (d.at(x + dx, y + dy) === T.CAVE) { cave = true; break; }
        if (cave) box.add(cx, 0, cz, 1, wallH, 1, 0, jitter(C.cave, seed, 0.15), 5, 0, 0, 0, seed, 1);
        else box.add(cx, 0, cz, 1, wallH, 1, 0, jitter(C.rock, seed), 1, 0, 0, 0, seed, 1);
        continue;
      }
      const room = d.roomOf(i), tile = TILE[t], floorMat = t === T.CAVE ? 5 : room?.id === '12' ? 9 : 2;
      const floorCol = t === T.CAVE ? C.cave : room && !room.passage ? C.floor : C.passage;
      const h = this.floorH(i);
      if (t === T.PIT) {
        box.add(cx, h - 0.1, cz, 1, 0.1, 1, 0, C.pitBottom);
      } else if (t === T.WATER) {
        box.add(cx, h - 0.1, cz, 1, 0.1, 1, 0, C.liner, 2);
        box.add(cx, WATER_TOP - 0.02, cz, 1, 0.02, 1, 0, C.water, 3);
      } else if (t === T.STAIRS) {
        this.addSteps(i, floorCol);
      } else {
        box.add(cx, -0.1, cz, 1, 0.1, 1, 0, jitter(floorCol, seed, 0.06), floorMat);
      }
      this.addLiners(i, h);
      if (tile.door) this.addDoor(i, showSecrets);
      else if (t === T.BARS) this.addBars(i, false);
      else if (t === T.POOL) {
        cyl.add(cx, 0, cz, 0.86, 0.04, 0.86, 0, C.stone, 2);
        cyl.add(cx, 0.04, cz, 0.74, 0.005, 0.74, 0, C.pool, 3, 0.25);
      } else if (t === T.HATCH) {
        box.add(cx, 0, cz, 0.7, 0.06, 0.7, 0, C.oak, 7);
        box.add(cx, 0.06, cz, 0.18, 0.04, 0.06, 0, C.iron, 8);
      } else if (t === T.RUBBLE) {
        for (let k = 0; k < 3; k++) {
          const s = hash2(x * 3 + k, y * 7 - k);
          sph.add(x + 0.2 + 0.6 * s, -0.05, y + 0.2 + 0.6 * hash2(y + k, x), 0.3 + 0.25 * s, 0.25 + 0.2 * s, 0.3 + 0.2 * s, s * 6, jitter(C.block, s), 5);
        }
      } else if (t === T.CAVE && seed > 0.7) {
        sph.add(x + 0.3 + 0.4 * seed, -0.05, y + 0.3 + 0.4 * hash2(y, x), 0.35, 0.22, 0.3, seed * 6, jitter(C.cave, seed, 0.2), 5);
      } else if (t === T.EXIT) {
        // the tunnel's mouth, rising east toward daylight
        box.add(cx + 0.2, 0, cz, 0.9, 0.05, 0.8, 0, C.passage, 0, 0, 0.25);
        box.add(x + 0.95, 0, cz, 0.1, 1.4, 0.8, 0, [0.9, 0.82, 0.62], 4, 0.6);
      }
    }
    for (const p of d.props) this.addProp(p);
    this.version++;
  }

  // Stairs tiles form flights. A flight with a link to the surface goes up; others go down,
  // from the floor beside them to the lower floor past them (room 23's wet stairs).
  planStairs() {
    const d = this.d;
    this.stairs = new Map();
    const upTiles = new Set(d.links.filter((l) => l.kind === 'stairs').map((l) => l.a));
    for (let i = 0; i < d.n; i++) {
      if (d.t[i] !== T.STAIRS) continue;
      const [x, y] = d.xy(i);
      let from = null, to = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = d.at(x + dx, y + dy);
        if (!TILE[t].walk || t === T.STAIRS) continue;
        if (t === T.WATER) to = [dx, dy]; else from = [dx, dy];
      }
      const up = upTiles.has(i) || [[1, 0], [-1, 0]].some(([dx]) => upTiles.has(d.idx(x + dx, y)));
      const dir = from ? [-from[0], -from[1]] : to || [0, 1];
      this.stairs.set(i, up ? { dir, low: 0, high: 1.6, up } : { dir, low: WATER_BED, high: 0, up });
    }
  }

  addSteps(i, col) {
    const [x, y] = this.d.xy(i), s = this.stairs.get(i), { box } = this.sets;
    const [dx, dz] = s.dir, n = 4;
    for (let k = 0; k < n; k++) {
      // step k is the k-th quarter of the tile along dir; up stairs rise along dir, down stairs fall
      const f = (k + 0.5) / n - 0.5;
      const top = s.up ? s.low + (s.high - s.low) * ((k + 1) / n) : s.high - (s.high - s.low) * ((k + 1) / n);
      const bx = x + 0.5 + dx * f, bz = y + 0.5 + dz * f;
      const sx = dx ? 1 / n : 1, sz = dz ? 1 / n : 1;
      box.add(bx, s.low - 0.1, bz, sx, top - s.low + 0.1, sz, 0, jitter(col, hash2(x + k, y)), 2);
    }
  }

  // Sunken tiles (pits, water, stairs) get side walls up to whatever is next to them.
  addLiners(i, h) {
    if (h >= 0) return;
    const d = this.d, [x, y] = d.xy(i), { box } = this.sets;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = d.idx(x + dx, y + dy), t = d.t[j];
      const top = t === T.ROCK || !TILE[t].walk ? 0 : this.floorH(j);
      if (top <= h + 0.01) continue;
      const ex = x + 0.5 + dx * 0.48, ez = y + 0.5 + dy * 0.48;
      box.add(ex, h, ez, dx ? 0.04 : 1, top - h, dy ? 0.04 : 1, 0, C.liner, 1);
    }
  }

  addDoor(i, showSecrets) {
    const d = this.d, door = d.doors.get(i), t = d.t[i], [x, y] = d.xy(i), { box } = this.sets;
    const cx = x + 0.5, cz = y + 0.5, H = this.wallH;
    if (t === T.GATE) { this.addBars(i, true); return; }
    // secret doors look like the wall around them (tinted when the viewer shows secrets)
    if (TILE[t].secret || t === T.BLOCK) {
      const col = t === T.BLOCK ? C.block : showSecrets ? C.secret : C.rock;
      box.add(cx, 0, cz, 1, H, 1, 0, jitter(col, hash2(x, y)), 1, 0, 0, 0, 0, 1);
      return;
    }
    const yaw = { x: 0, z: Math.PI / 2, d1: Math.PI / 4, d2: -Math.PI / 4 }[door.axis];
    const span = door.axis[0] === 'd' ? Math.SQRT2 : 1;
    // a diagonal wall is only as thick as its corner-to-corner seam, so its jambs are thinner
    const jamb = (span - DOOR_W) / 2, depth = span > 1 ? 0.22 : 0.5, cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (const side of [-1, 1]) {
      const o = side * (DOOR_W / 2 + jamb / 2);
      box.add(cx + cy * o, 0, cz + sy * o, jamb, H, depth, yaw, C.rock, 1, 0, 0, 0, 0, 1);
    }
    if (H > DOOR_H) box.add(cx, DOOR_H, cz, DOOR_W, H - DOOR_H, depth, yaw, C.rock, 1, 0, 0, 0, 0, 1);
    box.add(cx, 0, cz, DOOR_W, Math.min(DOOR_H, H), 0.12, yaw, door.rotten ? [0.1, 0.08, 0.05] : C.oak, 6, 0, 0, 0, 0, 1);
  }

  // Bars run along the bar line through the tile (both ways where lines cross); gates are
  // bars with a frame.
  addBars(i, gate) {
    const d = this.d, [x, y] = d.xy(i), { box, cyl } = this.sets;
    const barLike = (dx, dy) => { const t = d.at(x + dx, y + dy); return t === T.BARS || t === T.GATE; };
    const solid = (dx, dy) => d.at(x + dx, y + dy) === T.ROCK;
    const alongX = barLike(-1, 0) || barLike(1, 0) || (solid(-1, 0) && solid(1, 0));
    const alongZ = barLike(0, -1) || barLike(0, 1) || (solid(0, -1) && solid(0, 1));
    const H = Math.min(this.wallH, 1.8);
    for (const [ax, az] of [alongX && [1, 0], alongZ && [0, 1]].filter(Boolean)) {
      for (let k = 0; k < 5; k++) {
        const f = (k + 0.5) / 5 - 0.5;
        cyl.add(x + 0.5 + ax * f, 0, y + 0.5 + az * f, 0.05, H, 0.05, 0, C.iron, 8);
      }
      for (const yy of [0.05, H - 0.08]) box.add(x + 0.5, yy, y + 0.5, ax ? 1 : 0.06, 0.06, az ? 1 : 0.06, 0, C.iron, 8);
      if (gate) for (const f of [-0.45, 0.45]) box.add(x + 0.5 + ax * f, 0, y + 0.5 + az * f, 0.08, H, 0.08, 0, [0.09, 0.08, 0.07]);
    }
  }

  addProp(p) {
    const { box, cyl, sph } = this.sets, [x, z] = p.at, yaw = ((p.rot || 0) * Math.PI) / 180;
    const B = (col, mat = 7, emis = 0) => box.add(x, 0, z, p.w, p.h, p.d, yaw, col, mat, emis);
    switch (p.kind) {
      case 'coffins': for (let k = 0; k < 3; k++) box.add(x, k * p.h / 3, z, p.w, p.h / 3 - 0.02, p.d, yaw, jitter(C.wood, k * 0.3), 7); break;
      case 'bed': B(C.red, 0); box.add(x - p.w * 0.42, 0, z, 0.15, p.h + 0.4, p.d, yaw, C.wood, 7); break;
      case 'urn': cyl.add(x, 0, z, p.w, p.h * 0.75, p.d, 0, [0.22, 0.13, 0.07]); sph.add(x, p.h * 0.45, z, p.w * 1.1, p.h * 0.5, p.d * 1.1, 0, [0.22, 0.13, 0.07]); break;
      case 'barrel': cyl.add(x, 0, z, p.w, p.h, p.d, 0, C.wood, 7); break;
      case 'pole': cyl.add(x, 0, z, p.w, this.wallH, p.d, 0, C.iron, 8); break;
      case 'brazier': cyl.add(x, 0, z, p.w * 0.6, p.h, p.d * 0.6, 0, C.iron, 8); cyl.add(x, p.h, z, p.w, 0.12, p.d, 0, [0.15, 0.6, 0.25], 4, 1.2); break;
      case 'sconce': cyl.add(x, 0, z, p.w, p.h, p.d, 0, C.iron, 8); sph.add(x, p.h, z, 0.16, 0.22, 0.16, 0, [1, 0.6, 0.25], 4, 1.4); break;
      case 'lamp': cyl.add(x, 0.55, z, p.w, 0.12, p.d, 0, [0.3, 0.22, 0.1]); sph.add(x, 0.67, z, 0.1, 0.14, 0.1, 0, [1, 0.7, 0.35], 4, 1.4); break;
      case 'candles': for (const f of [-0.12, 0, 0.12]) cyl.add(x + f, 0, z, 0.05, 0.18 + f, 0.05, 0, [1, 0.8, 0.5], 4, 1); break;
      case 'statue':
        box.add(x, 0, z, p.w, 0.25, p.d, yaw, C.stone, 1);
        cyl.add(x, 0.25, z, p.w * 0.55, p.h * 0.6, p.d * 0.45, yaw, C.stone);
        sph.add(x, 0.25 + p.h * 0.6, z, p.w * 0.35, p.w * 0.38, p.w * 0.35, 0, C.stone);
        break;
      case 'rock': sph.add(x, -0.25, z, p.w, p.h + 0.25, p.d, yaw, jitter(C.block, hash2(x * 10, z * 10)), 5); break;
      case 'curtain': B(C.red, 0); break;
      case 'corpse': B([0.2, 0.2, 0.22], 8); break;
      case 'chest': B(p.room === '14' ? [0.3, 0.14, 0.06] : C.wood); break;
      case 'bundles': B(C.cloth, 0); break;
      default: B(C.wood);
    }
  }

  // Ground overlays that only change with the view options: room 12's green circle, and
  // optionally a tint per room.
  decals({ tintRooms = false } = {}) {
    const out = new FlatList(16, 1024), d = this.d;
    const [cx, cz] = CIRCLE_12.at;
    // a thin brass border round the green stone (the stone itself is in the floor shader)
    out.push(cx, 0.012, cz, 0, CIRCLE_12.r * 2, CIRCLE_12.r * 2, 1, 0, 0.75, 0.55, 0.25, 0.9, 0.012, 0, 1, 0); // lit, like the floor
    if (tintRooms) {
      for (const r of d.rooms) {
        const hue = hash2(r.index * 13 + 7, 3) * 360, col = hsl(hue, r.passage ? 0.25 : 0.6, 0.55);
        for (const i of r.tiles) {
          const [x, y] = d.xy(i);
          out.push(x + 0.5, this.floorH(i) + 0.014, y + 0.5, 0, 0.96, 0.96, 0, 0, col[0], col[1], col[2], 0.28, 0.12, 0, 0, 0);
        }
      }
    }
    return out;
  }
}

const jitter = (c, s, k = 0.12) => { const f = 1 - k + 2 * k * s; return [c[0] * f, c[1] * f, c[2] * f]; };

// hue in degrees -> display-space rgb (decals blend in display space)
export function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}
