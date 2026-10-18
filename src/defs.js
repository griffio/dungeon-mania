// Game definitions (PLAN.md 7.2). So far: light sources.
//
// reach: how far, in tiles, the light is bright enough to see by (PLAN.md 3.5: a torch lights
// 30 ft, 6 tiles). r: where its glow fades to nothing, a little further out. col, i: colour and
// intensity. flicker / pulse: how much the flame dances or the glow breathes.
export const LIGHT_KINDS = {
  torch: { reach: 6, r: 7, col: [1, 0.6, 0.28], i: 2.4, flicker: 1 },
  brazier: { reach: 6, r: 7.5, col: [0.55, 1, 0.45], i: 2.2, flicker: 1 },
  lamp: { reach: 4, r: 5, col: [1, 0.68, 0.36], i: 1.6, flicker: 0.4 },
  candles: { reach: 3, r: 4, col: [1, 0.72, 0.42], i: 1.1, flicker: 0.6 },
  sconce: { reach: 4, r: 5.5, col: [1, 0.62, 0.3], i: 1.8, flicker: 1 },
  pool: { reach: 1.5, r: 2.6, col: [0.3, 0.95, 0.65], i: 0.9, pulse: 1 },
  sun: { reach: 5, r: 6.5, col: [1, 0.94, 0.82], i: 2.4 },
  daylight: { reach: 3, r: 4.5, col: [0.72, 0.8, 0.95], i: 1.4 },
};
