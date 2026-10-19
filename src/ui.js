import { TILE } from './dungeon.js';
import { clockText, minutesFor } from './rules.js';
import { TORCH_MINUTES, OIL_MINUTES, SPELLS, MONSTERS } from './defs.js';
import { Automap } from './automap.js';
import * as treasure from './treasure.js';
import { hum } from './ending.js';

const portrait = (id) => `assets/portraits/${id}.webp`;
// The bestiary card's portrait for each kind, and a line on what to watch for.
const BEAST = {
  hobgoblin: ['hobgoblin', 'Sees in the dark, 60 ft.'], orc: ['orc', 'Sees in the dark. Watches the corridor from its guardroom.'],
  rat: ['rat', 'Goes for the weakest. Its bite can carry disease.'], slime: ['slime', 'Eats through anything in six rounds. Only fire hurts it.'],
  goblin: ['goblin', 'Small, cowardly, and knows the back ways.'], ghoul: ['ghoul', 'Undead. Claw, claw, bite: each can paralyse. Cure Light Wounds frees the paralysed.'],
  archdeaconess: ['archdeaconess', 'A cleric of Chaos. Opens with Hold Person.'], rockman: ['rockman', 'Two stone fists: if both land, save or be turned to stone.'],
  kithar: ['kithar', 'Heals his brothers. Might surrender.'], underpriest: ['underpriest', 'Heavy armour under the robes. Might surrender.'],
  bugbear: ['bugbear', 'Huge, strong, and hits hard.'], odric: ['odric', 'High priest. His rite must not finish.'],
  skeleton: ['skeleton', 'Undead: never breaks, never sleeps. Turn Undead drives it off.'], gecko: ['gecko', 'Chained to the pole: it reaches only inside the circle, for now.'],
  zombie: ['zombie', 'Undead and slow: it always acts last.'], centipede: ['centipede', 'Its bite sickens: half speed, no fighting, until a camp.'],
  locust: ['locust', 'Grey as the rock. Spits: save, or lose a round retching.'], lizardman: ['lizardman', 'Neutral. Guards the sword. Food might do it.'],
};

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

// The exploration HUD (PLAN.md 7.6): clock, party cards, marching order, actions, the adventure
// log, the automap, and room labels pinned to the map.
export class UI {
  constructor() {
    this.info = $('#info');
    this.labels = $('#labels');
    this.labelEls = [];
    this.swapFrom = null;
    this.floatEls = new Map();
    $('#atk-go').onclick = () => this.game?.confirmAttack();
    $('#atk-x').onclick = () => { if (this.game) { this.game.attackPlan = null; this.update(this.game); } };
    $('#restart').onclick = () => location.reload();
    this.seen = new Set();
  }

  // A bestiary card for the first kind of monster in this fight not met before.
  bestiary(g) {
    const kinds = g.swarm ? ['bat'] : g.activeFoes().map((f) => f.kind);
    const kind = kinds.find((k) => !this.seen.has(k));
    if (!kind) return;
    this.seen.add(kind);
    const def = MONSTERS[kind], [pic, note] = kind === 'bat' ? ['bat', 'A shrieking swarm: -2 to hit, no casting. Wave a torch at it.'] : BEAST[kind] || [kind, ''];
    const b = $('#bestiary');
    b.innerHTML = `<img src="${portrait(pic)}" alt=""><div class="nm">${kind === 'bat' ? 'Bats' : def.name}</div>`
      + (def ? `<div class="st">AC ${def.alwaysHit ? '—' : def.ac} · HD ${Math.floor(def.hd) || '½'}${def.hd % 1 > 0.05 && def.hd > 1 ? '+1' : ''} · MV ${def.mv * 15}' · ML ${def.ml}${def.undead ? ' · undead' : ''}</div>` : '')
      + `<div class="nt">${note}</div>`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    b.onclick = () => b.classList.remove('show');
    clearTimeout(this.beastTimer);
    this.beastTimer = setTimeout(() => b.classList.remove('show'), 7000);
  }

  // The end: the DM's tally (PLAN.md 5).
  ending(g, t) {
    $('#end .res').innerHTML = `<h2>${t.title}</h2><p>${t.text}</p><table>${t.rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`
      + `<div class="xp">${t.xp.toLocaleString('en-GB')} XP${t.survivors ? `: ${t.share.toLocaleString('en-GB')} each for ${t.survivors} survivor${t.survivors === 1 ? '' : 's'}` : ''}</div>`;
    $('#end').classList.add('show');
  }

