// Spells, potions and rest (PLAN.md 3.7, 4). Each function takes the game.
import { SPELLS, ITEMS } from './defs.js';
import { roll, save, sleepTargets, turnUndead } from './rules.js';

const UNDEAD = { skeleton: 'skeleton', zombie: 'zombie', ghoul: 'ghoul' };

// ---------- statuses ----------
// Timed effects on a unit, in minutes of game time (a combat round is 1/6 of a minute):
// asleep, slimed (rounds), shield, protection, lightSpell, paralysed, held, poisoned (the death
// needle's clock), and the flags hidden, charmed, sick, retching and stricken.
const TIMED = ['asleep', 'shield', 'protection', 'lightSpell', 'paralysed', 'held', 'poisoned'];
export function tickStatus(g, minutes) {
  for (const u of g.units) {
    const s = u.status;
    if (u.dead) continue;
    for (const k of TIMED) {
      if (!s[k]) continue;
      s[k] = Math.max(0, s[k] - minutes);
      if (s[k] > 0) continue;
      delete s[k];
      if (k === 'asleep' && u.alive) g.say(`${g.theName(u)} wakes up.`);
      if (k === 'lightSpell') { g.say(`The magical light round ${u.def.name} fades.`); g.sightKey = ''; }
      if (k === 'paralysed' || k === 'held') g.say(`${g.theName(u)} can move again.`);
      // the death needle: uncured, the poison wins. On Normal the victim lives, but is helpless
      // for the rest of the mission and has to be carried (PLAN.md 6.3)
      if (k === 'poisoned') { s.stricken = true; g.say(`The poison has run its course: ${u.def.name} collapses, helpless, and must be carried from here on.`); }
    }
  }
  if (g.detectEvil && g.clock > g.detectEvil) { g.detectEvil = 0; g.say('The sense of evil fades.'); }
}

// ---------- casting ----------
// The spells a hero can cast now: memorised and not yet used. No casting in the bat swarm.
export function castable(g, m) {
  if (!m.def.spells || !g.canAct(m) || g.swarm) return [];
  return [...new Set(m.memorised)].filter((id) => id !== 'readMagic');
}

// Start casting: spells on yourself happen at once; the rest wait for a target tap. scroll: the
// item it's read from, instead of the memory.
export function beginCast(g, m, id, scroll = null) {
  const sp = SPELLS[id];
  if (sp.target === 'self') { resolve(g, m, id, m.tile, scroll); return; }
  g.casting = { caster: m, spell: id, scroll };
  g.attackPlan = null;
  g.say(`${m.def.name} begins to cast ${sp.name}: choose ${sp.target === 'foe' ? 'a foe' : sp.target === 'area' ? 'where' : 'a companion beside them'}.`);
  g.ui.update(g);
}

// Is tile i a fair target for the spell being cast? Returns a reason when it isn't.
export function targetProblem(g, i) {
  const { caster: m, spell } = g.casting, sp = SPELLS[spell], d = g.dungeon;
  const [mx, my] = d.xy(m.tile), [x, y] = d.xy(i), dist = Math.hypot(x - mx, y - my);
  if (sp.target === 'foe') {
    const f = g.foeAt(i);
    if (!f) return 'Choose a foe';
    if (spell === 'charm' && !f.def.person) return `The ${f.def.name.toLowerCase()} is no person to charm`;
    if (dist > sp.range) return 'Too far';
    if (!d.los(mx, my, x, y)) return 'Not in sight';
  } else if (sp.target === 'area') {
    if (dist > sp.range) return 'Too far';
    if (!g.known(i) || !d.los(mx, my, x, y)) return 'Not in sight';
  } else if (sp.target === 'ally') {
    const a = g.party.find((p) => p.tile === i && !p.dead);
    if (!a) return 'Choose a companion';
    if (a !== m && Math.max(Math.abs(x - mx), Math.abs(y - my)) > 1) return 'They must be beside the caster';
  }
  return null;
}

