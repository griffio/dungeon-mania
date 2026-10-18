import * as DATA from './dungeon-data.js';
import { Heap } from './util.js';

// Tile types. walk: can stand on it; cost: movement cost per orthogonal step;
// see: light and sight pass (doors only when open); door: opens and closes.
export const T = {
  ROCK: 0, FLOOR: 1, DOOR: 2, SECRET: 3, LEVER: 4, BLOCK: 5, GATE: 6, BARS: 7,
  PIT: 8, HATCH: 9, WATER: 10, POOL: 11, STAIRS: 12, RUBBLE: 13, CAVE: 14, EXIT: 15,
};
export const TILE = [];
const def = (t, glyph, name, o) => (TILE[t] = { glyph, name, walk: false, cost: 1, see: true, door: false, ...o });
def(T.ROCK, '#', 'Rock', { see: false });
def(T.FLOOR, '.', 'Floor', { walk: true });
def(T.DOOR, '+', 'Door', { walk: true, door: true });
def(T.SECRET, 'S', 'Secret door', { walk: true, door: true, secret: true });
def(T.LEVER, 'L', 'Secret door (lever)', { walk: true, door: true, secret: true });
def(T.BLOCK, 'B', 'Sliding block door', { walk: true, door: true });
def(T.GATE, 'G', 'Cell gate', { walk: true, door: true, bars: true });
def(T.BARS, '=', 'Bars', { bars: true });
def(T.PIT, 'P', 'Pit', { walk: true, cost: 4, hazard: true });
def(T.HATCH, 'h', 'Covered pit', { walk: true });
def(T.WATER, '~', 'Water', { walk: true, cost: 2 });
def(T.POOL, 'O', 'Pool', {});
def(T.STAIRS, '_', 'Stairs', { walk: true, cost: 2 });
def(T.RUBBLE, 'r', 'Rubble', { walk: true, cost: 2 });
def(T.CAVE, 'c', 'Cave floor', { walk: true, cost: 1.5 });
def(T.EXIT, '<', 'Tunnel to the surface', { walk: true });
const BY_GLYPH = Object.fromEntries(TILE.map((d, t) => [d.glyph, t]));

