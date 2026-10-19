// Treasure (PLAN.md 5, 6.3, Appendix B): coins and valuables, what they weigh, keys, searching
// the bodies, the chests (locks and needle traps), what a search of a cleared room turns up, room
// 11's urns, and heaps of coins too heavy to carry without thinking about it. Each function takes
// the game.
import { COINS, COIN_NAMES, CARRY, ITEMS } from './defs.js';
import { percent, inSix, save, roll, SMASH_BREAK } from './rules.js';
import { T } from './dungeon.js';

// More coins than this of one kind are left in a heap: the party decides whether to carry them
// (3,004 cp is the classic "is it worth it?", PLAN.md 6.3).
export const BIG_PILE = 500;

const fmt = (n) => n.toLocaleString('en-GB');
export const coinText = (kind, n) => `${fmt(n)} ${kind}`;

// What it's all worth in gold, and what it weighs in coins (cn).
export function worth(g) {
  let gp = 0;
  for (const [k, v] of Object.entries(g.purse)) gp += v * COINS[k];
  for (const t of g.treasure) gp += t.gp;
  return gp;
}
export function weight(g) {
  let cn = 0;
  for (const v of Object.values(g.purse)) cn += v;
  for (const t of g.treasure) cn += t.cn;
  return cn;
}
// Everyone on their feet carries their share; a heavier load halves the party's speed.
export const capacity = (g) => CARRY * g.party.filter((m) => !m.dead && !m.status.stricken).length;
export const burdened = (g) => weight(g) > capacity(g);

// Take what's found: coins (big heaps stay where they are, as a choice), items, Odric's keys,
// scrolls (to whoever can read them) and the robes from room 15. Returns a description.
export function gain(g, loot, at) {
  const parts = [];
  for (const kind of Object.keys(COINS)) {
    const n = loot[kind];
    if (!n) continue;
    if (n >= BIG_PILE && at !== undefined) {
      g.piles.push({ level: g.L.id, i: at, kind, n });
      parts.push(`${coinText(kind, n)}, too many to scoop up without thinking (${fmt(n)} cn)`);
    } else { g.purse[kind] += n; parts.push(coinText(kind, n)); }
  }
  for (const it of loot.items || []) { g.treasure.push({ ...it }); parts.push(`a ${it.name} (${it.gp} gp)`); }
  if (loot.keys) { g.keys.add('odric'); parts.push("Odric's ring of iron keys"); }
  for (const [id, n] of Object.entries(loot.scrolls || {})) {
    const reader = g.party.find((m) => m.def.cls === 'Cleric' && !m.dead) || g.party.find((m) => !m.dead);
    reader.items[id] = (reader.items[id] || 0) + n;
    parts.push(`${n > 1 ? `${n} ` : 'a '}${ITEMS[id].name.toLowerCase().replace('scroll', n > 1 ? 'scrolls' : 'scroll')}`);
  }
  if (loot.robes) { g.state.robes = true; parts.push('green and white robes, enough for everyone'); }
  // (sound never touches the dice: without audio, nothing here rolls)
  if (parts.length && g.audio) { g.sfx('coins', g.leader); g.bark(g.party.find((m) => !m.dead), 'treasure', 0.5); }
  return parts.join(', ');
}

// ---------- the bodies ----------
// Dead denizens near the party with something on them (PLAN.md 6.3: coins on the orcs need a search).
export function bodies(g) {
  return g.foes.filter((f) => f.dead && f.loot && g.party.some((m) => !m.dead && g.distTo(m.tile, f.tile) <= 2.5));
}
export function searchBodies(g) {
  const found = bodies(g);
  g.advance(10);
  const what = found.map((f) => { const t = gain(g, f.loot, f.tile); f.loot = null; return t; }).filter(Boolean);
  g.say(`The party goes through the bodies: ${what.join('; ')}.`);
  if (g.keys.has('odric') && found.some((f) => f.kind === 'odric')) g.say("The keys will open the cells, the treasure chamber, and its chests.");
}