  // A banner across the top for a moment: an encounter starting.
  banner(text) {
    const b = $('#banner');
    b.textContent = text;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }
  // The last attack's roll, shown in the attack panel for a moment.
  lastRoll(r) { this.rolled = { ...r, at: performance.now() }; this.update(this.game); }

  attach(game) {
    this.game = game;
    for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => game.toggle(b.dataset.view);
    $('#rotl').onclick = () => game.camera.turn(-1);
    $('#rotr').onclick = () => game.camera.turn(1);
    $('#north').onclick = () => game.camera.faceNorth();
    $('#frame').onclick = () => game.frameAll();
    $('#party').onclick = () => game.focusParty();
    $('#viewbtn').onclick = () => $('#toggles').classList.toggle('show');
    this.automap = new Automap($('#automap'), (x, z) => { game.camera.goal = [x, z]; });
    this.levelChanged(game);
    this.partyChanged(game);
  }
  // party cards, one per member (more when the recruits join)
  partyChanged(game) {
    const cards = $('#cards');
    cards.textContent = '';
    this.cardEls = new Map();
    for (const m of game.party) {
      const c = el('button', `card c-${m.id}`);
      c.onclick = () => game.select(m.id);
      cards.appendChild(c);
      this.cardEls.set(m.id, c);
    }
    this.update(game);
  }

  // Room labels for the level the party is on.
  levelChanged(game) {
    this.labels.textContent = '';
    this.labelEls = game.dungeon.rooms.filter((r) => !r.passage || r.id === 'entrance' || r.id === 'temple').map((r) => {
      const e = el('div', 'label' + (r.passage ? ' minor' : ''), r.passage ? r.name : `<b>${r.id}</b><span>${r.name}</span>`);
      this.labels.appendChild(e);
      // centre of the room's tiles
      let sx = 0, sz = 0;
      for (const i of r.tiles) { const [x, y] = game.dungeon.xy(i); sx += x + 0.5; sz += y + 0.5; }
      return { el: e, room: r, x: sx / r.tiles.length, z: sz / r.tiles.length };
    });
    this.viewKey = null;
    if (this.automap) this.automap.key = '';
  }

  // Statuses as small chips on a card: what's on them, and for how long.
  chips(m) {
    const s = m.status, out = [];
    if (m.petrified) out.push(['stone', 'stone']);
    if (s.slimed) out.push(['slime', `slime · ${s.slimed} round${s.slimed === 1 ? '' : 's'}`]);
    if (s.paralysed) out.push(['bad', `paralysed · ${s.paralysed >= 10 ? `${Math.ceil(s.paralysed / 10)} turns` : `${Math.ceil(s.paralysed * 6)} rd`}`]);
    if (s.held) out.push(['bad', `held · ${Math.ceil(s.held * 6)} rd`]);
    if (s.poisoned) out.push(['slime', `poison · ${Math.ceil(s.poisoned / 10)} turns`]);
    if (s.stricken) out.push(['bad', 'stricken: carried']);
    if (s.sick) out.push(['bad', 'sick']);
    if (s.retching) out.push(['bad', 'retching']);
    if (s.bolted) out.push(['hid', 'bolted']);
    if (s.hidden) out.push(['hid', 'hidden']);
    if (s.shield) out.push(['mag', `shield · ${Math.ceil(s.shield * 6)} rd`]);
    if (s.protection) out.push(['gold', `protection · ${Math.ceil(s.protection * 6)} rd`]);
    if (s.lightSpell) out.push(['mag', `light · ${Math.ceil(s.lightSpell / 10)} turns`]);
    return out.length ? `<div class="chips">${out.map(([c, t]) => `<b class="${c}">${t}</b>`).join('')}</div>` : '';
  }

  describe(g, i) {
    const d = g.dungeon, [x, y] = d.xy(i), t = TILE[d.t[i]], room = d.roomOf(i), door = d.doors.get(i);
    const at = `<span class="xy">${x}, ${y}</span>`;
    if (!g.known(i)) return `${at} Unexplored`;
    if (g.hiddenDoor(i)) return `${at} Rock`;
    let s = `${at} ${door ? g.doorName(door).replace(/^./, (c) => c.toUpperCase()) + (door.open ? ', open' : door.key && door.key !== 'lever' ? ', locked' : '') : t.name}`;
    if (room) s += ` · <b>${room.passage ? room.name : `${room.id} ${room.name}`}</b>`;
    const who = g.memberAt(i);
    if (who) s += ` · ${who.def.name}`;
    return s;
  }

