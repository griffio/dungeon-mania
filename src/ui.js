import { TILE } from './dungeon.js';
import { clockText, minutesFor } from './rules.js';
import { TORCH_MINUTES, OIL_MINUTES } from './defs.js';
import { Automap } from './automap.js';

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
  }

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
    this.labels.textContent = '';
    this.labelEls = game.dungeon.rooms.filter((r) => !r.passage || r.id === 'entrance').map((r) => {
      const e = el('div', 'label' + (r.passage ? ' minor' : ''), r.passage ? r.name : `<b>${r.id}</b><span>${r.name}</span>`);
      this.labels.appendChild(e);
      // centre of the room's tiles
      let sx = 0, sz = 0;
      for (const i of r.tiles) { const [x, y] = game.dungeon.xy(i); sx += x + 0.5; sz += y + 0.5; }
      return { el: e, room: r, x: sx / r.tiles.length, z: sz / r.tiles.length };
    });
    // party cards
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
    $('#clock').innerHTML = `<div class="turn">Turn ${turn} <span>${time}</span></div><div class="where">${room ? (room.passage ? room.name : `${room.id} · ${room.name}`) : 'A passage'}</div>`;

    // party cards: name, class, hit points, light and what's left of it, spare torches
    for (const m of g.party) {
      const c = this.cardEls.get(m.id), pos = g.order.indexOf(m.id) + 1;
      let light = '<span class="dark">no light</span>', burn = 0;
      if (m.light === 'torch') { light = `torch · ${Math.ceil(m.torchLeft)} min`; burn = m.torchLeft / TORCH_MINUTES; }
      else if (m.light === 'lantern') { light = m.shut ? 'lantern, hooded' : `lantern · ${Math.ceil(m.oil / 10)} turns`; burn = m.oil / OIL_MINUTES; }
      const spare = m.torches + (m.stub ? 1 : 0);
      c.className = `card c-${m.id}${g.selected === m.id ? ' sel' : ''}${m.light === 'torch' || (m.light === 'lantern' && !m.shut) ? ' lit' : ''}`;
      c.innerHTML = `<div class="nm"><span>${m.def.name}</span><i>${pos}</i></div><div class="rl">${m.def.cls}</div>`
        + `<div class="hp"><b style="width:100%"></b></div><div class="hpt">HP ${m.def.hp}/${m.def.hp} · AC ${m.def.ac}</div>`
        + `<div class="lt">${light}</div><div class="burn"><b style="width:${Math.round(burn * 100)}%"></b></div>`
        + `<div class="kit">${spare} torch${spare === 1 ? '' : 'es'}${m.def.kit.lantern ? ` · ${m.flasks} oil` : ''}${m.broken ? ' · <em>weapon cracked</em>' : ''}</div>`;
    }

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
    if (!lines.length) lines.push(`<span class="hint">${g.selected ? `${g.member(g.selected).def.name} is selected and moves alone. Tap the card again to rejoin the party.` : 'Tap a tile to see the way there, and again to go. Tap a hero to move them alone.'}</span>`);
    const log = g.log.slice(-4).map((e) => `<div>${e.text}</div>`).join('');
    this.info.innerHTML = lines.join('') + `<div class="log">${log}</div>`;
  }

  frame(g, w, h) {
    this.automap.draw(g);
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