// ---------- coin heaps ----------
export const heapsNear = (g) => g.piles.filter((p) => p.level === g.L.id && g.party.some((m) => !m.dead && g.distTo(m.tile, p.i) <= 1.5));
export function takeHeap(g, p) {
  g.piles.splice(g.piles.indexOf(p), 1);
  g.purse[p.kind] += p.n;
  g.advance(10);
  g.say(`The party bags up ${coinText(p.kind, p.n)}.${burdened(g) ? ' Loaded down like this, everyone moves at half speed.' : ''}`);
}
// Too heavy: leave the cheapest coins behind in a heap where the party stands.
export function dropCheapest(g) {
  const kind = Object.keys(COINS).find((k) => g.purse[k] > 0);
  const n = g.purse[kind];
  g.purse[kind] = 0;
  g.piles.push({ level: g.L.id, i: g.leader.tile, kind, n });
  g.say(`The party tips out its ${COIN_NAMES[kind]}: ${coinText(kind, n)} left in a heap on the floor.`);
}

// ---------- chests (rooms 14, 15 and 19) ----------
// The chest the action bar works on: the nearest unfinished one beside the party.
export function activeChest(g) {
  const d = g.dungeon;
  let best = null, bd = 1.8;
  for (const c of g.chests) {
    if (c.done) continue;
    for (const m of g.party) {
      if (m.dead) continue;
      const [x, y] = d.xy(m.tile), dist = Math.hypot(x + 0.5 - c.at[0], y + 0.5 - c.at[1]);
      if (dist < bd) { bd = dist; best = c; }
    }
  }
  return best;
}
const thiefBy = (g, c) => g.party.find((m) => m.def.skills && g.canAct(m) && Math.hypot(g.dungeon.xy(m.tile)[0] + 0.5 - c.at[0], g.dungeon.xy(m.tile)[1] + 0.5 - c.at[1]) <= 1.8);
const opener = (g, c) => g.party.filter((m) => g.canAct(m)).sort((a, b) => dist2(g, a, c) - dist2(g, b, c))[0];
const dist2 = (g, m, c) => { const [x, y] = g.dungeon.xy(m.tile); return Math.hypot(x + 0.5 - c.at[0], y + 0.5 - c.at[1]); };
export const chestName = (c) => (c.robes ? 'the chest of robes' : c.id === 'chest19' ? "the goblins' chest" : `chest ${c.id.slice(-1)}`);

