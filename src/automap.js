import { TILE, T } from './dungeon.js';

// The automap (PLAN.md 7.6): parchment, drawn in the book's style as the party explores. Inked
// wall lines with hatched rock behind them, doors, an "S" once a secret door is found, room
// numbers once a room is visited, and the party as dots. Tap it to look somewhere.
const PX = 5; // css pixels per tile
const INK = '#3b2a17', HATCH = 'rgba(59, 42, 23, 0.45)', FLOOR = '#f3e7cb', PAPER = '#d8c59b';
const WATER = '#a9c1c4', PIT = '#5b4630', DOT = { brannoc: '#b23a2a', ysolde: '#2e4f9e', aldwin: '#e9e2cf', fennick: '#3e6a32' };

export class Automap {
  constructor(canvas, onPick) {
    this.c = canvas;
    this.key = '';
    canvas.addEventListener('pointerup', (e) => {
      const r = canvas.getBoundingClientRect();
      onPick((e.clientX - r.left) / r.width * this.w, (e.clientY - r.top) / r.height * this.h);
    });
  }

  draw(g) {
    const d = g.dungeon;
    const key = [g.L.id, g.unfoundTraps().length, g.exploredVersion, g.visited.size, g.wallsVersion, g.fogOn, g.selected, ...g.party.map((m) => g.eyeOf(m))].join();
    if (key === this.key) return;
    this.key = key;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = d.W; this.h = d.H;
    if (this.c.width !== d.W * PX * dpr) {
      this.c.width = d.W * PX * dpr; this.c.height = d.H * PX * dpr;
      this.c.style.width = `${d.W * PX}px`; this.c.style.height = `${d.H * PX}px`;
    }
    const c = this.c.getContext('2d');
    c.setTransform(dpr * PX, 0, 0, dpr * PX, 0, 0); // draw in tile units
    c.fillStyle = PAPER; c.fillRect(0, 0, d.W, d.H);
    const seen = (i) => g.known(i);
    const open = (x, y) => {
      if (!d.inside(x, y)) return false;
      const i = d.idx(x, y);
      return seen(i) && TILE[d.t[i]].walk && !g.hiddenDoor(i);
    };
    // floors
    for (let y = 0; y < d.H; y++) for (let x = 0; x < d.W; x++) {
      if (!open(x, y)) continue;
      const t = d.t[d.idx(x, y)];
      c.fillStyle = t === T.WATER ? WATER : FLOOR;
      c.fillRect(x, y, 1, 1);
      if (t === T.PIT && !g.hiddenTrapAt(d.idx(x, y))) { c.fillStyle = PIT; c.beginPath(); c.arc(x + 0.5, y + 0.5, 0.32, 0, Math.PI * 2); c.fill(); }
      if (t === T.STAIRS) { c.strokeStyle = INK; c.lineWidth = 0.08; for (const f of [0.25, 0.5, 0.75]) { c.beginPath(); c.moveTo(x + f, y + 0.1); c.lineTo(x + f, y + 0.9); c.stroke(); } }
    }
    // rock beside explored floor: inked edge and hatching, as the book draws it
    c.lineCap = 'round';
    for (let y = 0; y < d.H; y++) for (let x = 0; x < d.W; x++) {
      if (open(x, y)) continue;
      const i = d.idx(x, y);
      const sides = [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([dx, dy]) => open(x + dx, y + dy));
      const corner = [[1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => open(x + dx, y + dy));
      if (!sides.length && !corner) continue;
      if (TILE[d.t[i]].walk && !g.hiddenDoor(i) && !seen(i)) continue;
      c.strokeStyle = HATCH; c.lineWidth = 0.07;
      for (const f of [0.2, 0.5, 0.8]) { c.beginPath(); c.moveTo(x + f - 0.15, y + 0.85); c.lineTo(x + f + 0.15, y + 0.15); c.stroke(); }
      c.strokeStyle = INK; c.lineWidth = 0.16;
      for (const [dx, dy] of sides) {
        c.beginPath();
        if (dx) { const ex = x + (dx > 0 ? 1 : 0); c.moveTo(ex, y); c.lineTo(ex, y + 1); }
        else { const ey = y + (dy > 0 ? 1 : 0); c.moveTo(x, ey); c.lineTo(x + 1, ey); }
        c.stroke();
      }
    }
    // doors: a bar across the opening, open ones as a gap; "S" for found secret doors
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const door of d.doors.values()) {
      const [x, y] = d.xy(door.i);
      if (!door.found || !seen(door.i)) continue;
      const t = d.t[door.i];
      if (TILE[t].secret) {
        c.fillStyle = INK; c.font = 'bold 0.9px Georgia, serif'; c.fillText('S', x + 0.5, y + 0.55);
        continue;
      }
      if (door.open) continue;
      c.fillStyle = t === T.GATE ? '#555' : '#7a4a22';
      if (door.axis === 'x') c.fillRect(x + 0.1, y + 0.35, 0.8, 0.3);
      else c.fillRect(x + 0.35, y + 0.1, 0.3, 0.8);
    }
    // room numbers, once visited
    c.fillStyle = INK; c.font = 'bold 1.5px Georgia, serif';
    for (const r of d.rooms) {
      if (r.passage || !g.visited.has(r.id)) continue;
      let sx = 0, sy = 0;
      for (const i of r.tiles) { const [x, y] = d.xy(i); sx += x + 0.5; sy += y + 0.5; }
      c.fillText(r.id, sx / r.tiles.length, sy / r.tiles.length);
    }
    // the party
    for (const m of g.party) {
      const [x, y] = d.xy(g.eyeOf(m));
      c.fillStyle = DOT[m.id] || INK; c.strokeStyle = g.selected === m.id ? '#ffd27a' : INK; c.lineWidth = g.selected === m.id ? 0.3 : 0.15;
      c.beginPath(); c.arc(x + 0.5, y + 0.5, 0.42, 0, Math.PI * 2); c.fill(); c.stroke();
    }
  }
}
