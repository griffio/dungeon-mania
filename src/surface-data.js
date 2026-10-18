// The surface: the ruined temple of Kollchap at sunset (PLAN.md 6.3, the tutorial). The book:
// "The middle of the temple is bare and at the far end there is an irregular hole in the stone
// floor... about four feet in diameter." Two hobgoblins keep watch by it. The party arrives from
// the east, along the track from the village.
// Same layout as dungeon-data.js: one character per 5 ft tile, x east, y south.
//   Y trees      , grass      w ruined wall (waist high)   I column   . flagstones
//   r rubble     v the hole down to the tunnel

export const DAYLIGHT = true; // no fog of war: the evening sun lights everything in view

// The low sun in the west: direction toward it, its colour, and the sky and ground light.
export const SUN = { dir: [-0.86, 0.3, -0.18], col: [1.2, 0.66, 0.36], sky: [0.17, 0.15, 0.2], ground: [0.07, 0.05, 0.04] };

export const MAP = String.raw`
YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY
YYY,,Y,,,,,,,,,,,,,,,,,,,,,YYY
YY,wwwww,wwwwwwwwwww,wwww,,,,Y
Y,,w.................r..w,,,,Y
Y,,w...I...I...I...I....w,,,,Y
Y,,w.....................,,,,Y
Y,,w.v...................,,,,Y
Y,,w.....................,,,,Y
Y,,,...I...I...rr..I....w,,,,Y
Y,,w.....r............r.w,,,,Y
Y,,wwww,wwwwwww,wwwwwwwww,,,,Y
Y,,,,,,,,,,,,,,,,,,,,,,,,,,,YY
YY,,,,,,,,,,,,,,,,,,,,,,,,,YYY
YYYYYYYYYYYYYYYYYYYYYYYYYYYYYY
`;

export const ROOMS = [
  { id: 'temple', name: 'Temple ruins', at: [12, 6], box: [4, 3, 24, 9], passage: true },
  { id: 'outside', name: 'The track from the village', at: [26, 6], box: [1, 1, 28, 12], passage: true },
];
export const DOORS = [];
// The hole: climbing down it is the way into the dungeon.
export const LINKS = [{ id: 'hole', from: [5, 6], to: 'dungeon', kind: 'climb', note: 'A steep tunnel, 40 ft down' }];
export const START = [26, 6];
export const PARTY_START = [[24, 6], [25, 6], [26, 6], [27, 6]];

export const PROPS = [
  { kind: 'campfire', at: [8.5, 6.5], w: 0.8, d: 0.8, h: 0.2 },
  { kind: 'bedroll', at: [9.6, 4.8], w: 1.1, d: 0.5, h: 0.1, rot: 20 },
  { kind: 'bedroll', at: [9.8, 8.1], w: 1.1, d: 0.5, h: 0.1, rot: -15 },
  { kind: 'drum', at: [16.2, 8.6], w: 0.7, d: 0.7, h: 0.6, rot: 70 },
  { kind: 'drum', at: [13.4, 5.6], w: 0.7, d: 0.7, h: 0.5, rot: 10 },
];

export const LIGHTS = [{ kind: 'campfire', at: [8.5, 6.5], h: 0.45 }];
export const SHAFTS = [];

// The hobgoblins watch the hole. They attack only if someone climbs into it, or if they are
// attacked (PLAN.md 6.3).
export const FOES = [
  { kind: 'hobgoblin', at: [7, 5], hp: 2, group: 'hobgoblins', state: 'watching' },
  { kind: 'hobgoblin', at: [7, 7], hp: 6, group: 'hobgoblins', state: 'watching' },
];
