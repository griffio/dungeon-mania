// Traps and hazards (PLAN.md 3.6, 6.3): pits and climbing, the rope bridge, room 3's rotten door,
// the 10' pole, and the green slime in corridor 4. Each function takes the game.
import { T } from './dungeon.js';
import { die, percent } from './rules.js';

// Room 3's floorless room: the pits a rope bridge can span.
const ROOM3 = '3';

// Is tile i a pit the party can see (a hidden one looks like floor)?
export const knownPit = (g, i) => g.dungeon.t[i] === T.PIT && !g.hiddenTrapAt(i);
// The bridge runs from the rotten door to the ledge: the pit tiles in the door's row.
export function bridgeTiles(g) {
  const d = g.dungeon, room = d.byId[ROOM3], door = [...d.doors.values()].find((x) => x.rotten || x.smashed);
  if (!g.state.bridge || !room || !door) return [];
  const row = d.xy(door.i)[1];
  return room.tiles.filter((i) => d.t[i] === T.PIT && d.xy(i)[1] === row);
}
const bridged = (g, i) => bridgeTiles(g).includes(i);

// A unit steps from tile a onto tile b. Party members fall into hidden pits, climb in and out of
// known ones, and walk under the slime; goblins leap the pit at 18 (which shows where it is).
export function onEnter(g, u, a, b) {
  const d = g.dungeon;
  const [ax, ay] = d.xy(a), [bx, by] = d.xy(b);
  if (u.side !== 'party') {
    // a denizen opens a closed door it walks through
    const door = d.doors.get(b);
    if (door && !door.open) {
      door.open = true;
      if (g.visible[b] || g.party.some((m) => !m.dead && g.distTo(m.tile, b) <= 6)) g.say(`A door bangs open: the ${u.def.name.toLowerCase()} is through it.`);
      g.doorsChanged();
    }
    const trap = g.hiddenTrapAt(b);
    if (trap && g.visible[b]) g.revealTrap(trap, `A goblin leaps over a patch of floor as if it weren't there. There's a pit in it`);
    return;
  }
  // the tunnel from 9 down to 18 (and back up): the old handholds
  if (Math.max(Math.abs(ax - bx), Math.abs(ay - by)) > 1) {
    const up = d.t[a] === T.PIT;
    if (up) climb(g, u, 'up the tunnel to the covered pit in room 9', true);
    return;
  }
  const hidden = g.hiddenTrapAt(b);
  if (hidden) {
    g.revealTrap(hidden, `The floor gives way under ${u.def.name}!`);
    fall(g, u, 10);
    g.haltParty(u, b);
    return;
  }
  // crossing a pit is one climb, down and up again: the check comes on the way out (unless a
  // rope bridge spans it)
  if (d.t[a] === T.PIT && d.t[b] !== T.PIT && !bridged(g, a)) climb(g, u, 'out of the pit');
  // the slime drops on whoever passes beneath it
  const slime = g.foes.find((f) => f.def.rig === 'slime' && f.alive && f.state === 'lurking' && f.tile === b);
  if (slime) drop(g, slime, u, b);
}

// A climb: the thief climbs walls (plan: automatic in the pits; the tunnel is his 88%); anyone
// else makes a DEX check or falls.
function climb(g, u, where, tunnel = false) {
  if (u.def.skills) {
    if (!tunnel) return;
    const r = percent(g.rng, u.def.skills.climbWalls);
    if (r.ok) return;
    g.say(`${u.def.name} loses a handhold climbing ${where} (${r.text}).`);
    fall(g, u, 10);
    return;
  }
  const r = die(g.rng, 20);
  if (r <= u.def.dex) return;
  g.say(`${u.def.name} slips climbing ${where} (d20 ${r} against DEX ${u.def.dex}).`);
  fall(g, u, 10);
}
// A fall: 1d6 per 10 ft.
export function fall(g, u, ft) {
  const n = die(g.rng, 6) * (ft / 10);
  u.hp -= n;
  u.flash = 1;
  g.float(u, `-${n}`, 'dmg');
  g.say(`${u.def.name} falls ${ft} ft for ${n} damage.`);
  if (u.hp <= 0) { u.hp = 0; if (!u.downed) u.downed = 3; g.say(`${u.def.name} lies broken at the bottom.`); }
}

