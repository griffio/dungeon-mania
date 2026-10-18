// Room scripts (PLAN.md 6.3): what the denizens of a room do beyond plain fighting. Each script
// keeps its own state and is called by the game at a few points:
//   noise(g, s, x, z, r)  something loud happened at (x, z), heard r tiles away
//   step(g, s)            the party has moved (checked as they walk)
//   search(g, s)          the party searched
//   broke(g, s)           the group's morale broke; return true if the script handled it
//   actions(g, s)         extra buttons for the action bar
// level: the level the script's room is on (it only runs there).

import { T } from '../dungeon.js';
import { roll } from '../rules.js';

const dist = (x, z, cx, cz) => Math.hypot(x - cx, z - cz);

export const SCRIPTS = {
  // Room 1: the orcs. Noise along the entrance corridor puts them on the alert, and once alert
  // they sneak out of the secret door and fall on the party from behind as it passes by.
  // A quiet party finds them at ease on their bunks.
  orcs: {
    level: 'dungeon', room: [39.5, 10.5], door: [40, 13], heardAt: 2,
    noise(g, s, x, z, r) {
      if (s.done || dist(x, z, ...this.room) > r) return;
      s.heard = (s.heard || 0) + 1;
      if (s.heard >= this.heardAt && !s.alert) {
        s.alert = true;
        g.say('Behind the stonework to the north, something heavy shifts. Then silence.');
      }
    },
    step(g, s) {
      if (!s.alert || s.done || g.mode !== 'explore') return;
      const d = g.dungeon, room1 = d.byId['1'];
      // once the party is past the door, heading west down the corridor, out they come
      const inCorridor = g.party.some((m) => d.roomOf(m.tile)?.id === 'entrance' && d.xy(m.tile)[0] <= this.door[0]);
      const inRoom = g.party.some((m) => d.roomOf(m.tile) === room1);
      if (!inCorridor || inRoom) return;
      const orcs = g.foes.filter((f) => f.group === 'orcs' && f.alive);
      if (!orcs.length) return;
      s.done = true;
      const door = d.doors.get(d.idx(...this.door));
      door.found = true; door.open = true;
      g.doorsChanged();
      g.say('The wall behind you swings open: orcs!');
      g.startEncounter('orcs', { partySurprised: true });
    },
  },

  // Room 2: the giant rats, down in the rubbish. Searching the room disturbs them; when their
  // morale breaks they vanish back into the rubble, and come back if the searching goes on.
  rats: {
    level: 'dungeon',
    search(g) {
      const d = g.dungeon, room2 = d.byId['2'];
      if (!g.party.some((m) => d.roomOf(m.tile) === room2)) return;
      const rats = g.foes.filter((f) => f.group === 'rats' && f.alive && f.state === 'hidden');
      if (!rats.length) return;
      for (const r of rats) {
        // up out of the rubbish at its spot, or the nearest one nobody is standing on
        r.tile = g.freeTileNear(r.home, r);
        r.state = 'awake'; [r.x, r.z] = d.xy(r.tile).map((v) => v + 0.5);
      }
      g.say('The rubbish heaves. Giant rats boil out of it, squealing!');
      g.startEncounter('rats', {});
    },
    broke(g) {
      for (const r of g.foes.filter((f) => f.group === 'rats' && f.alive)) r.state = 'hidden';
      g.say('The rats scatter back into the rubbish and are gone.');
      return true;
    },
  },

  // Room 19: the goblins. Broken, they run out of the door the party didn't come in by, round
  // through 18 (leaping the pit) and back in by the first door, behind the party (PLAN.md 6.3).
  // If the party shut that door behind them, the goblins have to bang it open, which warns them.
  goblins: {
    level: 'dungeon',
    broke(g) {
      const d = g.dungeon, room = d.byId['19'];
      const doors = [...d.doors.values()].filter((x) => x.rooms.includes('19'));
      const [px, pz] = g.party.reduce(([x, z], m) => { const [mx, my] = d.xy(m.tile); return [x + mx, z + my]; }, [0, 0]).map((v) => v / g.party.length);
      doors.sort((a, b) => dist(...d.xy(a.i), px, pz) - dist(...d.xy(b.i), px, pz));
      const [near, far] = doors;
      const goblins = g.foes.filter((f) => f.group === 'goblins' && f.alive && !f.fled);
      if (!far) return false;
      // out by the far door, round the corridors through 18, and back to the near door
      const inRoom = new Uint8Array(d.n);
      for (const i of room.tiles) inRoom[i] = 1;
      const outside = (door) => { const [x, y] = d.xy(door.i); return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => d.idx(x + dx, y + dy)).find((i) => !inRoom[i] && d.t[i] !== T.ROCK); };
      // goblins leap the pits on their run as if they weren't there (that's how they show the
      // party where the one at 18 is)
      const leap = new Set([...Array(d.n).keys()].filter((i) => d.t[i] === T.PIT && d.roomOf(i)?.id === '18'));
      const around = d.pathTo(far.i, outside(near), { closed: true, pits: true, blocked: inRoom, floorPits: leap });
      if (!around) return false;
      for (const f of goblins) {
        const out = d.pathTo(f.tile, far.i, { closed: true, pits: true });
        if (!out) continue;
        f.loop = [...out.tiles, ...around.tiles.slice(1)];
        f.loopK = 0; f.state = 'looping';
      }
      g.say('The goblins break and bolt out of the far door, shrieking!');
      return true;
    },
  },

  // Room 5a: Belisarius, starving and frightened, once his panel is found (PLAN.md 6.3). He joins
  // as a recruit in M5; for now he begs, and tells what he knows.
  belisarius: {
    level: 'dungeon',
    actions(g, s) {
      const b = g.foes.find((f) => f.kind === 'belisarius' && f.alive);
      if (!b || g.busy || !g.party.some((m) => !m.dead && g.distTo(m.tile, b.tile) <= 1.5)) return [];
      return [{ id: 'talk', icon: '❝', label: 'Talk to the stranger', ok: true, run: () => {
        const lines = [
          '"Food... please, have you any food? Three days I\'ve hidden in here." He is a thin man in a torn cloak. "Belisarius. I came for the shrine\'s silver, same as you, I\'d guess."',
          '"Orcs in the guardroom by the way in. They watch through a door in the wall: you\'d never see it. Be quiet in that corridor, or they come out behind you."',
          '"The high priest, Odric, keeps the keys on his belt. Cells, treasure, all of it. He\'s in the great chamber, past the green circle. Don\'t go in there."',
        ];
        s.said = Math.min(lines.length - 1, s.said ?? 0);
        g.say(lines[s.said]);
        s.said++;
        g.ui.update(g);
      } }];
    },
  },

  // Room 6: the healing pool. Half a pint heals 1d6; it can be carried off in flasks, but the
  // water turns to poison in daylight (PLAN.md 6.3).
  pool: {
    level: 'dungeon',
    actions(g) {
      const d = g.dungeon, pool = d.byId['6'] && [...d.byId['6'].tiles, ...[...Array(d.n).keys()].filter((i) => d.t[i] === T.POOL)].find((i) => d.t[i] === T.POOL);
      if (pool === undefined || g.busy || g.mode !== 'explore' || !g.party.some((m) => !m.dead && g.distTo(m.tile, pool) <= 1.5)) return [];
      const out = [{ id: 'drink', icon: '💧', label: 'Drink from the pool', hint: 'A turn: 1d6 HP each', ok: true, run: () => {
        g.advance(10);
        for (const m of g.party) if (!m.dead && !m.downed) { const n = roll(g.rng, '1d6'), was = m.hp; m.hp = Math.min(m.maxHp, m.hp + n); if (m.hp > was) g.float(m, `+${m.hp - was}`, 'heal'); }
        g.say('The party drinks from the green-tinted pool. The water tingles, and wounds close.');
      } }];
      const filler = g.party.find((m) => m.empty > 0 && !m.dead);
      if (filler) out.push({ id: 'fill', icon: '⚱', label: 'Fill a flask', hint: `${filler.def.name} has ${filler.empty} empty`, ok: true, run: () => { filler.empty--; filler.items.poolWater++; g.say(`${filler.def.name} fills a flask with the pool's water.`); } });
      return out;
    },
  },
};
