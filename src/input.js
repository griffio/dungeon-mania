import { clamp, angleDiff } from './util.js';

export const MIN_DIST = 7, MAX_DIST = 100;

// Touch-first camera + tap handling (pointer events cover iPad touch, Pencil and mouse).
// A mouse also hovers, which previews the path; a tap or click picks the tile.
export class Input {
  constructor(canvas, getGame) {
    this.c = canvas;
    this.getGame = getGame;
    this.ptrs = new Map();
    this.pinch = null;
    this.drag = false;
    const opts = { passive: false };
    canvas.addEventListener('pointerdown', (e) => this.down(e), opts);
    canvas.addEventListener('pointermove', (e) => this.move(e), opts);
    canvas.addEventListener('pointerup', (e) => this.up(e), opts);
    canvas.addEventListener('pointercancel', (e) => { this.ptrs.delete(e.pointerId); this.pinch = null; }, opts);
    canvas.addEventListener('pointerleave', () => { if (!this.ptrs.size) this.getGame()?.hover(-1); });
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.getGame()?.cancel(); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const g = this.getGame(); if (!g) return;
      g.camera.dist = clamp(g.camera.dist * Math.exp(e.deltaY * 0.0015), MIN_DIST, MAX_DIST);
      g.camera.distGoal = null;
    }, opts);
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), opts);
    document.addEventListener('touchmove', (e) => { if (e.target === canvas) e.preventDefault(); }, opts);
    window.addEventListener('keydown', (e) => this.key(e));
  }

  down(e) {
    e.preventDefault();
    if (e.button === 2) return;
    this.c.setPointerCapture?.(e.pointerId);
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      const g = this.getGame();
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: g?.camera.dist ?? 30, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
        ang: Math.atan2(b.y - a.y, b.x - a.x), twist: 0, rotating: false };
      this.drag = true;
    } else if (this.ptrs.size === 1) this.drag = false;
  }

  worldPerPx() {
    const cam = this.getGame().camera;
    return (2 * cam.dist * Math.tan(cam.fov / 2)) / this.c.clientHeight;
  }

  move(e) {
    const g = this.getGame();
    if (!g) return;
    const p = this.ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && !this.ptrs.size) g.hover(this.tileAt(e.clientX, e.clientY));
      return;
    }
    e.preventDefault();
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const cam = g.camera;
    if (this.ptrs.size === 2 && this.pinch) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.dist = clamp(this.pinch.dist * (this.pinch.d / Math.max(20, d)), MIN_DIST, MAX_DIST);
      cam.distGoal = null;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      cam.pan(cx - this.pinch.cx, cy - this.pinch.cy, this.worldPerPx());
      this.pinch.cx = cx; this.pinch.cy = cy;
      // two-finger twist rotates the view (after a small dead zone so pinches don't wobble it)
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const da = angleDiff(ang, this.pinch.ang);
      this.pinch.ang = ang;
      this.pinch.twist += da;
      if (this.pinch.rotating || Math.abs(this.pinch.twist) > 0.15) {
        this.pinch.rotating = true;
        cam.yaw += da; cam.yawGoal = null;
      }
      return;
    }
    if (!this.drag && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 12) this.drag = true;
    if (this.drag) cam.pan(dx, dy, this.worldPerPx());
  }

  up(e) {
    const p = this.ptrs.get(e.pointerId);
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = null;
    if (!p) return;
    const wasTap = !this.drag && performance.now() - p.t < 600 && this.ptrs.size === 0;
    if (this.ptrs.size === 0) this.drag = false;
    if (wasTap) this.getGame()?.tap(this.tileAt(e.clientX, e.clientY));
  }

  // The tile under a screen point: march the view ray until it drops below the height of the
  // tile it is over (wall tops for rock, the floor otherwise). -1 if it leaves the map.
  tileAt(px, py) {
    const g = this.getGame();
    const r = this.c.getBoundingClientRect();
    const { o, d } = g.camera.ray(px - r.left, py - r.top, r.width, r.height);
    const dg = g.dungeon, wallH = g.scene.wallH;
    if (d[1] >= 0) return -1;
    // walls in the cutaway are lower than wallH, so the start point is still above everything
    // start where the ray comes down to the wall tops: nothing above them can be hit
    for (let t = Math.max(0, (o[1] - wallH - 0.05) / -d[1]); t < 250; t += 0.08) {
      const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
      if (y < -2.5) break;
      const tx = Math.floor(x), tz = Math.floor(z);
      if (!dg.inside(tx, tz)) { if (y < 0) break; continue; }
      const i = dg.idx(tx, tz);
      if (y <= g.surfaceH(i) + 0.02) return i;
    }
    return -1;
  }

  key(e) {
    const g = this.getGame();
    if (!g || e.metaKey || e.ctrlKey) return;
    const cam = g.camera;
    // number keys fire the action bar's buttons
    if (/^[1-9]$/.test(e.key)) { const a = g.ui.actionList?.[Number(e.key) - 1]; if (a) g.act(a.id); return; }
    if (e.key === 'Escape' && g.casting) { g.casting = null; g.ui.update(g); return; }
    if (g.mode === 'encounter') {
      if (e.key === ' ') { e.preventDefault(); g.endPhase(); return; }
      if (e.key === 'Enter') { g.confirmAttack(); return; }
      if (e.key === 'Escape') { g.attackPlan = null; g.cancel(); return; }
    }
    switch (e.key.toLowerCase()) {
      case 'escape': if (g.selected) g.select(g.selected); else g.cancel(); break;
      case 'tab': {
        // none -> each hero in marching order -> none
        e.preventDefault();
        const ids = [null, ...g.order], k = ids.indexOf(g.selected);
        const next = ids[(k + 1) % ids.length];
        if (next) g.select(next); else if (g.selected) g.select(g.selected);
        break;
      }
      case 'arrowleft': case 'a': cam.pan(80, 0, this.worldPerPx()); break;
      case 'arrowright': case 'd': cam.pan(-80, 0, this.worldPerPx()); break;
      case 'arrowup': case 'w': cam.pan(0, 80, this.worldPerPx()); break;
      case 'arrowdown': case 's': cam.pan(0, -80, this.worldPerPx()); break;
      case 'q': cam.turn(-1); break;
      case 'e': cam.turn(1); break;
      case 'n': cam.faceNorth(); break;
      case 'h': g.toggle('lowWalls'); break;
      case 'r': g.toggle('tintRooms'); break;
      case 'l': g.toggle('labels'); break;
      case 'x': g.toggle('secrets'); break;
      case 'f': g.frameAll(); break;
      case 'm': g.toggle('mapLight'); break;
    }
  }
}