// Look for a needle: the thief's Find Traps, anyone else 1 in 6. A turn.
export function checkChest(g, c) {
  const t = thiefBy(g, c), who = t || opener(g, c);
  const r = t ? percent(g.rng, t.def.skills.findTraps) : inSix(g.rng, 1);
  g.advance(10);
  c.checked = (c.checked || 0) + 1;
  if (c.trap && r.ok) { c.found = true; g.say(`${who.def.name} finds a needle set in the lock of ${chestName(c)}, its tip stained dark (${r.text}).`); }
  else g.say(`${who.def.name} goes over ${chestName(c)} for a turn and finds no trap (${r.text}).`);
}
// Remove a found needle: the thief's Remove Traps (the same 15%). Failing by 20 or more springs it.
export function disarmChest(g, c) {
  const t = thiefBy(g, c), r = percent(g.rng, t.def.skills.findTraps);
  g.advance(10);
  if (r.ok) { c.disarmed = true; g.say(`${t.def.name} eases the needle out of the lock (${r.text}).`); return; }
  if (r.roll - t.def.skills.findTraps >= 20) { g.say(`${t.def.name}'s pick slips, and the needle jabs his thumb (${r.text})!`); spring(g, c, t); return; }
  g.say(`${t.def.name} can't get the needle out, not yet (${r.text}).`);
}
// The needle (PLAN.md 6.3): chest 3's paralyses for 2d4 turns; chest 4's kills in 10 turns unless
// Cure Light Wounds is cast on the victim.
function spring(g, c, m) {
  c.sprung = true;
  g.sfx('needle', m);
  const s = save(g.rng, m.def.cls, 'poison');
  if (s.ok) { g.say(`A needle pricks ${m.def.name}, but the poison doesn't take (${s.text}).`); return; }
  if (c.trap === 'paralysis') {
    m.status.paralysed = roll(g.rng, '2d4') * 10;
    g.say(`A needle pricks ${m.def.name}: paralysed for ${m.status.paralysed / 10} turns (${s.text}). Cure Light Wounds or a potion will free them.`);
  } else {
    m.status.poisoned = 100;
    g.say(`A needle pricks ${m.def.name}. A deadly poison: in 10 turns it will finish them, unless Cure Light Wounds drives it out (${s.text})!`);
  }
  g.float(m, 'poisoned', 'kill');
}
// Pick or smash a chest's lock (Odric's keys just open it).
export function pickChest(g, c) {
  const t = thiefBy(g, c), r = percent(g.rng, t.def.skills.openLocks);
  if (!r.ok) { g.advance(10); g.say(`${t.def.name} works at the lock of ${chestName(c)} for a turn, without luck (${r.text}).`); return; }
  g.advance(1);
  c.lock = false;
  g.say(`The lock of ${chestName(c)} clicks open under ${t.def.name}'s picks (${r.text}).`);
}
export function smashChest(g, c) {
  const m = opener(g, c), r = percent(g.rng, SMASH_BREAK);
  g.advance(1);
  c.lock = false;
  g.noise(m.tile, 14);
  g.say(`${m.def.name} smashes the lock off ${chestName(c)}.`);
  if (r.ok && !m.broken) { m.broken = true; g.say(`${m.def.name}'s weapon cracks in the blow (${r.text}).`); }
}
export function openChest(g, c) {
  const m = opener(g, c);
  if (c.lock && g.keys.has('odric') && c.room === '14') { c.lock = false; g.say(`One of Odric's keys fits ${chestName(c)}.`); }
  g.advance(1);
  g.sfx('chest', c.i);
  if (c.trap && !c.disarmed && !c.sprung) spring(g, c, m);
  c.opened = true;
  const loot = { gp: c.gp, sp: c.sp, cp: c.cp, items: c.items, scrolls: c.scrolls, robes: c.robes };
  const what = gain(g, loot, c.i);
  g.say(what ? `${m.def.name} opens ${chestName(c)}: ${what}.` : `${m.def.name} opens ${chestName(c)}. It's empty.`);
  // a false bottom is found only by searching the opened chest
  c.done = !c.hidden;
  g.rebuild();
}
// Searching a room with an opened chest in it finds a false bottom on 1-2 in 6 (anyone).
export function searchChests(g) {
  for (const c of g.chests) {
    if (!c.opened || !c.hidden || !g.party.some((m) => !m.dead && dist2(g, m, c) <= 2.5)) continue;
    const r = inSix(g.rng, 2);
    if (!r.ok) continue;
    const what = gain(g, c.hidden, c.i);
    c.hidden = null; c.done = true;
    g.say(`Knocking on the bottom of ${chestName(c)}: it's hollow. A false bottom, and under it ${what} (${r.text})!`);
    return true;
  }
  return false;
}

// ---------- what a search of a cleared room turns up ----------
export function searchCaches(g) {
  const d = g.dungeon;
  let found = false;
  for (const c of g.caches) {
    if (c.found) continue;
    const room = d.byId[c.room];
    if (!room || !g.party.some((m) => !m.dead && d.roomOf(m.tile) === room)) continue;
    // its denizens are seen to first
    if (g.foes.some((f) => f.alive && !f.fled && d.roomOf(f.tile) === room && !['bound', 'surrendered', 'charmed', 'ally'].includes(f.state))) continue;
    c.found = true; found = true;
    if (c.map !== undefined) { readMap(g, c); continue; }
    g.say(`${c.text}. The party takes ${gain(g, c, g.leader.tile)}.`);
  }
  return found;
}
// A map: room 9's (20%) shows the whole dungeon; the corpse's in 20 shows rooms 1, 2 and 5.
function readMap(g, c) {
  const d = g.dungeon;
  if (typeof c.map === 'number') {
    const r = percent(g.rng, c.map * 100);
    if (!r.ok) { g.say(`${c.text}: accounts, letters, a list of names. Nothing useful (${r.text}).`); return; }
    for (let i = 0; i < d.n; i++) if (d.t[i] !== T.ROCK && !g.hiddenDoor(i)) g.explored[i] = 1;
    g.say(`${c.text}: among them, a map of the whole dungeon (${r.text})! The automap fills in.`);
  } else {
    for (const id of [...c.map, 'entrance']) for (const i of d.byId[id]?.tiles || []) g.explored[i] = 1;
    g.say(`${c.text}. The automap fills in.`);
  }
  g.exploredVersion++; g.ui.viewKey = null;
}