// Cast the spell: it's gone from memory (or the scroll crumbles) whatever happens.
export function resolve(g, m, id, i, scroll = g.casting?.scroll) {
  const sp = SPELLS[id], d = g.dungeon;
  g.casting = null;
  if (scroll) m.items[scroll]--;
  else m.memorised.splice(m.memorised.indexOf(id), 1);
  if (g.mode === 'encounter') m.acted = true; else g.advance(1);
  const [x, y] = d.xy(i);
  g.sparkle(x + 0.5, y + 0.5, id);
  const name = m.def.name;
  switch (id) {
    case 'sleep': {
      const near = g.foes.filter((f) => f.alive && !f.fled && f.state !== 'hidden' && !f.status.asleep && !UNDEAD[f.kind] && f.def.rig !== 'slime'
        && Math.max(Math.abs(d.xy(f.tile)[0] - x), Math.abs(d.xy(f.tile)[1] - y)) <= sp.radius);
      const r = sleepTargets(g.rng, near.map((f) => f.def.hd));
      for (const k of r.asleep) near[k].status.asleep = roll(g.rng, '4d4') * 10;
      g.say(`${name} casts Sleep (2d8: ${r.roll} hit dice). ${r.asleep.length ? `${r.asleep.length} ${r.asleep.length === 1 ? 'foe slumps' : 'foes slump'} to the floor, asleep.` : 'Nothing falls asleep.'}`);
      break;
    }
    case 'missile': {
      const f = g.foeAt(i), n = roll(g.rng, '1d6+1');
      g.say(`${name} casts Magic Missile: a bolt of force strikes the ${f.def.name.toLowerCase()} for ${n}.`);
      g.hurt(f, n, m);
      break;
    }
    case 'light': {
      const a = g.party.find((p) => p.tile === i);
      a.status.lightSpell = sp.minutes;
      g.say(`${name} casts Light: a cold glow springs up round ${a === m ? 'them' : a.def.name}.`);
      g.sightKey = '';
      break;
    }
    case 'shield': m.status.shield = sp.rounds / 6; g.say(`${name} casts Shield: the air hardens round them.`); break;
    case 'protection': m.status.protection = sp.rounds / 6; g.say(`${name} ${scroll ? 'reads a scroll of' : 'casts'} Protection from Evil.`); break;
    case 'charm': {
      const f = g.foeAt(i), s = save(g.rng, f.def.save, 'spells');
      if (s.ok) g.say(`${name} casts Charm Person, but the ${f.def.name.toLowerCase()} shrugs it off (${s.text}).`);
      else { f.status.charmed = true; f.state = 'charmed'; g.say(`${name} casts Charm Person. The ${f.def.name.toLowerCase()} lowers its weapon, a friend now (${s.text}).`); }
      break;
    }
    case 'cure': {
      const a = g.party.find((p) => p.tile === i), n = roll(g.rng, '1d6+1');
      heal(g, a, n, `${name} ${scroll ? 'reads a scroll of' : 'casts'} Cure Light Wounds on ${a === m ? 'themself' : a.def.name}`);
      break;
    }
    case 'detectEvil': g.detectEvil = g.clock + sp.minutes; g.say(`${name} casts Detect Evil: evil things within 120 ft glow red to their sight.`); break;
    case 'removeFear': g.say(`${name} casts Remove Fear. A calm settles over the party.`); break;
  }
  if (g.mode === 'encounter') g.afterAction(m); else g.ui.update(g);
}

// Healing: never above the maximum; a downed hero gets up.
export function heal(g, a, n, why) {
  const was = a.hp;
  a.hp = Math.min(a.maxHp, a.hp + n);
  if (a.downed) a.downed = 0;
  // the cure also frees the paralysed and halts the death needle's poison (B/X)
  if (a.status.paralysed) g.say(`${a.def.name} can move again.`);
  if (a.status.poisoned) g.say(`The poison in ${a.def.name}'s veins is driven out.`);
  delete a.status.paralysed; delete a.status.poisoned;
  g.float(a, `+${a.hp - was}`, 'heal');
  g.say(`${why}: ${a.def.name} is healed ${a.hp - was} (${a.hp}/${a.maxHp}).`);
}

// Turn Undead: Aldwin presents his holy symbol (PLAN.md 4). Turned undead flee for 2d6 rounds.
export function turn(g, m) {
  const undead = g.activeFoes().filter((f) => UNDEAD[f.kind] && g.foeShown(f));
  m.acted = true;
  const r = turnUndead(g.rng, 2, undead[0].kind);
  if (!r.ok) g.say(`${m.def.name} raises the holy symbol, but the ${undead[0].def.name.toLowerCase()}s come on (${r.text}).`);
  else {
    for (const f of undead.filter((x) => x.kind === undead[0].kind)) { f.state = 'fleeing'; f.status.turned = roll(g.rng, '2d6'); }
    g.say(`${m.def.name} raises the holy symbol: the ${undead[0].def.name.toLowerCase()}s turn and flee (${r.text})!`);
  }
  g.afterAction(m);
}