const DIAG = 1.5; // a diagonal step costs half as much again (5 ft, 10 ft, 5 ft...)
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class Dungeon {
  constructor(data = DATA) {
    const rows = data.MAP.replace(/^\n/, '').replace(/\n$/, '').split('\n');
    this.W = rows[0].length; this.H = rows.length; this.n = this.W * this.H;
    this.t = new Uint8Array(this.n);
    rows.forEach((r, y) => {
      if (r.length !== this.W) throw new Error(`map row ${y} is ${r.length} wide, not ${this.W}`);
      for (let x = 0; x < this.W; x++) {
        const t = BY_GLYPH[r[x]];
        if (t === undefined) throw new Error(`unknown glyph '${r[x]}' at ${x},${y}`);
        this.t[y * this.W + x] = t;
      }
    });
    this.start = this.idx(...data.START);
    this.buildDoors(data.DOORS);
    this.buildRooms(data.ROOMS);
    this.links = data.LINKS.map((l) => ({ ...l, a: this.idx(...l.from), b: Array.isArray(l.to) ? this.idx(...l.to) : -1 }));
    this.props = data.PROPS;
  }

  idx(x, y) { return y * this.W + x; }
  xy(i) { return [i % this.W, (i / this.W) | 0]; }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  tile(i) { return TILE[this.t[i]]; }
  at(x, y) { return this.inside(x, y) ? this.t[this.idx(x, y)] : T.ROCK; }

  // Every door tile gets a state; DOORS adds the special ones (locks, lever, one-way).
  buildDoors(list) {
    this.doors = new Map();
    for (let i = 0; i < this.n; i++) {
      const d = this.tile(i);
      if (d.door) this.doors.set(i, { i, open: false, found: !d.secret, key: null, axis: this.doorAxis(i) });
    }
    for (const s of list) {
      const i = this.idx(...s.at), door = this.doors.get(i);
      if (!door) throw new Error(`DOORS entry at ${s.at} is not on a door tile`);
      Object.assign(door, s, { opensFrom: s.opensFrom ? this.idx(...s.opensFrom) : -1, lever: s.lever ? this.idx(...s.lever) : -1 });
    }
  }

  // Which way a door spans its wall: 'x' (wall runs east-west, you pass north-south), 'z',
  // or a diagonal ('d1' along +x+y, 'd2' along +x-y) for doors in room 12's sloping walls.
  doorAxis(i) {
    const [x, y] = this.xy(i);
    const open = (dx, dy) => TILE[this.at(x + dx, y + dy)].walk;
    const ns = open(0, -1) && open(0, 1), ew = open(-1, 0) && open(1, 0);
    if (ns && !ew) return 'x';
    if (ew && !ns) return 'z';
    // both ways open: the wall is the diagonal whose ends aren't floor
    const blocked = (dx, dy) => { const t = this.at(x + dx, y + dy); return !TILE[t].walk || TILE[t].door; };
    return blocked(-1, -1) || blocked(1, 1) ? 'd1' : 'd2';
  }

  // Rooms: flood fill from the anchor inside the box, stopping at doors.
  buildRooms(list) {
    this.room = new Int16Array(this.n).fill(-1);
    this.rooms = list.map((r, k) => {
      const [x0, y0, x1, y1] = r.box, a = this.idx(...r.at), tiles = [];
      if (this.t[a] === T.ROCK || this.tile(a).door) throw new Error(`room ${r.id} anchor ${r.at} is not floor`);
      const stack = [a];
      this.room[a] = k;
      while (stack.length) {
        const i = stack.pop();
        tiles.push(i);
        const [x, y] = this.xy(i);
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
          const j = this.idx(nx, ny), d = this.tile(j);
          if (this.t[j] === T.ROCK || d.door || this.room[j] !== -1) continue;
          this.room[j] = k; stack.push(j);
        }
      }
      return { ...r, index: k, tiles };
    });
    this.byId = Object.fromEntries(this.rooms.map((r) => [r.id, r]));
    // the rooms on either side of each door
    for (const door of this.doors.values()) {
      const [x, y] = this.xy(door.i), sides = new Set();
      for (const [dx, dy] of N4) { const r = this.inside(x + dx, y + dy) ? this.room[this.idx(x + dx, y + dy)] : -1; if (r >= 0) sides.add(this.rooms[r].id); }
      door.rooms = [...sides];
    }
  }
  roomOf(i) { const r = this.room[i]; return r >= 0 ? this.rooms[r] : null; }

  // Can a walker go from tile a into its neighbour b? opts:
  //   secrets: undiscovered secret doors count as found     keys: Set of key ids held
  //   pits: walk through pits (climbing down and up)        closed: closed doors are passable (they get opened)
  //   ignore: Set of door tiles treated as walls
  enter(a, b, opts) {
    const d = this.tile(b);
    if (!d.walk) return false;
    if (d.hazard && !opts.pits) return false;
    if (d.door) {
      const door = this.doors.get(b);
      if (opts.ignore?.has(b)) return false;
      if (!door.found && !opts.secrets) return false;
      if (!door.open) {
        if (opts.closed === false) return false;
        if (door.key && !opts.keys?.has(door.key)) return false;
        if (door.opensFrom >= 0 && a !== door.opensFrom) return false;
      }
    }
    return true;
  }

  // Cost of the step a -> b (b a neighbour, orthogonal or diagonal), or Infinity if blocked.
  // Diagonals need both side tiles open and never go through a doorway.
  step(a, b, opts) {
    if (!this.enter(a, b, opts)) return Infinity;
    const W = this.W, tb = this.tile(b);
    let c = tb.cost;
    if (tb.door && !this.doors.get(b).open) c += 1; // opening it
    const ax = a % W, bx = b % W, ay = (a - ax) / W, by = (b - bx) / W;
    if (ax !== bx && ay !== by) {
      if (this.tile(a).door || tb.door) return Infinity;
      const s1 = ay * W + bx, s2 = by * W + ax;
      if (!this.enter(a, s1, opts) || !this.enter(a, s2, opts)) return Infinity;
      if (this.tile(s1).door || this.tile(s2).door) return Infinity;
      c *= DIAG;
    }
    return c;
  }

  // Dijkstra from `from`. Stops early at `to` (if given) or past `budget`. links: also use the
  // non-walking LINKS (the 9-18 tunnel), at LINK_COST.
  search(from, { to = -1, budget = Infinity, links = false, ...opts } = {}) {
    const { W, H, n } = this;
    const dist = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    const heap = new Heap();
    const relax = (i, j, nd) => { if (nd < dist[j] && nd <= budget) { dist[j] = nd; prev[j] = i; heap.push(j, nd); } };
    dist[from] = 0; heap.push(from, 0);
    while (heap.size) {
      const i = heap.pop();
      if (done[i]) continue; // a stale heap entry: i was already settled more cheaply
      done[i] = 1;
      if (i === to) break;
      const x = i % W, y = (i - x) / W, di = dist[i];
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!done[j]) relax(i, j, di + this.step(i, j, opts));
      }
      if (links) for (const l of this.links) {
        if (l.b < 0) continue;
        if (l.a === i) relax(i, l.b, di + LINK_COST); else if (l.b === i) relax(i, l.a, di + LINK_COST);
      }
    }
    return { dist, prev };
  }

  // Tile path from `from` to `to` (both included) and its cost, or null.
  pathTo(from, to, opts = {}) {
    const { dist, prev } = this.search(from, { ...opts, to });
    if (dist[to] === Infinity) return null;
    const path = [];
    for (let i = to; i !== -1; i = prev[i]) path.push(i);
    return { tiles: path.reverse(), cost: dist[to] };
  }

  // Movement cost to every tile within budget (Infinity where unreachable).
  reach(from, budget, opts = {}) { return this.search(from, { ...opts, budget }).dist; }

  // Does light/sight pass this tile? Closed doors block; bars, gates and the pool don't.
  clear(x, y) {
    const t = this.at(x, y), d = TILE[t];
    if (!d.see) return false;
    if (d.door && !d.bars) return this.doors.get(this.idx(x, y)).open;
    return true;
  }

  // Line of sight between tile centres: every tile the line crosses, except the two ends,
  // must be clear. Passing exactly through a corner is blocked only if both corner tiles are.
  los(ax, ay, bx, by) {
    const dx = Math.abs(bx - ax), dy = Math.abs(by - ay), sx = Math.sign(bx - ax), sy = Math.sign(by - ay);
    let x = ax, y = ay, ex = 0, ey = 0; // ex/ey: progress along each axis, scaled by 2*dx*dy
    const n = dx + dy;
    for (let k = 0; k < n; k++) {
      const tx = (2 * ex + 1) * dy, ty = (2 * ey + 1) * dx; // when the line next crosses an x / y edge
      if (tx === ty) {
        if (!this.clear(x + sx, y) && !this.clear(x, y + sy)) return false;
        x += sx; y += sy; ex++; ey++; k++;
      } else if (tx < ty) { x += sx; ex++; } else { y += sy; ey++; }
      if ((x !== bx || y !== by) && !this.clear(x, y)) return false;
    }
    return true;
  }
}

// Climbing 10 ft down the rings in 9 and crawling the tunnel to 18, in movement points.
export const LINK_COST = 20;
