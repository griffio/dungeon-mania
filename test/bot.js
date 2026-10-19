import { Game } from '../src/game.js';
import { TILE, T } from '../src/dungeon.js';
import * as treasure from '../src/treasure.js';

// A bot that plays the dungeon fairly, under fog, through the game's own actions: it walks to the
// edge of what it has seen, opens doors (smashing locks), keeps a light burning, fights whatever
// it meets, and when nothing is left to walk to it searches the walls, spot by spot, like a player
// who has run out of ideas, going round again (up to three passes) if that turns up nothing.
// The game is driven by promises (walking, attacks, the round loop) that only move on as the game
// updates, so the bot starts an action, then runs updates until the game is idle again.
const ui = { update() {}, viewKey: null };
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const tick = () => new Promise((r) => setImmediate(r));

// Answer whoever is talking, the way a sensible party would: feed and recruit Belisarius, take
// Rosa along, buy off the Arch-deaconess if the purse allows (or back away), bribe the lizardman,
// don't trouble the oracle, and head home when asked.
const ANSWERS = [/^Welcome/, /^Give him some food$/, /^Ask him to come/, /^Ask her to come/, /^Offer him food$/, /^Offer 100 gp/, /^Head home/, /^Go on/, /^Back away/, /^Back off/, /^Leave him/, /^Ask nothing/];
export function answer(g) {
  const opts = g.dialogue.options;
  for (const re of ANSWERS) { const k = opts.findIndex((o) => re.test(o.label) && o.ok !== false); if (k >= 0) { g.choose(k); return; } }
  if (!opts.length) { g.dialogue = null; return; }
  g.choose(Math.max(0, opts.findIndex((o) => o.ok !== false)));
}

async function settle(g) {
  for (let k = 0; k < 20000 && g.busy; k++) { g.update(0.05); await tick(); }
  g.update(0.05); await tick();
}

// Fight until the encounter ends: each hero bandages a downed friend, else hits a foe beside them,
// else closes on the nearest foe, else shoots, else passes.
async function fight(g) {
  for (let guard = 0; guard < 3000 && g.mode === 'encounter'; guard++) {
    await settle(g);
    if (g.dialogue) { answer(g); continue; }
    if (g.mode !== 'encounter') break;
    if (g.enc.phase !== 'party') continue;
    const m = g.ableParty().find((x) => !x.acted);
    if (!m) { g.endPhase(); continue; }
    g.select(m.id);
    const ids = g.actions().map((a) => a.id);
    if (ids.includes('wave')) { g.act('wave'); continue; }
    if (ids.includes('bandage')) { g.act('bandage'); continue; }
    // fire on the slime, before anything else
    if (ids.includes('burn')) { g.act('burn'); await settle(g); continue; }
    if (ids.includes('oil')) { g.act('oil'); await settle(g); continue; }
    const foes = g.activeFoes().filter((f) => g.foeShown(f) && f.def.rig !== 'slime');
    // spells: Cure on the worst hurt, Sleep on a crowd, Magic Missile on one
    const hurt = g.party.find((a) => !a.dead && (a.downed || a.hp <= a.maxHp / 2) && (a === m || g.inMelee(m.tile, a.tile)));
    if (hurt && ids.includes('cast:cure')) { g.act('cast:cure'); g.tap(hurt.tile); await settle(g); if (!g.casting) continue; g.casting = null; }
    const awake = foes.filter((f) => !f.status.asleep);
    if (awake.length >= 2 && ids.includes('cast:sleep')) { g.act('cast:sleep'); g.tap(awake[0].tile); await settle(g); if (!g.casting) continue; g.casting = null; }
    if (awake.length && ids.includes('cast:missile')) { g.act('cast:missile'); g.tap(awake[0].tile); await settle(g); if (!g.casting) continue; g.casting = null; }
    const beside = foes.find((f) => g.inMelee(m.tile, f.tile) && g.planAttack(m, f).ok);
    if (beside) { g.attackPlan = g.planAttack(m, beside); g.confirmAttack(); await settle(g); continue; }
    // nobody to fight but someone down: go to them, and bandage
    const down = g.party.find((a) => a.downed && !a.dead);
    if (down && !foes.length && !m.moved && !g.inMelee(m.tile, down.tile)) {
      const d = g.dungeon, reach = g.reachFor(m);
      const spot = reach && [...Array(d.n).keys()].filter((i) => reach[i] < Infinity && g.inMelee(i, down.tile)).sort((x, y) => reach[x] - reach[y])[0];
      if (spot !== undefined) { g.tap(spot); g.tap(spot); await settle(g); if (g.actions().some((a) => a.id === 'bandage')) { g.act('bandage'); } continue; }
    }
    if (!m.moved && foes.length) {
      const reach = g.reachFor(m), d = g.dungeon;
      let best = -1, bd = Infinity;
      for (let i = 0; i < d.n; i++) {
        if (!reach || reach[i] === Infinity) continue;
        const [x, y] = d.xy(i);
        for (const f of foes) { const [fx, fy] = d.xy(f.tile), dd = Math.hypot(fx - x, fy - y); if (dd < bd) { bd = dd; best = i; } }
      }
      if (best >= 0 && best !== m.tile) { g.tap(best); g.tap(best); await settle(g); continue; }
      m.moved = true;
    }
    const shot = foes.map((f) => g.planAttack(m, f)).find((p) => p.ok);
    if (shot) { g.attackPlan = shot; g.confirmAttack(); await settle(g); continue; }
    m.acted = true; g.afterAction(m);
  }
}