// ---------- the 10' pole ----------
// Probing ahead with the pole: walking takes twice as long, but a covered pit on the way is found
// before anyone steps on it. Called with the leader's planned path; returns where to stop.
export function probe(g, path) {
  if (!g.probing) return path;
  for (let k = 1; k < path.length; k++) {
    const trap = g.hiddenTrapAt(path[k]);
    if (trap) { g.revealTrap(trap, 'The tip of the pole sinks through the floor ahead: a covered pit'); return path.slice(0, k); }
  }
  return path;
}

// ---------- the green slime (room 4) ----------
// It drops on a passer-by and starts eating: 6 rounds until the victim is slime too. Only fire
// hurts it; burning it off hurts the victim half as much.
function drop(g, slime, u, tile) {
  g.haltParty(u, tile);
  slime.on = u; slime.state = 'feeding'; slime.spotted = true;
  slime.tile = tile; slime.x = u.x; slime.z = u.z;
  u.status.slimed = 6;
  g.say(`Something cold and wet drops from the wall onto ${u.def.name}: green slime! It is already eating into armour and flesh.`);
  g.startEncounter('slime', { partySurprised: false, foesSurprised: false });
}
// Fire against the slime: a torch (1d4) or a flask of oil (1d8).
export function burn(g, m, slime, how) {
  const n = die(g.rng, how === 'oil' ? 8 : 4);
  if (how === 'oil') m.flasks--;
  m.acted = true;
  const victim = slime.on;
  g.say(`${m.def.name} ${how === 'oil' ? 'dashes a flask of burning oil over' : 'thrusts the torch into'} the slime${victim ? ` on ${victim === m ? 'themself' : victim.def.name}` : ''}: ${n} fire.`);
  g.hurt(slime, n, m);
  if (victim) {
    const v = Math.ceil(n / 2);
    victim.hp -= v; victim.flash = 1; g.float(victim, `-${v}`, 'dmg');
    g.say(`${victim.def.name} is burnt too, for ${v}.`);
    if (victim.hp <= 0) { victim.hp = 0; if (!victim.downed) victim.downed = 3; }
    if (!slime.alive) { delete victim.status.slimed; g.say(`The slime shrivels and drops away from ${victim.def.name}.`); }
  }
  g.afterAction(m);
}
// Each round the slime eats; at the end of the sixth, the victim is gone.
export function slimeRound(g) {
  for (const m of g.party) {
    if (!m.status.slimed || m.dead) continue;
    if (--m.status.slimed > 0) { g.say(`The slime eats on: ${m.status.slimed} round${m.status.slimed === 1 ? '' : 's'} before ${m.def.name} is lost.`); continue; }
    delete m.status.slimed;
    m.dead = true; m.hp = 0; m.light = null;
    g.say(`${m.def.name} is gone: where they stood, a mound of green slime quivers.`);
    const s = g.foes.find((f) => f.on === m);
    if (s) { s.on = null; s.state = 'lurking'; }
    g.sightKey = '';
  }
}

