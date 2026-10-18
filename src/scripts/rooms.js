// Room scripts (PLAN.md 6.3): what the denizens of a room do beyond plain fighting. Each script
// keeps its own state and is called by the game at a few points:
//   noise(g, s, x, z, r)  something loud happened at (x, z), heard r tiles away
//   step(g, s)            the party has moved (checked as they walk)
//   search(g, s)          the party searched
//   broke(g, s)           the group's morale broke; return true if the script handled it
// level: the level the script's room is on (it only runs there).

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
};