// ---------- potions ----------
// The hero with the item gives it to the one who needs it most: themselves or someone beside them.
export function useItem(g, m, id) {
  const near = g.party.filter((a) => !a.dead && (a === m || g.inMelee(m.tile, a.tile)));
  const who = near.sort((a, b) => (b.downed ? 99 : b.maxHp - b.hp) - (a.downed ? 99 : a.maxHp - a.hp))[0];
  m.items[id]--;
  if (id === 'poolWater' && m.tainted) {
    const n = roll(g.rng, '1d6');
    who.hp = Math.max(0, who.hp - n);
    g.say(`The pool water has turned in the daylight: it burns. ${who.def.name} takes ${n}.`);
  } else heal(g, who, roll(g.rng, ITEMS[id].heal), `${m.def.name} gives ${who === m ? 'themself' : who.def.name} a ${ITEMS[id].name.toLowerCase()}`);
  if (g.mode === 'encounter') { m.acted = true; g.afterAction(m); } else g.ui.update(g);
}

// ---------- rest (PLAN.md 3.7) ----------
// A breather: a turn's rest, 1 HP each, once for each cleared room. A full camp: 6 turns in a
// cleared room with its doors shut; spells come back, 1d3 HP each, and disease passes.
export function restOptions(g) {
  const d = g.dungeon, room = d.roomOf(g.leader.tile);
  if (g.mode !== 'explore' || g.L.id !== 'dungeon' || !room) return {};
  const clear = !g.foes.some((f) => f.alive && !f.fled && !f.status.charmed && f.state !== 'hidden' && g.visible[f.tile]);
  const doors = [...d.doors.values()].filter((x) => x.rooms.includes(room.id));
  const shut = !room.passage && doors.length > 0 && doors.every((x) => !x.open);
  return { breather: clear && !g.rested.has(room.id), camp: clear && shut, room };
}
export function breather(g) {
  const { room } = restOptions(g);
  g.rested.add(room.id);
  g.advance(10);
  for (const m of g.party) if (!m.dead && !m.downed) m.hp = Math.min(m.maxHp, m.hp + 1);
  g.say('The party catches its breath for a turn: 1 HP each.');
}
export function camp(g) {
  g.advance(60);
  for (const m of g.party) {
    if (m.dead) continue;
    if (m.diseased) { m.diseased = false; m.maxHp++; }
    delete m.status.sick;
    const n = roll(g.rng, '1d3');
    m.hp = Math.min(m.maxHp, m.hp + n);
    if (m.def.spells) m.memorised = [...m.def.spells.memorised];
  }
  g.say('The party makes camp behind shut doors for an hour. Wounds are bound, prayers said and spells studied: spells are back, and 1d3 HP each.');
}

// ---------- the action bar's share ----------
export function actions(g) {
  const out = [], m = g.selected && g.member(g.selected);
  const enc = g.mode === 'encounter', mine = enc ? g.enc?.phase === 'party' && !g.busy : !g.busy;
  if (m && mine && g.canAct(m) && !(enc && m.acted)) {
    for (const id of castable(g, m)) {
      const sp = SPELLS[id], n = m.memorised.filter((x) => x === id).length;
      out.push({ id: `cast:${id}`, icon: sp.icon, label: `Cast ${sp.name}`, hint: sp.hint + (n > 1 ? ` (${n} memorised)` : ''), ok: true, run: () => beginCast(g, m, id) });
    }
    if (m.def.turnUndead && enc && g.activeFoes().some((f) => UNDEAD[f.kind] && g.foeShown(f))) {
      out.push({ id: 'turn', icon: '✝', label: 'Turn Undead', hint: 'The holy symbol: undead flee', ok: true, run: () => turn(g, m) });
    }
    for (const id of Object.keys(ITEMS)) {
      if (!(m.items[id] > 0)) continue;
      const it = ITEMS[id];
      // scrolls: the cleric reads them as the spell
      if (it.spell) { if (m.def.cls === 'Cleric') out.push({ id: `read:${id}`, icon: it.icon, label: `Read ${SPELLS[it.spell].name} (${m.items[id]})`, hint: `From the scroll: ${SPELLS[it.spell].hint}`, ok: true, run: () => beginCast(g, m, it.spell, id) }); continue; }
      out.push({ id: `use:${id}`, icon: it.icon, label: `${it.name} (${m.items[id]})`, hint: 'For whoever beside them needs it most', ok: true, run: () => useItem(g, m, id) });
    }
  }
  const r = restOptions(g);
  if (r.breather && !g.busy) out.push({ id: 'breather', icon: '☕', label: 'Catch breath', hint: 'A turn: 1 HP each, once per room', ok: true, run: () => breather(g) });
  if (r.camp && !g.busy) out.push({ id: 'camp', icon: '⛺', label: 'Make camp', hint: 'An hour behind shut doors: spells back, 1d3 HP', ok: true, run: () => camp(g) });
  return out;
}
