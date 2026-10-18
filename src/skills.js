// Thief skills and listening at doors (PLAN.md 3.5-3.6). Each function takes the game.
import { inSix, percent } from './rules.js';

const thief = (g) => g.party.find((m) => m.def.skills && !m.dead && !m.downed);

// Hide in Shadows: on a dark tile and carrying no light, Fennick melts into the shadows. Hidden,
// foes can't see or target him, and his next attack is a backstab (+4, double damage). It ends
// when he attacks, lights up or steps into the light.
export function canHide(g, m) { return m?.def.skills && !m.status.hidden && !m.light && !m.status.lightSpell && !g.lit[m.tile]; }
export function hide(g, m) {
  const r = percent(g.rng, m.def.skills.hideInShadows);
  if (r.ok) { m.status.hidden = true; g.say(`${m.def.name} melts into the shadows (${r.text}).`); }
  else g.say(`${m.def.name} tries to hide, but there's no cover dark enough (${r.text}).`);
  if (g.mode === 'encounter') { m.acted = true; g.afterAction(m); } else { g.advance(1); g.ui.update(g); }
}
// Out of hiding: called when the hidden one attacks, or ends up in light.
export function unhide(g, m, why) {
  if (!m.status.hidden) return;
  delete m.status.hidden;
  if (why) g.say(`${m.def.name} ${why}.`);
}

// Listen at a door: 1-2 in 6 for the thief, 1 for anyone else. Whoever is on the far side shows
// for a moment as a silhouette through the door.
export function listen(g, door) {
  const who = g.adjacentTo(door.i), ear = who.find((m) => m.def.skills) || who[0];
  const r = inSix(g.rng, ear.def.skills?.hearNoise || 1);
  g.advance(10);
  if (!r.ok) { g.say(`${ear.def.name} listens at the ${g.doorName(door)} for a turn and hears nothing (${r.text}).`); g.ui.update(g); return; }
  const rooms = new Set(door.rooms), d = g.dungeon;
  const heard = g.foes.filter((f) => f.alive && !f.fled && f.state !== 'hidden' && rooms.has(d.roomOf(f.tile)?.id));
  g.heard = { tiles: heard.map((f) => f.tile), until: g.time + 6 };
  g.say(heard.length
    ? `${ear.def.name} hears something beyond the ${g.doorName(door)}: ${describe(heard)} (${r.text}).`
    : `${ear.def.name} listens: all quiet beyond the ${g.doorName(door)} (${r.text}).`);
  g.ui.update(g);
}
function describe(foes) {
  const kinds = {};
  for (const f of foes) kinds[f.def.name] = (kinds[f.def.name] || 0) + 1;
  const sound = (f) => (f.status.asleep || f.state === 'resting' ? 'snoring' : f.state === 'cowering' ? 'whimpering' : 'shuffling');
  return Object.entries(kinds).map(([k, n]) => `${n > 1 ? 'several' : 'one'} ${k.toLowerCase()}${n > 1 ? 's' : ''}`).join(' and ') + `, ${sound(foes[0])}`;
}

// Find Traps: the thief checks the ground and walls within 2 tiles, 15% for each trap there.
export function findTraps(g, m) {
  const near = g.unfoundTraps().filter((t) => g.distTo(m.tile, t.i) <= 2);
  g.advance(10);
  let found = 0;
  for (const t of near) {
    const r = percent(g.rng, m.def.skills.findTraps);
    if (r.ok) { g.revealTrap(t, `${m.def.name} spots ${t.kind === 'pit' ? 'the edge of a covered pit in the floor' : 'a wet green sheen on the wall above: green slime'} (${r.text})`); found++; }
  }
  if (!found) g.say(`${m.def.name} checks the floor and walls nearby for a turn, and finds no traps.`);
  g.ui.update(g);
}

export function actions(g) {
  const out = [], m = g.selected ? g.member(g.selected) : null, t = thief(g);
  const enc = g.mode === 'encounter', idle = enc ? g.enc?.phase === 'party' && !g.busy : !g.busy;
  const who = m || (enc ? null : t);
  if (who?.def.skills && idle && !(enc && who.acted)) {
    if (canHide(g, who)) out.push({ id: 'hide', icon: '◐', label: 'Hide in Shadows', hint: `${who.def.skills.hideInShadows}%: unseen, and the next attack is a backstab`, ok: true, run: () => hide(g, who) });
    if (!enc) out.push({ id: 'traps', icon: '⚠', label: 'Find traps', hint: `${who.def.skills.findTraps}% for each trap within 10 ft, a turn`, ok: true, run: () => findTraps(g, who) });
  }
  if (!enc && idle) {
    const door = g.activeDoor();
    if (door && !door.open) out.push({ id: 'listen', icon: '◖', label: `Listen at the ${g.doorName(door)}`, hint: 'A turn: 1–2 in 6 for Fennick', ok: true, run: () => listen(g, door) });
  }
  return out;
}
