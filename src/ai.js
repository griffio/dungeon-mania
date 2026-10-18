// Denizen brains (PLAN.md 9), for M3's first monsters. A foe's turn is a plan: a route to walk
// (up to its encounter move) and, at the end of it, a party member to attack. The game carries
// it out with the same walking and attack code the party uses.
//   advance: rats go for the weakest, everyone else for the nearest they can reach
//   flee: a broken group runs from the party (morale, PLAN.md 3.4)

// Foes see the party: in line of sight, and lit or within their infravision (60 ft).
export const INFRA = 12;
export function canSee(g, foe, m) {
  const d = g.dungeon, [fx, fy] = d.xy(foe.tile), [mx, my] = d.xy(m.tile);
  const dist = Math.hypot(fx - mx, fy - my);
  if (dist > 1.5 && !(g.lit[m.tile] || (foe.def.infravision && dist <= INFRA))) return false;
  return d.los(fx, fy, mx, my);
}

export function foeTurn(g, foe) {
  const d = g.dungeon;
  const targets = g.party.filter((m) => !m.dead && !m.downed);
  if (!targets.length) return null;
  const blocked = g.blockedFor(foe);
  const opts = { closed: false, pits: false, blocked };
  if (foe.state === 'fleeing') return flee(g, foe, opts);

  // already beside someone: hit them (the weakest, for rats)
  const pick = (list) => (foe.def.rig === 'rat' ? list.reduce((a, b) => (b.hp < a.hp ? b : a)) : list[0]);
  const adjacent = targets.filter((m) => g.inMelee(foe.tile, m.tile));
  if (adjacent.length) return { route: null, target: pick(adjacent) };

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
  const route = path.slice(0, k + 1);
  const end = route[route.length - 1];
  return { route: route.length > 1 ? route : null, target: g.inMelee(end, goal.m.tile) ? goal.m : null };
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
