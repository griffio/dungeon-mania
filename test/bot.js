import { Game } from '../src/game.js';
import { TILE, T } from '../src/dungeon.js';

// A bot that explores the dungeon fairly, under fog, through the game's own actions: it walks to
// the edge of what it has seen, opens doors (smashing locks), keeps a light burning, and when
// nothing is left to walk to it searches the walls, spot by spot, like a player who has run out of
// ideas, going round again (up to three passes) if that turns up nothing.
const ui = { update() {}, viewKey: null };
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function settle(g) {
  for (let k = 0; k < 20000 && g.busy; k++) g.update(0.05);
  g.update(0.05);
}

export function explore(seed) {
  const g = new Game({ ui, seed }), d = g.dungeon;
  const failed = new Set(), searchedAt = [];
  let passes = 0;
  const near = (i, list, r) => { const [x, y] = d.xy(i); return list.some((j) => { const [a, b] = d.xy(j); return Math.hypot(a - x, b - y) <= r; }); };
  const dist = (i) => { const [x, y] = d.xy(i), [lx, ly] = d.xy(g.leader.tile); return Math.hypot(x - lx, y - ly); };
  const keepLit = () => {
    if (!g.party.some((m) => m.light === 'torch' || (m.light === 'lantern' && !m.shut))) {
      const a = g.actions().find((x) => x.id === 'light' || x.id === 'lantern');
      if (a) g.act(a.id);
    }
  };
  for (let step = 0; step < 1500; step++) {
    keepLit();
    // a door the party is standing at: open it, or deal with its lock
    const door = g.activeDoor();
    if (door && !door.open) {
      const ids = g.actions().map((a) => a.id);
      if (ids.includes('lever')) { g.act('lever'); continue; }
      if (door.key && door.key !== 'lever') { g.act('smash'); continue; }
      if (!door.key && !(door.opensFrom >= 0 && !g.adjacentTo(door.i).some((m) => m.tile === door.opensFrom)) && (g.searches.get(`try${door.i}`) || 0) < 12) {
        g.searches.set(`try${door.i}`, (g.searches.get(`try${door.i}`) || 0) + 1);
        g.act('open'); continue;
      }
    }
    if (g.actions().some((a) => a.id === 'lever')) { g.act('lever'); continue; }
    // the frontier: seen ground with unseen ground beside it
    const frontier = [];
    for (let i = 0; i < d.n; i++) {
      if (!g.explored[i] || !TILE[d.t[i]].walk || g.hiddenDoor(i) || failed.has(i)) continue;
      const [x, y] = d.xy(i);
      if (N8.some(([dx, dy]) => d.inside(x + dx, y + dy) && !g.explored[d.idx(x + dx, y + dy)])) frontier.push(i);
    }
    frontier.sort((a, b) => dist(a) - dist(b));
    let moved = false;
    for (const i of frontier) {
      const p = g.plan(i);
      if (!p || p.blocked || (p.path.length < 2 && p.door < 0)) { failed.add(i); continue; }
      const before = g.exploredVersion;
      g.go(p); settle(g);
      if (g.exploredVersion === before && p.door < 0) failed.add(i);
      moved = true; break;
    }
    if (moved) continue;
    // nothing left to walk to: search somewhere not yet searched, three times
    const spot = [];
    for (let i = 0; i < d.n; i++) {
      if (!g.explored[i] || !TILE[d.t[i]].walk || TILE[d.t[i]].door || d.t[i] === T.PIT || near(i, searchedAt, 2)) continue;
      spot.push(i);
    }
    spot.sort((a, b) => dist(a) - dist(b));
    const target = spot.find((i) => { const p = g.plan(i); return p && !p.blocked && p.door < 0; });
    if (target === undefined) {
      if (++passes >= 3) break;
      searchedAt.length = 0; // round again
      continue;
    }
    const p = g.plan(target);
    if (p.path.length > 1) { g.go(p); settle(g); }
    searchedAt.push(target);
    const found = g.hidden().length;
    for (let k = 0; k < 3 && g.hidden().length === found; k++) g.act('search');
    if (g.hidden().length < found) { failed.clear(); }
  }
  return g;
}