// The surface first: deal with the hobgoblins, fix the rope, climb down.
async function descend(g) {
  for (let k = 0; k < 50 && g.L.id === 'surface'; k++) {
    if (g.dialogue) { answer(g); continue; }
    if (g.mode === 'encounter') { await fight(g); continue; }
    const hob = g.foes.find((f) => f.alive);
    if (hob) { g.tap(hob.tile); await settle(g); continue; }
    const ids = g.actions().map((a) => a.id);
    if (ids.includes('rope')) { g.act('rope'); continue; }
    if (ids.includes('climb')) { g.act('climb'); await settle(g); continue; }
    const hole = g.dungeon.links[0].a, [hx, hy] = g.dungeon.xy(hole), goal = g.dungeon.idx(hx + 1, hy);
    const p = g.plan(goal);
    if (p) { g.go(p); await settle(g); }
  }
}

// Heal up: a breather when the room allows it, then the pool once it's known and the party is
// below two thirds. Returns true if it did something.
async function tend(g) {
  const ids = g.actions().map((a) => a.id), hp = g.party.reduce((a, m) => a + (m.dead ? 0 : m.hp), 0), max = g.party.reduce((a, m) => a + (m.dead ? 0 : m.maxHp), 0);
  if (hp >= max) return false;
  if (ids.includes('breather')) { g.act('breather'); return true; }
  if (hp * 3 >= max * 2) return false;
  if (ids.includes('drink')) { g.act('drink'); return true; }
  const d = g.dungeon, pool = [...Array(d.n).keys()].find((i) => d.t[i] === T.POOL && g.explored[i]);
  if (pool === undefined) return false;
  const [px, py] = d.xy(pool);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
    const p = g.plan(d.idx(px + dx, py + dy));
    if (p && !p.blocked && p.path.length > 1 && p.door < 0) { g.go(p); await settle(g); return true; }
  }
  return false;
}

// The little jobs a player does on the way: search the bodies, take what's worth carrying, deal
// with chests, smash urns, cut Rosa free, talk to Belisarius, bind the priests who surrendered,
// and take the sword. Returns true if it did something.
const tried = new Map();
async function chores(g) {
  const ids = g.actions().filter((a) => a.ok).map((a) => a.id), once = (k, n = 1) => { const c = tried.get(k) || 0; tried.set(k, c + 1); return c < n; };
  for (const id of ['sword', 'rosa', 'loot', 'bind', 'hemisphere', 'urn', 'drop']) if (ids.includes(id)) { g.act(id); await settle(g); return true; }
  if (ids.includes('talk') && g.actions().find((a) => a.id === 'talk').label === 'Talk to the stranger') { g.act('talk'); return true; }
  // coins only if they can be carried without slowing down
  for (const p of treasure.heapsNear(g)) if (treasure.weight(g) + p.n <= treasure.capacity(g)) { g.act(`heap:${p.kind}`); return true; }
  const c = g.actions().find((a) => a.id === 'chest');
  if (c) {
    const key = c.label;
    if (ids.includes('ctraps') && once(`check ${key}`, 2)) { g.act('ctraps'); return true; }
    if (ids.includes('disarm') && once(`disarm ${key}`, 4)) { g.act('disarm'); return true; }
    if (ids.includes('chest')) { g.act('chest'); return true; }
    if (ids.includes('cpick') && once(`pick ${key}`, 3)) { g.act('cpick'); return true; }
    if (ids.includes('csmash')) { g.act('csmash'); return true; }
  }
  return false;
}