// ---------- room 11's urns ----------
// A pearl in each, but only smashing gets it out, and only a crushing weapon smashes them.
export function urnsHere(g) {
  const d = g.dungeon, room = d.byId[g.data.URNS?.room];
  return room && g.state.urns > 0 && g.party.some((m) => !m.dead && d.roomOf(m.tile) === room) ? room : null;
}
const masher = (g) => g.party.find((p) => g.canAct(p) && (p.def.gear.mace || p.def.gear.club));
export function smashUrn(g) {
  const m = masher(g);
  g.state.urns--;
  g.advance(1);
  g.sfx('urn', m);
  g.noise(m.tile, 10);
  g.treasure.push({ ...g.data.URNS.pearl });
  g.rebuild();
  g.say(`${m.def.name} brings the mace down on an urn. Among the shards and ashes, a pearl (60 gp). ${g.state.urns ? `${g.state.urns} urns left.` : 'That was the last.'}`);
}

// ---------- the action bar's share ----------
export function actions(g) {
  const out = [];
  if (g.mode !== 'explore' || g.busy) return out;
  const near = bodies(g);
  if (near.length) out.push({ id: 'loot', icon: '⛁', label: 'Search the bodies', hint: 'A turn', ok: true, run: () => searchBodies(g) });
  for (const p of heapsNear(g)) {
    out.push({ id: `heap:${p.kind}`, icon: '⛀', label: `Take the ${COIN_NAMES[p.kind]} (${fmt(p.n)})`, hint: `${fmt(p.n)} cn: carrying ${fmt(weight(g))} of ${fmt(capacity(g))} before slowing down`, ok: true, run: () => takeHeap(g, p) });
  }
  if (burdened(g)) out.push({ id: 'drop', icon: '⛀', label: `Leave the ${COIN_NAMES[Object.keys(COINS).find((k) => g.purse[k] > 0)]}`, hint: 'Lighten the load: the cheapest coins stay behind', ok: true, run: () => dropCheapest(g) });
  const c = activeChest(g);
  if (c) g.tip('chest');
  if (burdened(g)) g.tip('heavy');
  if (c) {
    const name = chestName(c), t = thiefBy(g, c);
    if (!c.opened) {
      const locked = c.lock && !(g.keys.has('odric') && c.room === '14');
      out.push({ id: 'chest', icon: '⊟', label: `Open ${name}`, hint: locked ? 'Locked' : c.found && !c.disarmed ? 'The needle is still in the lock!' : 'Lift the lid', ok: !locked, run: () => openChest(g, c) });
      if (c.room !== '15' && c.room !== '19') out.push({ id: 'ctraps', icon: '⚠', label: `Check ${name} for traps`, hint: t ? `${t.def.name}: Find Traps ${t.def.skills.findTraps}%, a turn` : '1 in 6, a turn', ok: true, run: () => checkChest(g, c) });
      if (c.found && !c.disarmed && !c.sprung) out.push({ id: 'disarm', icon: '✂', label: 'Remove the needle', hint: t ? `${t.def.name}: ${t.def.skills.findTraps}%; failing badly springs it` : 'Needs the thief', ok: !!t, run: () => disarmChest(g, c) });
      if (locked) {
        out.push({ id: 'cpick', icon: '⚷', label: 'Pick the lock', hint: t ? `${t.def.name}: Open Locks ${t.def.skills.openLocks}%` : 'Needs the thief beside it', ok: !!t, run: () => pickChest(g, c) });
        out.push({ id: 'csmash', icon: '⚒', label: 'Smash the lock', hint: 'Loud, and the weapon may break', ok: true, run: () => smashChest(g, c) });
      }
    }
  }
  if (urnsHere(g)) {
    const m = masher(g);
    out.push({ id: 'urn', icon: '⚱', label: `Smash an urn (${g.state.urns} left)`, hint: m ? `${m.def.name}'s mace: loud` : 'Needs a crushing weapon', ok: !!m, run: () => smashUrn(g) });
  }
  return out;
}
