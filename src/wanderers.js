// Wandering monsters (PLAN.md 3.7). The scenario has no table, so the residents serve: every two
// turns below ground, on 1 in 6, a few of them leave their post (and so are gone from their room)
// and come looking: a two-orc patrol, a goblin runner, 1d4 giant rats, or a skeleton. They appear
// out of sight, a way off, and close in as the dungeon clock runs. An option (settings.js).
import { inSix, die } from './rules.js';

const CHECK = 20; // minutes: every two turns
const PACE = 1;   // tiles a wanderer covers per minute of game time (a cautious prowl)
const BANDS = [
  { group: 'orcs', n: () => 2, says: 'From somewhere close comes the scrape of hobnailed boots.' },
  { group: 'goblins', n: () => 1, says: 'Quick light footsteps patter somewhere in the dark.' },
  { group: 'rats', n: (g) => die(g.rng, 4), says: 'A skittering, and a squeak, not far off.' },
  { group: 'skeletons', n: () => 1, says: 'A dry clatter, like bones, comes down the passage.' },
];
// Residents who can wander: alive, at their post, not yet met.
const idle = (g, group) => g.foes.filter((f) => f.group === group && f.alive && !f.fled && !f.guard && (f.state === 'resting' || f.state === 'hidden'));

export function tick(g, minutes) {
  if (!g.prefs.wanderers || g.L.id !== 'dungeon' || g.mode !== 'explore') return;
  move(g, minutes);
  g.wanderClock = (g.wanderClock || 0) + minutes;
  while (g.wanderClock >= CHECK) {
    g.wanderClock -= CHECK;
    if (inSix(g.rng, 1).ok) spawn(g);
  }
}

export function spawn(g) {
  const bands = BANDS.filter((b) => idle(g, b.group).length);
  if (!bands.length) return null;
  const band = bands[Math.floor(g.rng() * bands.length)], who = idle(g, band.group).slice(0, band.n(g));
  // somewhere 8 to 14 steps away that the party can't see
  const d = g.dungeon, { dist } = d.search(g.leader.tile, { closed: true, pits: false });
  const spots = [];
  for (let i = 0; i < d.n; i++) if (dist[i] >= 8 && dist[i] <= 14 && !g.visible[i] && !d.doors.has(i) && !d.roomOf(i)?.id?.match(/^(12|21)$/)) spots.push(i);
  if (!spots.length) return null;
  const at = spots[Math.floor(g.rng() * spots.length)];
  for (const f of who) {
    const i = g.freeTileNear(at, f);
    Object.assign(f, { tile: i, x: d.xy(i)[0] + 0.5, z: d.xy(i)[1] + 0.5, state: 'wandering', route: null });
  }
  g.say(band.says);
  return who;
}

// Close in on the party: PACE tiles a minute, along the way there (opening doors as they go).
function move(g, minutes) {
  const d = g.dungeon, wanderers = g.foes.filter((f) => f.alive && !f.fled && f.state === 'wandering');
  if (!wanderers.length) return;
  for (const f of wanderers) {
    f.wanderLeft = (f.wanderLeft || 0) + minutes * PACE;
    const blocked = g.blockedFor(f);
    blocked[g.leader.tile] = 0; // the way to the leader (stopping a step short)
    const p = d.pathTo(f.tile, g.leader.tile, { closed: true, pits: false, blocked });
    if (!p) continue;
    while (f.wanderLeft >= 1 && p.tiles.length > 2) {
      f.wanderLeft -= 1;
      const [a, b] = [p.tiles.shift(), p.tiles[0]];
      g.onWanderStep(f, a, b);
    }
  }
}
