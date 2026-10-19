// Room 12, the great sacrifice chamber (PLAN.md 6.3): the boss set-piece. Odric stands at the
// green circle over Rosa Dobbit, bound for the goddess; his three skeletons guard the chamber, and
// a giant gecko is chained to the pole. When the party is seen, Odric orders the dead in and goes
// on with the rite: Rosa dies at the end of the third round unless someone is at his throat. When
// it looks hopeless (his skeletons gone, or half his blood spilt) he slips the gecko's chain and
// runs for his stairs in room 15. Chasing him, or cutting him off, is up to the party.
import { talk } from '../dialogue.js';
import { join } from '../recruits.js';

const RITE_ROUNDS = 3;
const foe = (g, kind) => g.foes.find((f) => f.kind === kind);

export const ODRIC = {
  odric: {
    level: 'dungeon',
    start(g, s, group) {
      if (s.started || !['odric', 'skeletons', 'gecko'].includes(group)) return;
      s.started = true;
      for (const grp of ['odric', 'skeletons', 'gecko']) g.startEncounter(grp);
      const o = foe(g, 'odric'), rosa = foe(g, 'rosa');
      if (!o?.alive || !rosa?.alive) return;
      s.timer = RITE_ROUNDS;
      g.say('Odric looks up from the bound halfling, knife in hand. "Visitors, at the goddess\'s hour! Kill them, my dead. She will have her blood either way."');
      g.say(`Rosa will be sacrificed in ${RITE_ROUNDS} rounds unless Odric is stopped!`);
    },
    round(g, s) {
      if (!s.started) return;
      const o = foe(g, 'odric'), rosa = foe(g, 'rosa');
      const busy = o?.alive && g.party.some((m) => !m.dead && !m.downed && g.inMelee(o.tile, m.tile));
      if (rosa?.alive && rosa.state === 'captive' && o?.alive && !o.fled && o.state === 'ritual') {
        if (busy) g.say('Odric has to fight for his life: the rite waits.');
        else if (--s.timer > 0) g.say(`Odric chants over Rosa, the knife raised: ${s.timer} round${s.timer === 1 ? '' : 's'} left to stop him!`);
        else {
          rosa.alive = false; rosa.dead = true; g.state.rosa = 'sacrificed';
          g.say('The chant ends. Odric\'s knife falls, and Rosa Dobbit is dead on the green circle. "It is done," he breathes.');
          o.state = 'fighting';
        }
      }
      // hopeless: his dead are gone, or half his blood is spilt
      const dead = !g.foes.some((f) => f.kind === 'skeleton' && f.alive && !f.fled);
      if (o?.alive && !o.fled && o.state !== 'looping' && (dead || o.hp <= o.maxHp / 2)) this.flee(g, o);
    },
    flee(g, o) {
      const d = g.dungeon, gecko = foe(g, 'gecko');
      if (gecko?.alive && gecko.state === 'chained') { gecko.state = 'fighting'; g.say('Odric slips the gecko\'s chain as he passes the pole. "Feed, my pet!"'); }
      const stairs = d.links.find((l) => l.id === 'stairs-15');
      const p = stairs && d.pathTo(o.tile, stairs.a, { closed: true, pits: false });
      if (!p) { o.state = 'fighting'; return; }
      o.state = 'looping'; o.loop = p.tiles; o.loopK = 0;
      o.loopEnd = () => {
        o.fled = true; o.state = 'escaped'; g.state.odric = 'escaped';
        g.say('Odric\'s footsteps pound away up the stairs from the changing room, and a door slams far above. He is gone, and his keys with him.');
      };
      g.say('"This is not finished!" Odric gathers up his robes and runs for the south-west door.');
    },
    killed(g, s, u) {
      if (u.kind === 'odric') { g.state.odric = 'killed'; g.say('Odric falls on his own circle. The ring of keys at his belt clinks on the stone.'); }
      if (u.kind === 'rosa') g.state.rosa = 'killed';
    },
    // Rosa can be cut loose by anyone beside her once the chamber is quiet
    actions(g) {
      const rosa = foe(g, 'rosa');
      if (!rosa?.alive || rosa.state !== 'captive' || g.mode !== 'explore' || g.busy || !g.party.some((m) => g.canAct(m) && g.inMelee(m.tile, rosa.tile))) return [];
      return [{ id: 'rosa', icon: '✂', label: 'Cut Rosa free', ok: true, run: () => this.free(g, rosa) }];
    },
    // the fight over and Rosa still bound and alive: she's free
    ended(g, s) {
      const rosa = foe(g, 'rosa'), o = foe(g, 'odric');
      if (!s.started || !rosa?.alive || rosa.state !== 'captive') return;
      if (o?.alive && !o.fled && g.dungeon.roomOf(o.tile)?.id === '12') return;
      this.free(g, rosa);
    },
    free(g, rosa) {
      g.state.rosa = 'rescued';
      const text = g.member('belisarius')
        ? 'You cut Rosa\'s bonds. She sees Belisarius and her eyes narrow, then fill. "You came back for me?" "Well," he says, "they came. I helped."'
        : 'You cut the halfling\'s bonds. She rubs her wrists and looks up at you. "Rosa Dobbit, of the Dobbits of Kollchap. They were going to... You saved my life."';
      talk(g, { who: 'rosa', name: 'Rosa Dobbit', text, options: [
        { label: 'Ask her to come with you', run: () => talk(g, { who: 'rosa', name: 'Rosa Dobbit', text: '"Try and stop me. Give me a blade and point me at a priest."', options: [{ label: 'Welcome her', run: () => { join(g, rosa, 'rosa'); g.say('Rosa joins the party: a halfling fighter with a short sword and a sling.'); } }] }) },
        { label: 'Tell her to make for the surface', run: () => { rosa.fled = true; rosa.state = 'gone'; g.say('Rosa nods and slips away toward the exit. "I\'ll see you in the village. Drinks are on me."'); } },
      ] });
    },
  },
};
