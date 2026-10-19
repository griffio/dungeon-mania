// Recruits and followers (PLAN.md 4, 6.3). Belisarius and Rosa join the party as characters of
// their own; the prisoners freed from room 13 follow it out, as a huddle that can't fight; the
// Arch-deaconess, if the party agrees to guide her, walks with it to her statue.
import { RECRUITS } from './defs.js';

// A villager, for drawing the prisoners.
export const VILLAGER = {
  name: 'Prisoners', rig: 'biped', scale: 0.92, gear: {},
  look: { skin: [0.55, 0.4, 0.3], body: [0.3, 0.26, 0.2], trim: [0.24, 0.2, 0.15], hair: [0.18, 0.12, 0.08] },
};

// A denizen joins the party: it leaves the foes and becomes a member where it stands.
export function join(g, foe, id) {
  g.foes.splice(g.foes.indexOf(foe), 1);
  const m = g.makeMember(RECRUITS[id], foe.tile);
  m.hp = Math.min(m.maxHp, Math.max(1, foe.hp));
  g.party.push(m);
  g.order.push(id);
  g.ui.partyChanged?.(g);
  g.sightKey = '';
  return m;
}

// The marching order's front rank (the first two places): Belisarius won't stand there.
export function refusesPlace(g, id, k) {
  return g.member(id)?.def.timid && k < 2;
}

// Followers walk behind the last of the party, in the line.
export function followers(g) { return g.followers.filter((u) => !u.dead && !u.fled); }

// Freeing a cell (room 13): its prisoners join the huddle that follows the party out.
export function freeCell(g, cell) {
  if (cell.freed) return;
  cell.freed = true;
  if (!g.escort) {
    const [x, y] = g.dungeon.xy(cell.i);
    g.escort = {
      id: 'prisoners', def: VILLAGER, side: 'escort', tile: cell.i, x: x + 0.5, z: y + 0.5, yaw: 0, count: 0, merchant: false,
      route: null, k: 0, wait: 0, walk: 0, moving: 0, flash: 0, off: [0, 0], status: {}, hp: 1, maxHp: 1, dead: false, fled: false,
    };
    g.followers.push(g.escort);
  }
  g.escort.count += cell.count;
  if (cell.merchant) g.escort.merchant = true;
  g.say(cell.merchant
    ? `The gate swings open. ${cell.count} prisoners stumble out, blinking; a plump man in torn finery grabs ${g.leader.def.name}'s hand: "Ambrose Tull, merchant, of Kollchap village! Get me out of here and there's fifty gold in it for you!"`
    : `The gate swings open, and ${cell.count} more prisoners stumble out, thin and filthy, but alive.`);
  g.say(`${g.escort.count} freed prisoner${g.escort.count === 1 ? '' : 's'} will follow the party. They can't fight, and they panic in a battle.`);
}

// ---------- the script: Belisarius's nerve, and the recruits' lines ----------
export const SCRIPT = {
  // someone goes down in a fight: Belisarius may bolt (50%), and sits the fight out
  downed(g, s, u) {
    const b = g.member('belisarius');
    if (!b || b === u || !g.canAct(b) || g.mode !== 'encounter') return;
    if (g.rng() < 0.5) return;
    b.status.bolted = true;
    g.say(`${u.def.name} is down, and Belisarius has had enough: he bolts for the shadows!`);
  },
  ended(g) {
    const b = g.member('belisarius');
    if (b?.status.bolted) { delete b.status.bolted; g.say('Belisarius creeps back out of the dark, shamefaced. "I was... guarding the rear."'); }
  },
  // the reunion: Rosa and Belisarius were in the same party once
  step(g, s) {
    if (s.reunion || !g.member('rosa') || !g.member('belisarius')) return;
    s.reunion = true;
    g.say('"Belisarius? You old coward, you\'re alive!" Rosa throws her arms round him. "They said you ran." "I did," he says. "I\'m good at it."');
  },
};
