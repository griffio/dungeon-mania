// Denizen brains (PLAN.md 9). A foe's turn is a plan: a route to walk
// (up to its encounter move) and, at the end of it, a party member to attack. The game carries
// it out with the same walking and attack code the party uses.
//   advance: rats go for the weakest, everyone else for the nearest they can reach
//   flee: a broken group runs from the party (morale, PLAN.md 3.4)
//   loop: broken goblins run their escape loop round through 18 and back (room script), and
//     Odric runs for his stairs
//   cast: the Arch-deaconess opens with Hold Person on the biggest threat; Kithar heals a hurt
//     friend beside him (PLAN.md 9)
//   spit: a locust spits at someone near but not beside it
//   chained: the gecko only goes for whoever is inside the green circle, until it's let loose
// Brannoc holds the line: a foe that steps next to a fighter stops there (PLAN.md 4).

// Foes see the party: in line of sight, and lit or within their infravision (60 ft).
export const INFRA = 12;
export function canSee(g, foe, m) {
  if (m.status?.hidden || m.status?.bolted) return false;
  const d = g.dungeon, [fx, fy] = d.xy(foe.tile), [mx, my] = d.xy(m.tile);
  const dist = Math.hypot(fx - mx, fy - my);
  if (dist > 1.5 && !(g.lit[m.tile] || (foe.def.infravision && dist <= INFRA))) return false;
  return d.los(fx, fy, mx, my);
}

export function foeTurn(g, foe) {
  const d = g.dungeon;
  const targets = g.party.filter((m) => !m.dead && !m.downed && !m.status.hidden && !m.status.bolted);
  const blocked = g.blockedFor(foe);
  // the chained gecko can't leave the circle
  if (foe.state === 'chained') {
    const c = g.data.CIRCLE_12, inCircle = (i) => { const [x, y] = d.xy(i); return Math.hypot(x + 0.5 - c.at[0], y + 0.5 - c.at[1]) <= c.r; };
    for (let i = 0; i < d.n; i++) if (!inCircle(i)) blocked[i] = 1;
    targets.splice(0, targets.length, ...targets.filter((m) => inCircle(m.tile)));
  }
  // denizens open unlocked doors as they go (not locked ones, nor the one-way block from inside)
  const opts = { closed: true, pits: false, blocked };
  if (foe.state === 'looping') return loop(g, foe, blocked);
  if (foe.state === 'fleeing') return flee(g, foe, opts);
  if (!targets.length) return null;
  const spell = cast(g, foe, targets);
  if (spell) return { route: null, cast: spell };

  // already beside someone: hit them (the weakest, for rats)
  const pick = (list) => (foe.def.rig === 'rat' ? list.reduce((a, b) => (b.hp < a.hp ? b : a)) : list[0]);
  const adjacent = targets.filter((m) => g.inMelee(foe.tile, m.tile));
  if (adjacent.length) return { route: null, target: pick(adjacent) };
  // Odric at his rite stays at the circle, and fights only whoever comes at him
  if (foe.state === 'ritual') return null;
  // a locust spits at whoever is near (10 ft or so) and in sight, every other round
  if (foe.def.spit && foe.spat !== g.enc?.round - 1) {
    const [fx, fy] = d.xy(foe.tile);
    const near = targets.find((m) => { const [mx, my] = d.xy(m.tile); return Math.hypot(mx - fx, my - fy) <= 3 && d.los(fx, fy, mx, my); });
    if (near) return { route: null, spit: near };
  }

  // otherwise walk toward a target: cost to every tile, then the reachable tile that ends
  // beside the chosen target and is cheapest, or failing that the tile that gets closest
  const { dist } = d.search(foe.tile, opts);
  const goals = [];
  for (const m of targets) {
    const [mx, my] = d.xy(m.tile);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!d.inside(mx + dx, my + dy)) continue;
      const i = d.idx(mx + dx, my + dy);
      if (dist[i] < Infinity && g.inMelee(i, m.tile)) goals.push({ i, m, cost: dist[i] });
    }
  }
  if (!goals.length) return null;
  goals.sort((a, b) => (foe.def.rig === 'rat' ? a.m.hp - b.m.hp || a.cost - b.cost : a.cost - b.cost));
  const goal = goals[0];
  const path = d.pathTo(foe.tile, goal.i, opts).tiles;
  // as far along it as this turn's move allows
  let k = 0, spent = 0;
  while (k + 1 < path.length) {
    const c = d.step(path[k], path[k + 1], opts);
    if (spent + c > foe.def.mv) break;
    spent += c; k++;
  }
  let route = path.slice(0, k + 1);
  // the fighter holds the line: stepping next to him ends the move
  const fighters = g.party.filter((m) => m.def.cls === 'Fighter' && g.canAct(m));
  if (!fighters.some((m) => g.inMelee(foe.tile, m.tile))) {
    const stop = route.findIndex((i, n) => n > 0 && fighters.some((m) => g.inMelee(i, m.tile)));
    if (stop > 0) route = route.slice(0, stop + 1);
  }
  const end = route[route.length - 1];
  return { route: route.length > 1 ? route : null, target: g.inMelee(end, goal.m.tile) ? goal.m : null };
}