  update(g) {
    if (!this.game) return;
    for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('on', !!g.view[b.dataset.view]);
    this.labels.classList.toggle('hide', !g.view.labels);

    // clock and where the party is
    const { turn, time } = clockText(g.clock), room = g.dungeon.roomOf(g.leader.tile);
    const aim = g.state.sword ? 'Get out alive with the sword' : 'Find the Sword of the Sorcerer';
    const gp = Math.floor(treasure.worth(g)), cn = treasure.weight(g), h = hum(g);
    $('#clock').innerHTML = `<div class="turn">Turn ${turn} <span>${time}</span></div><div class="where">${room ? (room.passage ? room.name : `${room.id} · ${room.name}`) : 'A passage'}</div>`
      + `<div class="goal">${aim}</div><div class="purse">${gp.toLocaleString('en-GB')} gp · ${g.rations} ration${g.rations === 1 ? '' : 's'}${g.keys.has('odric') ? ' · keys' : ''}${g.escort ? ` · ${g.escort.count} prisoners` : ''}${treasure.burdened(g) ? ` · <em>burdened, ${cn.toLocaleString('en-GB')} cn</em>` : ''}</div>`
      + (h ? `<div class="hum">The sword hums${h.dist < 2 ? ' loudly' : ''}</div>` : '');

    // party cards: name, class, hit points, light and what's left of it, spare torches
    for (const m of g.party) {
      const c = this.cardEls.get(m.id), pos = g.order.indexOf(m.id) + 1;
      let light = '<span class="dark">no light</span>', burn = 0;
      if (m.light === 'torch') { light = `torch · ${Math.ceil(m.torchLeft)} min`; burn = m.torchLeft / TORCH_MINUTES; }
      else if (m.light === 'lantern') { light = m.shut ? 'lantern, hooded' : `lantern · ${Math.ceil(m.oil / 10)} turns`; burn = m.oil / OIL_MINUTES; }
      const spare = m.torches + (m.stub ? 1 : 0);
      const enc = g.mode === 'encounter', done = enc && m.acted;
      c.className = `card c-${m.id}${g.selected === m.id ? ' sel' : ''}${m.dead ? ' dead' : m.downed ? ' downed' : ''}${done ? ' done' : ''}`;
      const state = m.dead ? '<em>dead</em>' : m.downed ? `<em>downed · ${m.downed} round${m.downed === 1 ? '' : 's'}</em>`
        : enc ? `${m.moved ? '<s>move</s>' : 'move'} · ${m.acted ? '<s>act</s>' : 'act'}` : m.def.cls;
      c.innerHTML = `<img class="pt" src="${portrait(m.id)}" alt=""><div class="nm"><span>${m.def.name}</span><i>${pos}</i></div><div class="rl">${state}</div>`
        + `<div class="hp"><b style="width:${Math.round(100 * Math.max(0, m.hp) / m.def.hp)}%"></b></div><div class="hpt">HP ${m.hp}/${m.maxHp}${m.diseased ? ' (diseased)' : ''} · AC ${m.def.ac} · ${m.def.missile.name} ${m.ammo}</div>`
        + `<div class="lt">${light}</div><div class="burn"><b style="width:${Math.round(burn * 100)}%"></b></div>`
        + `<div class="kit">${spare} torch${spare === 1 ? '' : 'es'}${m.def.kit.lantern ? ` · ${m.flasks} oil` : ''}${m.items.potion ? ` · ${m.items.potion} potion${m.items.potion === 1 ? '' : 's'}` : ''}`
        + `${m.items.poolWater ? ` · ${m.items.poolWater} pool water` : ''}${m.empty ? ` · ${m.empty} empty flask${m.empty === 1 ? '' : 's'}` : ''}${m.broken ? ' · <em>weapon cracked</em>' : ''}</div>`
        + (m.def.spells ? `<div class="kit">${m.memorised.length ? m.memorised.map((id) => `${SPELLS[id].icon} ${SPELLS[id].name}`).join(' · ') : '<em>no spells left</em>'}</div>` : '')
        + this.chips(m);
    }

    // someone talking
    const dl = $('#dialogue');
    if (g.dialogue) {
      const dg = g.dialogue, img = dl.querySelector('img');
      img.className = dg.who ? '' : 'none';
      if (dg.who) img.src = portrait(dg.who);
      dl.querySelector('.nm').textContent = dg.name;
      dl.querySelector('.tx').textContent = dg.text;
      const opts = dl.querySelector('.opts');
      opts.textContent = '';
      dg.options.forEach((o, k) => {
        const b = el('button', o.ok === false ? 'dis' : '', `<i>${k + 1}</i>${o.label}${o.hint ? `<span>${o.hint}</span>` : ''}`);
        b.onclick = () => g.choose(k);
        opts.appendChild(b);
      });
      dl.classList.add('show');
    } else dl.classList.remove('show');

    // the spell waiting for a target
    const cp = $('#castprompt');
    if (g.casting) { cp.innerHTML = `${g.casting.caster.def.name}: ${SPELLS[g.casting.spell].name}. Choose ${SPELLS[g.casting.spell].target === 'foe' ? 'a foe' : SPELLS[g.casting.spell].target === 'area' ? 'where' : 'a companion'} <span>Esc to cancel</span>`; cp.classList.add('show'); }
    else cp.classList.remove('show');

    // the marching order, 2 x 2: tap one, then another, to swap them
    const ord = $('#order');
    ord.innerHTML = '<div class="ttl">Marching order</div>';
    const grid = el('div', 'grid');
    g.order.forEach((id, k) => {
      const m = g.member(id), b = el('button', `slot c-${id}${this.swapFrom === id ? ' pick' : ''}`, `<i>${k + 1}</i>${m.def.name}`);
      b.onclick = () => {
        if (!this.swapFrom) this.swapFrom = id;
        else { g.swapOrder(this.swapFrom, id); this.swapFrom = null; }
        this.update(g);
      };
      grid.appendChild(b);
    });
    ord.appendChild(grid);

    // the encounter: whose phase it is, the foes in sight, and the attack panel
    const rb = $('#roundbar');
    if (g.mode === 'encounter' && g.enc) {
      const e = g.enc, foes = g.activeFoes().filter((f) => g.foeShown(f));
      const phase = e.phase === 'party' ? 'Your move' : e.phase === 'foes' ? 'The foes act' : '…';
      rb.innerHTML = `<div class="rd">Round ${e.round} <span>${phase}</span></div>`
        + (e.init ? `<div class="init">Initiative: party ${e.init.party}, foes ${e.init.foes}</div>` : '')
        + `<div class="foes">${foes.map((f) => `<span>${f.def.name}<i style="width:${Math.round(100 * f.hp / f.maxHp)}%"></i></span>`).join('')}</div>`;
      rb.classList.add('show');
    } else rb.classList.remove('show');
    const ap = $('#attack'), plan = g.attackPlan, rolled = this.rolled && performance.now() - this.rolled.at < 4000 ? this.rolled : null;
    if (plan && g.mode === 'encounter') {
      const lines = plan.ok ? [`Needs ${19 - plan.ac} to hit AC ${plan.ac}`, ...plan.mods.map((m) => `${m.label} ${m.value > 0 ? '+' : ''}${m.value}`)] : [];
      $('#atk-t').innerHTML = `${plan.a.def.name} → ${plan.t.def.name} <span>${plan.ok ? `${plan.weapon.name}, ${plan.weapon.dmg}` : ''}</span>`;
      $('#atk-l').innerHTML = plan.ok ? lines.map((l) => `<div>${l}</div>`).join('') + `<div class="need">Roll ${plan.need}+ on d20 · ${Math.round(plan.chance * 100)}%</div>` : `<div class="no">${plan.why}</div>`;
      $('#atk-go').disabled = !plan.ok || plan.a.acted;
      ap.classList.add('show');
    } else if (rolled) {
      $('#atk-t').innerHTML = `${rolled.a.def.name} → ${rolled.t.def.name}`;
      $('#atk-l').innerHTML = `<div class="res ${rolled.roll.hit ? 'hit' : 'miss'}">d20 ${rolled.roll.roll} against ${rolled.need}: ${rolled.roll.hit ? `hit for ${rolled.dmg}` : 'miss'}</div>`;
      $('#atk-go').disabled = true;
      ap.classList.add('show');
    } else ap.classList.remove('show');

    // actions
    const bar = $('#actions');
    bar.textContent = '';
    this.actionList = g.actions();
    this.actionList.forEach((a, k) => {
      const b = el('button', a.ok ? '' : 'dis', `<span class="ic">${a.icon}</span><span class="lb">${a.label}</span><span class="ct">${k + 1}</span>`);
      if (a.hint) b.title = a.hint;
      b.onclick = () => g.act(a.id);
      bar.appendChild(b);
    });

    // what's under the pointer, the walk there, and the log
    const lines = [];
    const goal = g.previewGoal, p = g.preview;
    if (goal >= 0) lines.push(this.describe(g, goal));
    if (p?.blocked) lines.push(`<div class="path none">${p.blocked}</div>`);
    else if (p) {
      const who = g.selected ? `${g.member(g.selected).def.name} alone` : 'The party';
      const steps = p.path.length - 1;
      let s = steps ? `${who}: ${steps} step${steps === 1 ? '' : 's'}, ${Math.max(1, Math.round(minutesFor(p.cost)))} min` : `${who} is already there`;
      if (p.door >= 0) s += `, then open the ${g.doorName(g.dungeon.doors.get(p.door))}`;
      lines.push(`<div class="path">${s}${g.target >= 0 ? ' · tap again to go' : ''}</div>`);
    } else if (goal >= 0 && g.known(goal) && TILE[g.dungeon.t[goal]].walk && !g.hiddenDoor(goal) && !g.busy && !g.memberAt(goal)) {
      lines.push('<div class="path none">No known way there</div>');
    }
    const blk = g.scriptState.block;
    if (blk?.left > 0) lines.push(`<div class="path none">The stone block shuts in ${blk.left} round${blk.left === 1 ? '' : 's'}</div>`);
    if (!lines.length && g.mode === 'encounter') lines.push(`<span class="hint">${g.enc?.phase === 'party' ? 'Tap a blue tile to move, a foe to attack. Space ends the round.' : 'The foes are acting…'}</span>`);
    // the surface is the tutorial (PLAN.md 6.3): say what the choices are
    if (!lines.length && g.L.id === 'surface' && g.mode === 'explore') {
      const watching = g.foes.some((f) => f.alive && f.state === 'watching');
      lines.push(`<span class="hint">${watching
        ? 'Tap a tile to walk there (tap again to go). Tap a hobgoblin to attack, or walk to the hole and climb down while they watch: they will attack.'
        : 'The way is clear. Walk to the hole at the far end, and climb down. Brannoc can fix his rope first, so nobody falls.'}</span>`);
    }
    if (!lines.length) lines.push(`<span class="hint">${g.selected ? `${g.member(g.selected).def.name} is selected and moves alone. Tap the card again to rejoin the party.` : 'Tap a tile to see the way there, and again to go. Tap a hero to move them alone.'}</span>`);
    const log = g.log.slice(-4).map((e) => `<div${e.narr ? ' class="narr"' : ''}>${e.text}</div>`).join('');
    this.info.innerHTML = lines.join('') + `<div class="log">${log}</div>`;
  }

