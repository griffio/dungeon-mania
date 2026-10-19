// The sword and the way out (PLAN.md 5, 6.3): taking up the Sword of the Sorcerer in 23, its hum
// near anything Chaotic, the dungeon re-alerted behind the party, leaving by either exit (the
// entrance tunnel or Odric's stairs from 15), and the DM's tally at the end.
import { talk } from './dialogue.js';
import * as treasure from './treasure.js';

export const SWORD = { name: 'Sword of the Sorcerer', dmg: '1d8', plus: 2 };
export const SWORD_TILE = [13, 32];   // behind the lizardman's rock
export const HUM_RANGE = 4;           // tiles: 20 ft (PLAN.md 5)

// ---------- the sword ----------
export function swordFree(g) {
  const liz = g.foes.find((f) => f.kind === 'lizardman');
  const s = g.scriptState.lizardman || {};
  return !liz?.alive || liz.fled || s.bribed || liz.status.charmed || liz.status.asleep || liz.state === 'charmed';
}
export function takeSword(g) {
  const w = g.party.find((p) => p.def.cls === 'Fighter' && !p.dead) || g.party.find((p) => g.canAct(p));
  g.state.sword = w.id;
  w.weapon = SWORD;
  g.advance(1);
  g.say(`Behind the rock, wrapped in oilcloth, lies a long sword with a plain grey hilt. As ${w.def.name} closes a hand round it the blade wakes with a low hum. The Sword of the Sorcerer (+2)! Beside it, a bag of ${treasure.gain(g, { cp: 5 })}.`);
  g.ui.banner?.('The Sword of the Sorcerer');
  g.sfx('sting_sword');
  g.narrate('moment:sword');
  g.say('The sword hums near anything Chaotic, 20 ft and closing. Now get out alive: up the entrance tunnel, or by Odric\'s stairs from room 15.');
  realert(g);
}
// The hum: the nearest Chaotic creature within 20 ft of the sword, through walls. Returns
// { foe, dist, dx, dz } or null.
export function hum(g) {
  const w = g.state.sword && g.member(g.state.sword);
  if (!w || w.dead) return null;
  let best = null;
  for (const f of g.foes) {
    if (!f.alive || f.fled || f.def.align !== 'C') continue;
    const dx = f.x - w.x, dz = f.z - w.z, dist = Math.hypot(dx, dz);
    if (dist <= HUM_RANGE && (!best || dist < best.dist)) best = { foe: f, dist, dx: dx / (dist || 1), dz: dz / (dist || 1), w };
  }
  return best;
}

// ---------- re-alerting (PLAN.md 6.3) ----------
// If Odric got away, he comes back down his stairs with whatever priests and orcs are left, and
// they wait for the party at the ways out.
const CHOKEPOINTS = [[8, 25], [44, 14], [30, 22], [45, 14], [9, 25], [31, 22]];
export function realert(g) {
  if (g.state.odric !== 'escaped') return;
  const back = g.foes.filter((f) => !f.dead && (f.kind === 'orc' || f.def.cult) && !['bound', 'ally', 'charmed'].includes(f.state));
  if (!back.length) return;
  back.forEach((f, k) => {
    const [x, y] = CHOKEPOINTS[k % CHOKEPOINTS.length], i = g.freeTileNear(g.dungeon.idx(x, y), f);
    Object.assign(f, { tile: i, x: g.dungeon.xy(i)[0] + 0.5, z: g.dungeon.xy(i)[1] + 0.5, fled: false, alive: true, state: 'alert', route: null, loop: null });
  });
  g.state.realerted = true;
  g.say('Far off, a gong sounds, and keeps sounding. Odric is back, and he knows what you have taken. The ways out will be watched.');
}

// ---------- leaving ----------
// Climbing out with prisoners: they're free. The merchant pays his 50 gp.
export function reachSurface(g) {
  if (g.escort && !g.escort.fled) {
    g.state.prisonersOut = (g.state.prisonersOut || 0) + g.escort.count;
    g.say(`${g.escort.count} prisoner${g.escort.count === 1 ? '' : 's'} stumble out into the open air, weeping and laughing.`);
    if (g.escort.merchant) g.say(`Ambrose Tull, merchant, pumps everyone's hands and counts out his reward: ${treasure.gain(g, { gp: 50 })}.`);
    g.escort.fled = true;
    g.followers.splice(g.followers.indexOf(g.escort), 1);
    g.escort = null;
  }
  const dea = g.followers.find((f) => f.kind === 'archdeaconess');
  if (dea) { g.followers.splice(g.followers.indexOf(dea), 1); dea.state = 'parley'; g.state.deaconess = 'peace'; g.say('"I will find it myself," says the Arch-deaconess, and turns back into the dark.'); }
}
export function leave(g) {
  talk(g, { who: null, name: 'Leave Kollchap?', text: g.state.sword
    ? 'The sword is yours. Head back to the village, and tell the tale?'
    : 'You don\'t have the sword. Leave the shrine of Kollchap to its priests, and go home?', options: [
    { label: 'Head home', run: () => finish(g, 'left') },
    { label: 'Not yet', run: () => {} },
  ] });
}

