import { TILE } from './dungeon.js';
import { Game } from './game.js';

const $ = (s) => document.querySelector(s);

// M0 HUD: what's under the cursor, the previewed path, view toggles and room labels.
export class UI {
  constructor() {
    this.info = $('#info');
    this.labels = $('#labels');
    this.labelEls = [];
  }

  attach(game) {
    this.game = game;
    for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => game.toggle(b.dataset.view);
    $('#rotl').onclick = () => game.camera.turn(-1);
    $('#rotr').onclick = () => game.camera.turn(1);
    $('#north').onclick = () => game.camera.faceNorth();
    $('#frame').onclick = () => game.frameAll();
    $('#party').onclick = () => game.focusToken();
    this.labels.textContent = '';
    this.labelEls = game.dungeon.rooms.filter((r) => !r.passage || r.id === 'entrance').map((r) => {
      const el = document.createElement('div');
      el.className = 'label' + (r.passage ? ' minor' : '');
      el.innerHTML = r.passage ? r.name : `<b>${r.id}</b><span>${r.name}</span>`;
      this.labels.appendChild(el);
      // centre of the room's tiles
      let sx = 0, sz = 0;
      for (const i of r.tiles) { const [x, y] = game.dungeon.xy(i); sx += x + 0.5; sz += y + 0.5; }
      return { el, room: r, x: sx / r.tiles.length, z: sz / r.tiles.length };
    });
    this.update(game);
  }

  describe(g, i) {
    const d = g.dungeon, [x, y] = d.xy(i), t = TILE[d.t[i]], room = d.roomOf(i), door = d.doors.get(i);
    if (!g.known(i)) return `<span class="xy">${x}, ${y}</span> Unexplored`;
    let s = `<span class="xy">${x}, ${y}</span> ${t.name}`;
    if (room) s += ` · <b>${room.passage ? room.name : `${room.id} ${room.name}`}</b>`;
    else if (door?.rooms.length) s += ` · ${door.rooms.map((id) => (/^\d/.test(id) ? id : d.byId[id].name)).join(' ↔ ')}`;
    if (door?.note) s += `<div class="note">${door.note}</div>`;
    return s;
  }

  update(g) {
    for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('on', !!g.view[b.dataset.view]);
    this.labels.classList.toggle('hide', !g.view.labels);
    const lines = [];
    const goal = g.previewGoal;
    if (goal >= 0) lines.push(this.describe(g, goal));
    if (g.preview) {
      const { tiles, cost } = g.preview;
      lines.push(`<div class="path">${tiles.length - 1} steps · ${(cost * 5).toFixed(0)} ft of movement · ${Game.minutes(cost).toFixed(0)} min exploring</div>`);
    } else if (goal >= 0 && TILE[g.dungeon.t[goal]].walk && !g.token.route) {
      const why = [g.fogOn && 'only explored ground', !g.view.secrets && 'secret doors hidden', !g.view.pits && 'pits avoided', !g.view.links && 'tunnel unused'].filter(Boolean);
      lines.push(`<div class="path none">No way there${why.length ? ` (${why.join(', ')})` : ''}</div>`);
    }
    if (!lines.length) lines.push('<span class="hint">Hover or tap a tile to see the path from the party. Tap it again to walk there.</span>');
    const room = g.dungeon.roomOf(g.token.tile);
    lines.push(`<div class="party">Party: ${room ? (room.passage ? room.name : `room ${room.id}, ${room.name}`) : 'passage'}</div>`);
    this.info.innerHTML = lines.join('');
  }

  frame(g, w, h) {
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
