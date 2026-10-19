// The people of Kollchap who talk before (or instead of) fighting (PLAN.md 6.3, 8.3): Belisarius
// in 5a, the Arch-deaconess in 9 and her rockmen in 9a, the underpriests of 10 once they
// surrender, the lizardman in 23, and the two statues, 17's alms dish and 21's oracle. All of it
// is scripted, deterministic dialogue; the oracle's canned couplets are its offline voice until
// the AI one arrives (M7).
import { talk } from '../dialogue.js';
import { join } from '../recruits.js';
import { roll } from '../rules.js';
import { COINS } from '../defs.js';
import * as treasure from '../treasure.js';
import * as oracle from '../oracle.js';

const foe = (g, kind) => g.foes.find((f) => f.kind === kind);
const near = (g, i, r = 1.5) => g.party.some((m) => !m.dead && g.distTo(m.tile, i) <= r);
// A line comes up: whoever is walking stops to hear it.
const stop = (g) => { if (g.units.some((u) => u.route)) g.haltParty(g.leader, g.eyeOf(g.leader)); };

// Pay gold's worth out of the purse, gold first, then the rest. False if there isn't enough.
export function pay(g, gp) {
  if (treasure.worth(g) - g.treasure.reduce((n, t) => n + t.gp, 0) < gp) return false;
  let left = gp;
  for (const k of ['pp', 'gp', 'ep', 'sp', 'cp']) {
    const take = Math.min(g.purse[k], Math.ceil(left / COINS[k] - 1e-9));
    g.purse[k] -= take; left -= take * COINS[k];
    if (left <= 1e-9) break;
  }
  // change, in silver
  if (left < 0) g.purse.sp += Math.round(-left / COINS.sp);
  return true;
}
const coins = (g) => Object.values(g.purse).some((n) => n > 0);