// ---------- the action bar's share ----------
export function actions(g) {
  const out = [], d = g.dungeon, m = g.selected && g.member(g.selected);
  const enc = g.mode === 'encounter', idle = enc ? g.enc?.phase === 'party' && !g.busy : !g.busy;
  if (!idle) return out;
  // fire against the slime: a lit torch, or Ysolde's oil
  const slime = g.foes.find((f) => f.def.rig === 'slime' && f.alive && f.spotted);
  if (slime && m && !(enc && m.acted)) {
    const at = slime.on ? slime.on.tile : slime.tile, close = g.distTo(m.tile, at) <= 1.5;
    if (close && m.light === 'torch') out.push({ id: 'burn', icon: '🔥', label: slime.on ? `Burn the slime off ${slime.on === m ? 'yourself' : slime.on.def.name}` : 'Burn the slime', hint: 'Torch: 1d4 fire', ok: true, run: () => (enc ? burn(g, m, slime, 'torch') : startBurn(g, m, slime, 'torch')) });
    if (m.flasks > 0 && g.distTo(m.tile, at) <= 4) out.push({ id: 'oil', icon: '♨', label: 'Throw burning oil', hint: `1d8 fire (${m.flasks} flasks)`, ok: true, run: () => (enc ? burn(g, m, slime, 'oil') : startBurn(g, m, slime, 'oil')) });
  }
  if (enc) return out;
  // the pole
  const poler = g.party.find((p) => p.def.kit.pole && !p.dead);
  if (poler) out.push({ id: 'pole', icon: '⟊', label: g.probing ? 'Stop probing' : 'Probe with the pole', hint: 'Walk at half speed, feeling for pits ahead', ok: true, run: () => { g.probing = !g.probing; g.say(g.probing ? `${poler.def.name} goes ahead, tapping the floor with the 10' pole.` : 'The pole goes back on the pack.'); } });
  // a rope bridge over room 3's pit
  const roper = g.party.find((p) => p.def.kit.rope && !p.dead && !p.downed);
  if (roper && d.byId[ROOM3] && !g.state.rope && !g.state.bridge && g.party.some((p) => d.byId[ROOM3].tiles.some((i) => g.distTo(p.tile, i) <= 1))) {
    out.push({ id: 'bridge', icon: '⌇', label: 'Rig a rope bridge', hint: `${roper.def.name}'s rope and spikes across the pit: a turn`, ok: true, run: () => { g.advance(10); g.state.bridge = true; g.say(`${roper.def.name} spikes the rope from ledge to ledge: a way across the pit.`); g.rebuild(); } });
  }
  // room 3's rotten door: kick it in, or ease it open
  const door = g.activeDoor();
  if (door && door.rotten && !door.open) {
    out.splice(0, 0, { id: 'kick', icon: '⇥', label: 'Kick the door in', hint: 'Quick, but rotten wood gives way under you', ok: true, run: () => kick(g, door) });
    out.splice(1, 0, { id: 'ease', icon: '⇤', label: 'Ease it open', hint: 'A turn, and no risk', ok: true, run: () => { g.advance(10); door.open = true; g.say('Gently, the rotten door is worked open. Beyond it there is no floor: just a pit, and a ledge on the far side.'); g.doorsChanged(); } });
  }
  return out;
}
// Fire on a slime outside a fight starts one (it's a foe, after all).
function startBurn(g, m, slime, how) {
  g.startEncounter('slime', { foesSurprised: true });
  burn(g, m, slime, how);
}
// Kicking room 3's rotten door: it collapses into the pit, and the kicker may follow it down.
function kick(g, door) {
  const m = g.adjacentTo(door.i)[0];
  door.open = true; door.smashed = true; door.rotten = false;
  g.noise(door.i, 10);
  g.say(`${m.def.name} kicks the door: it bursts into rotten splinters and falls away into a pit beyond.`);
  const r = die(g.rng, 20);
  if (r > m.def.dex) {
    g.say(`${m.def.name} stumbles after it, over the edge (d20 ${r} against DEX ${m.def.dex})!`);
    const pit = g.dungeon.byId[ROOM3].tiles.find((i) => g.dungeon.t[i] === T.PIT && g.distTo(i, door.i) <= 1.5);
    if (pit !== undefined) { m.tile = pit; [m.x, m.z] = g.dungeon.xy(pit).map((v) => v + 0.5); }
    fall(g, m, 10);
  }
  g.doorsChanged();
}