  frame(g, w, h) {
    this.automap.draw(g);
    // floating numbers over the figures
    const live = new Set(g.floats);
    for (const [f, e] of this.floatEls) if (!live.has(f)) { e.remove(); this.floatEls.delete(f); }
    for (const f of g.floats) {
      let e = this.floatEls.get(f);
      if (!e) { e = el('div', `float ${f.cls}`, f.text); $('#floats').appendChild(e); this.floatEls.set(f, e); }
      const p = g.camera.project(f.x, f.y + f.t * 0.5, f.z, w, h);
      e.style.opacity = String(Math.min(1, 2.2 - f.t * 1.4));
      e.style.transform = p ? `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px) translate(-50%, -50%)` : 'translate(-999px,-999px)';
    }
    if (this.rolled && performance.now() - this.rolled.at > 4000) { this.rolled = null; this.update(g); }
    if (!g.view.labels) return;
    const cam = g.camera, wallTop = g.scene.wallH;
    // labels only move when the view does
    const key = `${cam.tx} ${cam.tz} ${cam.dist} ${cam.yaw} ${w} ${h} ${wallTop}`;
    if (key === this.viewKey) return;
    this.viewKey = key;
    for (const l of this.labelEls) {
      // under fog, a room is named once any of it has been seen
      const known = !g.fogOn || l.room.tiles.some((i) => g.explored[i]);
      const p = known && cam.project(l.x, wallTop * 0.5, l.z, w, h);
      if (!p || p[0] < -80 || p[1] < -40 || p[0] > w + 80 || p[1] > h + 40) { l.el.style.transform = 'translate(-999px,-999px)'; continue; }
      l.el.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px) translate(-50%, -50%)`;
    }
    // names only when zoomed in far enough to read them
    this.labels.classList.toggle('far', cam.dist > 30);
  }
}
