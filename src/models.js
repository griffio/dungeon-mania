// Miniature rigs (PLAN.md 2, Option A): each figure is a handful of instanced primitives posed
// every frame, painted like a pewter miniature on a round base with a brass rim.
// Units are tiles: a 6 ft figure stands about 1.15 tall (a wall is 2, 10 ft).

const BRASS = [0.6, 0.38, 0.1], FELT = [0.035, 0.06, 0.035], STEEL = [0.38, 0.39, 0.42];
const WOOD = [0.16, 0.09, 0.04], FLAME = [1, 0.55, 0.2], LANTERN = [1, 0.75, 0.4];
const HIP = 0.5, SHOULDER = 0.88, LEG = 0.44, ARM = 0.36;

// A pose: where the figure stands and what it is doing.
//   x, z, y (floor height), yaw (0 faces +z), walk (stride phase, radians), moving (0..1),
//   breath (seed for the idle sway), light: 'torch' | 'lantern' | 'shut' | null,
//   lean: [x, z] world offset for the flame (the secret-door hint), selected, leader.
// Draws into sets {box, cyl, sph, cone}; returns the flame's world position, or null.
export function drawHero(sets, def, p, t) {
  const { box, cyl, sph, cone } = sets, L = def.look, G = def.gear;
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  // local (right, up, forward) -> world; local +z is the way the figure faces
  const W = (lx, ly, lz) => [p.x + lx * cy - lz * sy, p.y + ly, p.z + lx * sy + lz * cy];
  const add = (set, at, sx, sh, sz, col, mat = 0, emis = 0, pitch = 0, roll = 0, yawOff = 0) =>
    set.add(at[0], at[1], at[2], sx, sh, sz, p.yaw + yawOff, col, mat, emis, pitch, roll);
  // A limb hanging from a joint, swung forward (swing < 0 brings the far end forward) about the
  // figure's side axis. Returns the far end in local coordinates.
  const limb = (set, jx, jy, len, w, swing, col, mat = 0) => {
    const ux = 0, uy = Math.cos(swing), uz = Math.sin(swing);
    const end = [jx - ux * len, jy - uy * len, -uz * len];
    add(set, W(...end), w, len, w, col, mat, 0, 0, swing);
    return end;
  };

  // base: felt top on a brass rim; the rim glows when selected, the leader's is brighter
  add(cyl, W(0, 0, 0), 0.7, 0.05, 0.7, BRASS, 8, p.selected ? 0.9 : p.leader ? 0.12 : 0);
  add(cyl, W(0, 0.05, 0), 0.64, 0.012, 0.64, FELT);

  const mv = p.moving, sw = Math.sin(p.walk) * 0.55 * mv;
  const bob = Math.abs(Math.sin(p.walk)) * 0.035 * mv;
  const breath = Math.sin(t * 2.1 + p.breath) * 0.012 * (1 - mv);
  const metal = def.cls === 'Fighter' || def.cls === 'Cleric';
  const bodyMat = metal ? 8 : 0;
  const y0 = 0.062; // top of the base
  const hip = y0 + HIP - 0.06 + bob, sh = y0 + SHOULDER - 0.06 + bob + breath;

  // legs, or a robe that sways as she walks
  if (G.robe) {
    add(cone, W(0, y0, 0), 0.5, 1.02, 0.44, L.body, 0, 0, sw * 0.08, 0);
  } else {
    limb(box, -0.075, hip, LEG, 0.1, -sw, L.trim);
    limb(box, 0.075, hip, LEG, 0.1, sw, L.trim);
  }
  // body
  add(box, W(0, hip - 0.04, 0), 0.3, sh - hip + 0.04, 0.18, L.body, bodyMat);
  if (G.tabard) {
    add(box, W(0, hip - 0.12, 0.093), 0.2, sh - hip + 0.06, 0.012, L.trim);
    add(box, W(0, hip - 0.12, -0.093), 0.2, sh - hip + 0.06, 0.012, L.trim);
  }
  add(box, W(0, hip - 0.03, 0), 0.31, 0.05, 0.19, [0.12, 0.07, 0.03]); // belt
  // head
  const hy = sh + 0.02;
  add(sph, W(0, hy, 0), 0.24, 0.26, 0.24, L.skin);
  if (G.helm) {
    add(sph, W(0, hy + 0.07, 0), 0.27, 0.22, 0.27, STEEL, 8);
    add(box, W(0, hy + 0.24, -0.02), 0.03, 0.08, 0.22, L.trim); // crest
  } else if (G.hat) {
    add(cyl, W(0, hy + 0.17, 0), 0.4, 0.02, 0.4, L.body);
    add(cone, W(0, hy + 0.18, 0), 0.22, 0.34, 0.22, L.body, 0, 0, 0, -0.2); // tipped back
  } else if (G.hood) {
    add(sph, W(0, hy + 0.02, -0.02), 0.28, 0.28, 0.28, L.trim);
  } else {
    add(sph, W(0, hy + 0.12, -0.01), 0.25, 0.16, 0.25, L.hair);
  }

  // arms: the right one holds the light or the weapon, the left the shield
  const carries = p.light === 'torch' || p.light === 'lantern' || p.light === 'shut';
  let flame = null;
  const rSwing = carries ? -1.15 : sw * 0.8;
  const rEnd = limb(box, 0.19, sh, ARM, 0.085, rSwing, metal ? STEEL : L.body, bodyMat);
  const hand = [rEnd[0], rEnd[1], rEnd[2]];
  if (carries) {
    const lean = p.lean || [0, 0];
    if (p.light === 'torch') {
      add(cyl, W(hand[0], hand[1] - 0.04, hand[2]), 0.045, 0.34, 0.045, WOOD);
      const fl = 1 + 0.12 * Math.sin(t * 17 + p.breath) + 0.08 * Math.sin(t * 29 + p.breath * 2);
      const tip = W(hand[0], hand[1] + 0.3, hand[2]);
      flame = [tip[0] + lean[0] * 0.25, tip[1] + 0.06, tip[2] + lean[1] * 0.25];
      // the flame leans toward an undiscovered secret door (PLAN.md 3.6)
      const tilt = Math.hypot(lean[0], lean[1]);
      sph.add(flame[0] - lean[0] * 0.1, tip[1] - 0.02, flame[2] - lean[1] * 0.1, 0.12 * fl, (0.2 + tilt * 0.12) * fl, 0.12 * fl, 0, FLAME, 4, 3,
        -lean[0] * 1.2, lean[1] * 1.2);
    } else {
      add(cyl, W(hand[0], hand[1] - 0.16, hand[2]), 0.14, 0.16, 0.14, [0.08, 0.07, 0.05], 8);
      const lit = p.light === 'lantern';
      const at = W(hand[0], hand[1] - 0.13, hand[2]);
      sph.add(at[0], at[1], at[2], 0.1, 0.1, 0.1, 0, lit ? LANTERN : [0.05, 0.04, 0.03], lit ? 4 : 0, lit ? 2.2 : 0);
      if (lit) flame = [at[0], at[1] + 0.06, at[2]];
    }
  } else if (G.sword || G.mace || G.dagger) {
    // held up and a little forward from the hand
    const len = G.sword ? 0.5 : G.mace ? 0.34 : 0.2, r = 0.6 - sw * 0.3;
    add(box, W(hand[0], hand[1] - 0.02, hand[2]), G.mace ? 0.04 : 0.035, len, G.mace ? 0.04 : 0.012, G.mace ? WOOD : STEEL, G.mace ? 0 : 8, 0, 0, r);
    if (G.mace) add(sph, W(hand[0], hand[1] - 0.02 + Math.cos(r) * len - 0.05, hand[2] + Math.sin(r) * len - 0.05), 0.11, 0.11, 0.11, STEEL, 8);
    if (G.sword) add(box, W(hand[0], hand[1] + 0.02, hand[2] + 0.01), 0.04, 0.025, 0.16, STEEL, 8, 0, 0, r); // crossguard
  }
  limb(box, -0.19, sh, ARM, 0.085, -sw * 0.8, metal ? STEEL : L.body, bodyMat);
  // a torch takes a hand: a fighter carrying one gives up his shield (PLAN.md 3.5)
  if (G.shield && !(carries && def.cls === 'Fighter')) {
    if (def.cls === 'Cleric') {
      // round, its face turned outward: a disc stood on edge along the figure's side
      add(cyl, W(-0.235, sh - 0.27, 0.02), 0.3, 0.045, 0.3, L.trim, 0, 0, Math.PI / 2, 0);
    } else {
      add(box, W(-0.255, sh - 0.44, 0.02), 0.04, 0.36, 0.28, L.trim);
    }
    add(sph, W(-0.29, sh - 0.3, 0.02), 0.06, 0.06, 0.06, BRASS, 8);
  }
  return flame;
}