export async function explore(seed) {
  const g = new Game({ ui, seed });
  globalThis.botGame = g; // for poking at a stuck run
  await descend(g);
  const d = g.dungeon;
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
    globalThis.botSteps = step;
    if (g.dialogue) { answer(g); continue; }
    if (g.mode === 'encounter') { await fight(g); continue; }
    if (g.mode !== 'explore') break;
    keepLit();
    if (await chores(g)) continue;
    // a door the party is standing at: open it, or deal with its lock
    const door = g.activeDoor();
    if (door && !door.open) {
      const ids = g.actions().map((a) => a.id);
      if (ids.includes('lever')) { g.act('lever'); continue; }
      if (door.key && door.key !== 'lever') { g.act('smash'); continue; }
      if (!door.key && !(door.opensFrom >= 0 && !g.adjacentTo(door.i).some((m) => m.tile === door.opensFrom)) && (g.searches.get(`try${door.i}`) || 0) < 12) {
        g.searches.set(`try${door.i}`, (g.searches.get(`try${door.i}`) || 0) + 1);
        g.act('open'); await settle(g); continue;
      }
    }
    if (g.actions().some((a) => a.id === 'lever')) { g.act('lever'); continue; }
    // look after the party: rest when allowed, and go back to the healing pool when hurt
    if (await tend(g)) continue;
    // prisoners seen through the bars: go and open their gate
    const cell = g.cells.find((c) => !c.freed && g.explored[c.i] && (g.searches.get(`cell${c.i}`) || 0) < 4);
    if (cell) {
      g.searches.set(`cell${cell.i}`, (g.searches.get(`cell${cell.i}`) || 0) + 1);
      const p = g.plan(cell.i);
      if (p && !p.blocked) { g.go(p); await settle(g); }
      const door = d.doors.get(cell.i);
      if (!door.open && g.adjacentTo(cell.i).length) { if (door.key && !g.keys.has('odric')) g.act('smash'); else g.act('open'); await settle(g); }
      continue;
    }
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
      g.go(p); await settle(g);
      if (g.exploredVersion === before && p.door < 0) failed.add(i);
      // a door that won't open from here (the lever's, or the block from inside): give it up
      // after a few tries, until something new is found
      if (p.door >= 0 && !d.doors.get(p.door).open) {
        const k = `walk${p.door}`, n = (g.searches.get(k) || 0) + 1;
        g.searches.set(k, n);
        if (n >= 4) failed.add(i);
      }
      moved = true; break;
    }
    if (moved) continue;
    // a room seen only from its doorway: step inside
    const unseen = d.rooms.find((r) => !r.passage && !g.visited.has(r.id) && !failed.has(`room${r.id}`) && r.tiles.some((i) => g.explored[i]));
    if (unseen) {
      failed.add(`room${unseen.id}`);
      const p = unseen.tiles.filter((i) => g.explored[i] && TILE[d.t[i]].walk && d.t[i] !== T.PIT).map((i) => g.plan(i)).find((q) => q && !q.blocked && q.path.length > 1);
      if (p) { g.go(p); await settle(g); }
      continue;
    }
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
    if (p.path.length > 1) { g.go(p); await settle(g); }
    searchedAt.push(target);
    const found = g.hidden().length;
    for (let k = 0; k < 3 && g.hidden().length === found && g.mode === 'explore'; k++) { g.act('search'); await settle(g); }
    if (g.hidden().length < found) failed.clear();
  }
  return g;
}

// The whole adventure (M5): explore, then take the sword (buying off the lizardman), walk to the
// nearer way out, climb up, and head home.
export async function crawl(seed) {
  const g = await explore(seed);
  for (let step = 0; step < 400 && g.mode !== 'over'; step++) {
    if (g.dialogue) { answer(g); continue; }
    if (g.mode === 'encounter') { await fight(g); continue; }
    if (g.mode !== 'explore') break;
    const ids = g.actions().filter((a) => a.ok).map((a) => a.id);
    if (ids.includes('sword')) { g.act('sword'); continue; }
    if (g.L.id === 'surface') { if (ids.includes('leave')) g.act('leave'); continue; }
    if (g.state.sword && ids.includes('climbup')) { g.act('climbup'); continue; }
    if (g.state.sword && ids.includes('stairsup')) { g.act('stairsup'); continue; }
    const d = g.dungeon, around = ([x, y]) => [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].map(([a, b]) => d.idx(a, b));
    const goals = g.state.sword
      ? d.links.filter((l) => l.id === 'entrance' || l.kind === 'stairs').flatMap((l) => around(d.xy(l.a)))
      : around([13, 32]);
    const plans = goals.map((i) => g.plan(i)).filter((p) => p && !p.blocked && (p.path.length > 1 || p.door >= 0)).sort((a, b) => a.cost - b.cost);
    if (!plans.length) { g.act('search'); await settle(g); continue; }
    g.go(plans[0]); await settle(g);
  }
  return g;
}