export const NPCS = {
  // ---------- 5a: Belisarius, starving and frightened (PLAN.md 4) ----------
  belisarius: {
    level: 'dungeon',
    actions(g, s) {
      const b = foe(g, 'belisarius');
      if (!b || g.busy || g.mode !== 'explore' || !near(g, b.tile)) return [];
      return [{ id: 'talk', icon: '❝', label: 'Talk to the stranger', ok: true, run: () => this.open(g, s, b) }];
    },
    open(g, s, b) {
      const info = [
        '"Orcs in the guardroom by the way in. They watch the corridor through a door in the wall: you\'d never see it. Make noise out there and they come out behind you."',
        '"The high priest, Odric, keeps the keys on his belt: cells, treasure room, all of it. He\'s in the great chamber with the green circle. Don\'t go in there."',
        '"There were four of us. Hamar went south, into the caves, looking for another way out. He never came back. And Rosa, our halfling... they took her. For the circle."',
      ];
      const options = () => [
        ...(!s.fed ? [{ label: g.rations > 0 ? 'Give him some food' : 'Give him some food (you have none)', ok: g.rations > 0, run: () => { g.rations--; s.fed = true; talk(g, { who: 'belisarius', name: 'Belisarius', text: 'He wolfs the rations down. "Bless you. Belisarius, thief, at your service. I came for the shrine\'s silver, same as you, I\'d guess."', options: options() }); } }] : []),
        { label: 'Ask what he knows', run: () => { s.said = (s.said || 0) % info.length; talk(g, { who: 'belisarius', name: 'Belisarius', text: info[s.said++], options: options() }); } },
        { label: 'Ask him to come with you', run: () => {
          if (!s.fed) { talk(g, { who: 'belisarius', name: 'Belisarius', text: '"On an empty stomach? I couldn\'t walk ten feet."', options: options() }); return; }
          talk(g, { who: 'belisarius', name: 'Belisarius', text: '"Better than starving in a cupboard. But I don\'t go in front. Ever."', options: [{ label: 'Welcome him', run: () => this.recruit(g, b) }] });
        } },
        { label: 'Leave him', run: () => {} },
      ];
      talk(g, { who: 'belisarius', name: 'A thin man in a torn cloak', text: s.met ? '"You came back! Have you any food?"' : '"Food... please, have you any food? Three days I\'ve hidden in here."', options: options() });
      s.met = true;
    },
    recruit(g, b) {
      join(g, b, 'belisarius');
      g.say('Belisarius joins the party. He refuses the front rank, and his nerve may break if a friend goes down.');
      // he knows where the orcs' door is
      const door = g.dungeon.doors.get(g.dungeon.idx(40, 13));
      if (door && !door.found) { door.found = true; g.doorsChanged(); g.say('"Their door is there, look, by the end of the corridor." Belisarius shows you the orcs\' secret door into room 1.'); }
    },
    step(g, s) {
      if (s.hamar || !g.member('belisarius') || !g.caches.find((c) => c.room === '20')?.found) return;
      s.hamar = true;
      g.say('Belisarius kneels by the body in plate. "Hamar. You fool. You found the way, and it found you."');
    },
  },

  // ---------- 9: the Arch-deaconess of Tranfax (PLAN.md 6.3) ----------
  // She wants her stolen statue (it's the oracle in 21). Tell her where it is and guide her, lie,
  // buy her off, or fight her and her rockmen. She opens a fight with Hold Person.
  deaconess: {
    level: 'dungeon',
    step(g, s) {
      const f = foe(g, 'archdeaconess');
      if (!f?.alive) return;
      if (f.state === 'ally') { this.atStatue(g, f); return; }
      if (f.state !== 'parley' || s.met || !g.visible[f.tile] || g.mode !== 'explore') return;
      s.met = true;
      stop(g);
      this.open(g, s, f);
    },
    actions(g, s) {
      const f = foe(g, 'archdeaconess');
      if (!f?.alive || f.state !== 'parley' || !s.met || g.busy || g.mode !== 'explore' || !near(g, f.tile, 3)) return [];
      return [{ id: 'talk', icon: '❝', label: 'Talk to the Arch-deaconess', ok: true, run: () => this.open(g, s, f) }];
    },
    open(g, s, f) {
      g.state.deaconess ||= 'met';
      const seen = g.visited.has('21'), who = 'archdeaconess', name = 'The Arch-deaconess of Tranfax';
      const say = (text, options) => talk(g, { who, name, text, options });
      say(s.peace
        ? '"Well? Have you found it?"'
        : 'A woman in dark plate looks up from her papers, unhurried. "You are not Odric\'s. Good. I am the Arch-deaconess of Tranfax. Odric\'s people stole a statue from my temple: a seated figure, so high, that speaks. Where is it?"', [
        { label: 'Tell her where it is', hint: seen ? 'Room 21, behind the sliding block' : 'You haven\'t seen it', ok: seen, run: () => say('"Behind a stone that shuts? Then you will take me to it. Now."', [
          { label: 'Guide her there', run: () => this.guide(g, f) },
          { label: 'Refuse', run: () => this.fight(g, f, '"Then you are of no use to me."') },
        ]) },
        ...(!seen && !s.lied ? [{ label: 'Lie: say you know where it is', run: () => {
          s.lied = true;
          const r = roll(g.rng, '2d6');
          if (r >= 8) { s.peace = true; g.state.deaconess = 'peace'; say(`She studies your faces for a long moment (reaction 2d6: ${r}). "Then bring me word of it, and I will make it worth your while. Go."`, []); }
          else this.fight(g, f, `"You lie badly." (reaction 2d6: ${r}) She rises, reaching for her mace.`);
        } }] : []),
        { label: 'Offer 100 gp to be left in peace', hint: 'And her map of the dungeon', ok: treasure.worth(g) - g.treasure.reduce((n, t) => n + t.gp, 0) >= 100, run: () => {
          pay(g, 100); s.peace = true; g.state.deaconess = 'peace';
          const map = g.caches.find((c) => c.room === '9');
          if (map && !map.found) { map.found = true; for (let i = 0; i < g.dungeon.n; i++) if (g.dungeon.t[i] && !g.hiddenDoor(i)) g.explored[i] = 1; g.exploredVersion++; g.ui.viewKey = null; }
          say('"Gold is gold." She sweeps it into a drawer, and tosses a folded paper across the table: a map of the whole dungeon. "Now leave me to my work." The automap fills in.', []);
        } },
        { label: 'Attack her', run: () => this.fight(g, f, 'She is on her feet before your blades are out.') },
        { label: 'Back away', run: () => { if (!s.peace) say('"Then go. And do not come back empty-handed."', []); } },
      ]);
    },
    guide(g, f) {
      f.state = 'ally';
      g.followers.push(f);
      g.state.deaconess = 'guiding';
      g.say('The Arch-deaconess takes up her mace and falls in behind the party. "Lead on. My rockmen will wait."');
    },
    // at room 21, she takes her statue and is gone
    atStatue(g, f) {
      const d = g.dungeon, room = d.byId['21'];
      if (d.roomOf(f.tile) !== room && !(g.party.some((m) => d.roomOf(m.tile) === room) && g.distTo(f.tile, d.idx(30, 30)) <= 6)) return;
      f.fled = true; f.state = 'gone';
      g.followers.splice(g.followers.indexOf(f), 1);
      g.state.statueGone = true; g.state.deaconess = 'guided';
      g.say('The Arch-deaconess lays her hand on the statue\'s stone brow and speaks a word. Statue and priestess are gone, and the room is suddenly bigger. On the floor where she stood: a purse, and a scrap of parchment, "For services rendered."');
      g.say(`In the purse: ${treasure.gain(g, { gp: 50 })}.`);
      g.rebuild();
    },
    fight(g, f, text) {
      g.say(text);
      f.state = 'fighting';
      g.state.deaconess = 'fought';
      for (const r of g.foes.filter((x) => x.kind === 'rockman' && x.alive)) r.state = 'fighting';
      g.say('"To me!" she calls, and next door stone grinds on stone: her rockmen are coming.');
      g.startEncounter('deaconess', { partySurprised: false, foesSurprised: false });
      g.startEncounter('rockmen');
    },
    killed(g, s, u) { if (u.kind === 'archdeaconess') g.state.deaconess = 'killed'; },
  },
  // 9a: the rockmen sift the rubble, and come only when she calls; with her dead or fighting
  // they turn on anyone they see
  rockmen: {
    level: 'dungeon',
    step(g) {
      const dea = foe(g, 'archdeaconess');
      if (dea?.alive && dea.state !== 'fighting' && dea.state !== 'alert') return;
      for (const r of g.foes) if (r.kind === 'rockman' && r.alive && r.state === 'searching' && g.visible[r.tile]) r.state = 'resting';
    },
  },

  // ---------- 10: the underpriests (PLAN.md 6.3) ----------
  // Broken, they surrender, and can be questioned, bound or let go. Kithar hands over his silver
  // hemisphere if told to; let go, they take it with them. A priest who sees the pearls from 11 on
  // the party forgets he ever surrendered.
  priests: {
    level: 'dungeon',
    broke(g) {
      for (const f of g.foes.filter((x) => x.group === 'priests' && x.alive && !x.fled)) { f.state = 'surrendered'; f.route = null; }
      g.say('"Enough! Enough, we yield!" The underpriests throw down their maces and kneel.');
      return true;
    },
    actions(g, s) {
      // (the buttons show when one of them is near; what they do goes for all of them)
      const out = [], pr = g.foes.filter((f) => f.group === 'priests' && f.alive && !f.fled && (f.state === 'surrendered' || f.state === 'bound'));
      if (!pr.some((f) => near(g, f.tile, 3)) || g.busy || g.mode !== 'explore') return out;
      const k = pr.find((f) => f.kind === 'kithar') || pr[0], free = pr.filter((f) => f.state === 'surrendered');
      out.push({ id: 'question', icon: '❝', label: 'Question the priests', ok: true, run: () => this.question(g, s, k) });
      if (k.kind === 'kithar' && k.loot) out.push({ id: 'hemisphere', icon: '◓', label: 'Take the silver hemisphere', hint: '100 gp', ok: true, run: () => { g.say(`Kithar hands it over with bad grace: ${treasure.gain(g, k.loot)}.`); k.loot = null; } });
      if (free.length) out.push({ id: 'bind', icon: '⛓', label: 'Bind them', hint: 'A turn', ok: true, run: () => { g.advance(10); for (const f of free) f.state = 'bound'; g.say('The underpriests are bound hand and foot with their own cords.'); } });
      out.push({ id: 'release', icon: '⇢', label: 'Let them go', ok: true, run: () => {
        for (const f of pr) f.fled = true;
        g.say(`The underpriests scramble away into the dark${k.loot ? ', Kithar clutching his silver hemisphere' : ''}.`);
      } });
      return out;
    },
    question(g, s, k) {
      const lines = [
        '"Odric? High priest of our order. He is at the green circle tonight, with the goddess\'s offering. His dead stand round him. You will not get past them."',
        '"The keys hang on his belt, always: the cells, the treasure room, the chests. Nobody else has a set."',
        '"The sword? There is a cellar below the great chamber where the water comes in, down the wet stairs past the meditation room. Something lives there. We do not go."',
        '"The robes, in the changing room by his stair: wear them, and the brothers will not look twice until you are close." He bites his tongue, too late.',
      ];
      s.asked = (s.asked || 0) % lines.length;
      talk(g, { who: 'kithar', name: 'Kithar, underpriest', text: lines[s.asked++], options: [{ label: 'Go on', run: () => {} }] });
    },
    step(g, s) {
      if (!g.treasure.some((t) => t.name === 'pearl')) return;
      const seen = g.foes.filter((f) => f.group === 'priests' && f.alive && !f.fled && f.state === 'surrendered' && g.visible[f.tile]);
      if (!seen.length || g.mode !== 'explore') return;
      for (const f of seen) f.state = 'fighting';
      g.say('Kithar sees the pearls of absolution on you. "Thieves! Defilers!" The surrender is forgotten.');
      g.startEncounter('priests', { partySurprised: false, foesSurprised: false });
    },
  },

  // ---------- 23: the lizardman (PLAN.md 6.3) ----------
  // Neutral, with 1 hit point and no fear at all. Food buys him off, a charm or Sleep does too;
  // reaching for the sword without either starts a fight.
  lizardman: {
    level: 'dungeon',
    step(g, s) {
      const f = foe(g, 'lizardman'), sword = g.dungeon.idx(13, 32);
      if (!f?.alive || g.mode !== 'explore') return;
      const calm = s.bribed || f.status.charmed || f.status.asleep;
      if (f.state === 'guarding' && !calm && near(g, sword, 1.5)) {
        f.state = 'fighting';
        g.say('The lizardman uncoils from his rock with a hiss: "Mine!"');
        g.startEncounter('lizardman', { partySurprised: false, foesSurprised: false });
        return;
      }
      if (s.met || !g.visible[f.tile] || f.state !== 'guarding') return;
      s.met = true;
      stop(g);
      this.open(g, s, f);
    },
    actions(g, s) {
      const f = foe(g, 'lizardman');
      if (!f?.alive || !s.met || s.bribed || f.state !== 'guarding' || g.busy || g.mode !== 'explore' || !near(g, f.tile, 4)) return [];
      return [{ id: 'talk', icon: '❝', label: 'Talk to the lizardman', ok: true, run: () => this.open(g, s, f) }];
    },
    open(g, s, f) {
      talk(g, { who: 'lizardman', name: 'The lizardman', text: 'In the shaft of sunlight a lizardman sits on a rock, a short sword across his knees, tasting the air. "Shiny is mine," he hisses. "Go away."', options: [
        { label: g.rations ? 'Offer him food' : 'Offer him food (you have none)', ok: g.rations > 0, run: () => {
          g.rations--; s.bribed = true;
          talk(g, { who: 'lizardman', name: 'The lizardman', text: 'He snatches the rations, sniffs them, and swallows them whole. Then he waves a claw at the rock behind him. "Take shiny. Go."', options: [] });
        } },
        { label: 'Attack him', run: () => { f.state = 'fighting'; g.startEncounter('lizardman', { partySurprised: false, foesSurprised: false }); } },
        { label: 'Back off', run: () => {} },
      ] });
    },
  },

  // ---------- 17: the oracle's alms dish (PLAN.md 6.3) ----------
  // A coin in the dish buys a cryptic hint, which signposts that statues here talk.
  offerings: {
    level: 'dungeon',
    actions(g, s) {
      const statue = g.dungeon.idx(38, 21);
      if (g.busy || g.mode !== 'explore' || !g.dungeon.byId['17'] || !near(g, statue, 1.6)) return [];
      return [{ id: 'offer', icon: '🪙', label: 'Drop a coin in the dish', hint: '"Offerings"', ok: coins(g), run: () => {
        const k = Object.keys(COINS).find((c) => g.purse[c] > 0);
        g.purse[k]--;
        const hints = [
          'Past the circle, green and wide, / the sword lies drowned where the sunbeams hide.',
          'A door of stone that shuts behind / hides another, hard to find.',
          'The goblins leap where the floor is thin; / mark where they jump, or you\'ll fall in.',
          'Iron keys on the green priest\'s belt / unlock the cells where the captives knelt.',
          'In the south, a statue speaks, / three times a day, to one who seeks.',
        ];
        s.n = (s.n || 0) % hints.length;
        talk(g, { who: null, name: 'The statue', text: `The coin rings in the dish. Deep in the stone, something stirs, and a slow voice says:\n"${hints[s.n++]}"`, options: [] });
      } }];
    },
  },

  // ---------- 21: the statue oracle (PLAN.md 6.3, 8.3) ----------
  // Three "How" questions a day, of twelve words or fewer, and one of the three answers is false.
  // The player types a question or picks one; the Worker answers it from the game's fact sheet
  // (oracle.js), or, offline, a canned couplet does. The statue's eyes glow while it thinks.
  oracle: {
    level: 'dungeon', PER_DAY: 3,
    SUGGESTIONS: ['How do we reach the sword?', 'How do we get out of this room?', 'How do we free the prisoners?', 'How do we beat Odric?', 'How do we pass the Arch-deaconess?'],
    step(g, s) {
      const statue = g.dungeon.idx(30, 30);
      if (s.greeted || g.state.statueGone || !g.visible[statue] || g.dungeon.roomOf(g.leader.tile)?.id !== '21') return;
      s.greeted = true;
      g.say('The statue\'s stone eyes open. "Three questions, each of them how, / I answer today. Ask, and ask now. / But mark me well, as you go your way: / one of my three is a lie, they say."');
    },
    // a new day, three new questions (and a new lie among them, drawn at the day's first question:
    // listing the actions must never touch the dice)
    today(g, s) {
      const day = Math.floor(g.clock / 1440);
      if (s.day !== day) { s.day = day; s.asked = 0; s.lie = undefined; }
      return this.PER_DAY - s.asked;
    },
    actions(g, s) {
      const statue = g.dungeon.idx(30, 30);
      if (g.state.statueGone || g.busy || g.mode !== 'explore' || !near(g, statue, 2)) return [];
      const left = this.today(g, s);
      return [{ id: 'oracle', icon: '❓', label: 'Ask the statue', hint: left ? `${left} question${left === 1 ? '' : 's'} left today` : 'No more today', ok: left > 0 && !g.oracleBusy, run: () => this.open(g, s) }];
    },
    open(g, s) {
      const asked = s.done || [];
      talk(g, { who: null, name: 'The statue', text: '"Ask."',
        input: { placeholder: 'How...? (12 words or fewer)', submit: (q) => this.ask(g, s, q) },
        options: [...this.SUGGESTIONS.filter((q) => !asked.includes(q)).slice(0, 4).map((q) => ({ label: q, run: () => this.ask(g, s, q) })), { label: 'Ask nothing', run: () => {} }] });
    },
    async ask(g, s, question) {
      const q = question.trim();
      if (!q || this.today(g, s) <= 0) return;
      if (s.lie === undefined) s.lie = Math.floor(g.rng() * this.PER_DAY);
      const n = s.asked++;
      (s.done ||= []).push(q);
      g.oracleBusy = true;
      talk(g, { who: null, name: 'The statue', text: `You ask: "${q}"\nThe statue's eyes kindle, and the stone begins to hum...`, wait: true });
      const { answer } = await oracle.ask(g, q, n !== s.lie);
      g.oracleBusy = false;
      g.say(`The statue answers: ${answer}`); // (unquoted: the dialogue below is what's voiced)
      talk(g, { who: null, name: 'The statue', text: `"${answer}"`, options: [{ label: this.today(g, s) > 0 ? 'Ask another' : 'Step back', run: () => { if (this.today(g, s) > 0) this.open(g, s); } }, { label: 'Enough', run: () => {} }] });
      oracle.voice(g, answer);
    },
  },
};