// The goblins' loop: along the path the room script laid out, as far as this turn's move goes,
// leaping the pit on the way. At the end of it they're back, behind the party.
function loop(g, foe, blocked) {
  const path = foe.loop, start = foe.loopK;
  // somebody in the way: the run is over, and it fights
  if (start + 1 < path.length && blocked[path[start + 1]]) { foe.state = 'fighting'; foe.loop = null; return foeTurn(g, foe); }
  let k = start;
  while (k + 1 < path.length && k - start < foe.def.mv && !blocked[path[k + 1]]) k++;
  foe.loopK = k;
  if (k === path.length - 1) {
    foe.loop = null;
    // a scripted run's end (Odric at his stairs): the room scripts take it from there
    if (foe.loopEnd) { const end = foe.loopEnd; foe.loopEnd = null; g.runScripts('loopEnd', foe, end); return { route: k > start ? path.slice(start, k + 1) : null, target: null }; }
    foe.state = 'fighting';
    if (!g.scriptState.goblins?.back) { (g.scriptState.goblins ||= {}).back = true; g.say('Running feet behind you: the goblins are back, by the door you came in!'); }
  }
  return { route: k > start ? path.slice(start, k + 1) : null, target: null };
}

// A denizen's spell, if it has one worth casting now: Hold Person on the fighter (or whoever has
// the most hit points) in sight; Cure Light Wounds on a badly hurt friend beside it.
function cast(g, foe, targets) {
  const spells = foe.def.spells || [], done = foe.cast || {}, d = g.dungeon, [fx, fy] = d.xy(foe.tile);
  if (spells.includes('hold') && !done.hold) {
    const seen = targets.filter((m) => g.canAct(m) && d.los(fx, fy, ...d.xy(m.tile)) && g.distTo(foe.tile, m.tile) <= 12);
    const t = seen.find((m) => m.def.cls === 'Fighter') || seen.sort((a, b) => b.maxHp - a.maxHp)[0];
    if (t) return { spell: 'hold', target: t };
  }
  if (spells.includes('cure') && !done.cure) {
    const hurt = g.foes.find((f) => f.alive && f !== foe && f.group === foe.group && f.hp <= f.maxHp / 2 && g.inMelee(foe.tile, f.tile));
    if (hurt) return { spell: 'cure', target: hurt };
  }
  return null;
}

// Run: the reachable tile furthest from the party.
function flee(g, foe, opts) {
  const d = g.dungeon, { dist, prev } = d.search(foe.tile, { ...opts, budget: foe.def.mv });
  let best = foe.tile, bestScore = -1;
  for (let i = 0; i < d.n; i++) {
    if (dist[i] === Infinity) continue;
    const [x, y] = d.xy(i);
    const near = Math.min(...g.party.filter((m) => !m.dead).map((m) => { const [mx, my] = d.xy(m.tile); return Math.hypot(mx - x, my - y); }));
    if (near > bestScore) { bestScore = near; best = i; }
  }
  const route = [];
  for (let i = best; i !== -1; i = prev[i]) route.push(i);
  route.reverse();
  return { route: route.length > 1 ? route : null, target: null };
}