// ---------- the tally (PLAN.md 5): the DM's reckoning, in B/X experience ----------
export function finish(g, how) {
  g.mode = 'over';
  g.enc = null;
  const t = tally(g, how);
  g.sfx(how === 'dead' ? 'sting_defeat' : 'sting_victory');
  g.narrate(`end:${t.key}`);
  g.ui.ending?.(g, t);
}
export function tally(g, how) {
  const monsterXp = g.kills.reduce((n, d) => n + (d.xp || 0), 0);
  const gp = Math.floor(treasure.worth(g));
  const lost = g.party.filter((m) => m.dead || m.status.stricken);
  const st = g.state, freed = st.prisonersOut || 0;
  const rows = [
    ['The Sword of the Sorcerer', st.sword && how !== 'dead' ? 'Recovered' : 'Still below'],
    ['Rosa Dobbit', st.rosa === 'rescued' ? (g.member('rosa')?.dead ? 'Rescued, then lost' : 'Rescued') : st.rosa === 'sacrificed' ? 'Sacrificed' : st.rosa === 'killed' ? 'Killed' : 'Never found'],
    ['Prisoners freed', `${freed} of 8${freed ? ' brought out' : ''}`],
    ['Odric', st.odric === 'killed' ? 'Slain' : st.odric === 'escaped' ? 'Escaped' : 'Untouched'],
    ['The Arch-deaconess', { guided: 'Guided to her statue', killed: 'Slain', fought: 'Fought, and left alive', peace: 'At peace', guiding: 'Left behind', met: 'Met, and left to her papers' }[st.deaconess] || 'Never met'],
    ['Treasure carried out', how === 'dead' ? '—' : `${gp.toLocaleString('en-GB')} gp`],
    ['Monsters slain', `${g.kills.length} (${monsterXp} XP)`],
    ['Time in the dungeon', `${Math.round(g.clock / 10)} turns, ${g.roundsFought} combat rounds`],
    ['Characters lost', lost.length ? lost.map((m) => `${m.def.name}${m.petrified ? ' (stone)' : m.status.stricken ? ' (poisoned)' : ''}`).join(', ') : 'None'],
  ];
  const xp = how === 'dead' ? 0 : monsterXp + gp;
  const survivors = g.party.filter((m) => !m.dead && !m.status.stricken).length;
  const share = survivors ? Math.floor(xp / survivors) : 0;
  let title, text, key;
  if (how === 'dead') { key = 'dead'; title = 'The party has fallen'; text = 'Kollchap keeps its sword, and the goddess her offerings. Perhaps another band will come.'; }
  else if (!st.sword) { key = 'empty'; title = 'Home, empty-handed'; text = 'The party limps back to the village with its scars and what silver it could carry. The sword still lies in the dark below the shrine.'; }
  else if (st.odric === 'killed' && freed >= 8 && st.rosa === 'rescued') { key = 'broken'; title = 'The shrine is broken'; text = 'The Sword of the Sorcerer is recovered, Odric is dead, and every prisoner walks home. Kollchap village rings its bell all night. The shrine will be pulled down stone by stone.'; }
  else if (st.odric === 'escaped') { key = 'escaped'; title = 'The sword, but not the priest'; text = 'The Sword of the Sorcerer is recovered. But somewhere Odric is still alive, and he will not forget who robbed his goddess.'; }
  else { key = 'sword'; title = 'The sword recovered'; text = `The Sword of the Sorcerer is recovered and carried home in triumph.${freed ? ` ${freed} prisoners walk home with you.` : ''}`; }
  return { how, key, title, text, rows, xp, share, survivors };
}

// ---------- the action bar's share ----------
export function actions(g) {
  const out = [];
  if (g.mode !== 'explore' || g.busy) return out;
  const d = g.dungeon;
  if (g.L.id === 'dungeon' && !g.state.sword) {
    const i = d.idx(...SWORD_TILE);
    if (g.party.some((m) => g.canAct(m) && g.distTo(m.tile, i) <= 1.5)) out.push({ id: 'sword', icon: '🗡', label: 'Take the sword', hint: swordFree(g) ? 'Behind the rock' : 'The lizardman is watching', ok: swordFree(g), run: () => takeSword(g) });
  }
  if (g.L.id === 'surface' && g.state.wentDown) out.push({ id: 'leave', icon: '⌂', label: 'Head home', hint: 'End the adventure', ok: true, run: () => leave(g) });
  return out;
}
