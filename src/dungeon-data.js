// The Dungeons of Kollchap, curated from the book's map (docs/reference/kollchap-map.jpg).
// tools/trace-map.py makes the draft; this file is the hand-finished version (PLAN.md 7.3).
// One character is one 5 ft tile; x runs east, y runs south. Tile (x, y) covers the scan's
// pixels from origin + (x, y) * pitch, so `trace-map.py --overlay` can draw it over the scan.

export const TRACE = { pitch: 54, origin: [50, 12] };

// Glyphs:
//   #  rock                        .  floor
//   +  door (oak)                  S  secret door
//   L  lever-operated secret door  B  one-way sliding block door
//   G  barred gate (cells)         =  bars: block movement, not sight
//   P  pit                         h  covered pit (hatch) to a tunnel
//   ~  water, waist deep           O  deep pool
//   _  stairs                      r  rubble
//   c  cave floor                  <  tunnel up to the surface
export const MAP = String.raw`
####################################################
####################################################
#........L..#################..#####################
#.########...######...#######S######################
#.########.....###....#######..#####################
#.########.....#####+#.O.####...####################
#.#...=..#......+...........+....###################
#.#==G=G=#......###########.#.....##################
#.#.=....#......##.....rrr#.########################
#.#.G....#......##.....#rr#.........+.....##########
#.#####..#......##....h####.####+####.....##########
#.#..##..######+##.....#..S.###....##.....##########
#.+..##..###..#..###+###.##.###....##.....##########
#.#..##..##....+.........##.############S###########
#.#####..+......+........##.+.P+..................<#
#..#####+........#######.####PP#####.###########..##
##.#####..........######.###########.###############
##.####............####....#########.###############
##.#####...........####....#########.###############
##.######.........##.......######..#.#....##########
##.#######.......+.#.......######..+.#....##########
##..######+.....#..##############..#.#....##########
###.###..#.+...#..####....##....####.#....##########
###.##....+.#.#..+..##....+..P.......+....##########
###.S.#....###..#...##....#####.####################
###.#..#...###.#....##....+........####ccccc########
###.##....####.###################.....cccccc#######
###.###__####...........##########.####cccccc#######
###.#########__######+#...##.....#.####cccccc#######
##########~~~~~~####...##..S.....B.######cc#########
##########~~~~~~####.....###.....###################
##########~~~~~~####.....###.....###################
##########~~~~~~############.....###################
####################################################
`;

// Rooms and named passages. A room's tiles are a flood fill from `at` that stays inside `box`
// [x0, y0, x1, y1] and stops at doors; bars, gates, pits and water don't stop it, so the cells
// belong to 13 and the pit to 3. Tiles in no entry are unnamed passage.
// light: the fixed light source, if any (PLAN.md 3.5). sound: ambient loop. script: room script.
export const ROOMS = [
  { id: 'entrance', name: 'Entrance corridor', at: [44, 14], box: [32, 14, 50, 15], light: 'daylight', sound: 'wind', passage: true },
  { id: 'rear', name: 'Rear corridor', at: [1, 8], box: [1, 2, 8, 28], passage: true },
  { id: 'north', name: 'North corridor', at: [19, 6], box: [17, 6, 26, 6], passage: true },
  { id: 'wide', name: 'Wide corridor', at: [20, 13], box: [15, 12, 24, 16], passage: true },
  { id: '1', name: 'Orc guardroom', at: [39, 10], box: [37, 9, 41, 12], script: 'orc-ambush' },
  { id: '2', name: 'Rubbish dump', at: [32, 11], box: [31, 11, 34, 12], script: 'rats' },
  { id: '3', name: 'Floorless room', at: [29, 14], box: [29, 14, 30, 15], script: 'floorless' },
  { id: '4', name: 'Corridor trap', at: [27, 10], box: [27, 6, 27, 14], script: 'green-slime', passage: true },
  { id: '5', name: 'Storeroom', at: [30, 6], box: [29, 4, 33, 7], script: 'belisarius' },
  { id: '5a', name: 'Hiding place', at: [29, 2], box: [29, 2, 30, 2] },
  { id: '6', name: 'Healing pool', at: [22, 5], box: [22, 5, 24, 5], light: 'pool-glow', sound: 'pool' },
  { id: '7', name: 'Coffin storeroom', at: [20, 4], box: [18, 3, 21, 4], script: 'coffins' },
  { id: '8', name: "Odric's bedroom", at: [12, 7], box: [10, 2, 15, 10], script: 'ghoul' },
  { id: '9', name: 'The office', at: [20, 9], box: [18, 8, 22, 11], light: 'lamp', script: 'arch-deaconess' },
  { id: '9a', name: 'Collapsed room', at: [24, 8], box: [23, 8, 25, 9], script: 'rockmen' },
  { id: '10', name: "Underpriests' room", at: [24, 18], box: [20, 17, 26, 20], light: 'candles', script: 'underpriests' },
  { id: '11', name: 'Room of absolution', at: [18, 24], box: [16, 23, 19, 25], script: 'bugbear' },
  { id: '12', name: 'Great sacrifice chamber', at: [13, 17], box: [7, 12, 18, 23], light: 'braziers', sound: 'braziers', script: 'odric' },
  { id: 'ante', name: 'Antechamber', at: [10, 22], box: [10, 22, 11, 23], passage: true },
  { id: '13', name: 'The cells', at: [6, 8], box: [3, 6, 8, 14], script: 'cells' },
  { id: '14', name: 'Treasure chamber', at: [3, 12], box: [3, 11, 4, 13], script: 'treasure' },
  { id: '15', name: 'Changing room', at: [8, 24], box: [5, 22, 10, 27], light: 'sconce', script: 'changing-room' },
  { id: '16', name: 'Old waiting room', at: [33, 20], box: [33, 19, 34, 21] },
  { id: '17', name: 'Oracle room', at: [40, 22], box: [38, 19, 41, 23], script: 'offerings' },
  { id: '18', name: 'Pit trap', at: [30, 22], box: [28, 22, 31, 23], script: 'pit-trap', passage: true },
  { id: '19', name: "Goblins' room", at: [23, 23], box: [22, 22, 25, 25], script: 'goblin-loop' },
  { id: '20', name: 'Cave', at: [41, 27], box: [39, 25, 45, 29], script: 'locusts' },
  { id: '21', name: 'Statue room', at: [30, 30], box: [28, 28, 32, 32], script: 'statue-oracle' },
  { id: '22', name: 'Meditation room', at: [22, 30], box: [20, 29, 24, 31] },
  { id: '23', name: 'Flooded storeroom', at: [12, 30], box: [10, 28, 15, 32], light: 'sunlight', sound: 'rushing-water', script: 'sword' },
];

// Doors that aren't plain oak. Doors open into rooms; between two rooms, into the
// higher-numbered one (the book's rule, handled by the game).
//   key: needs that key, or Open Locks, or smashing (doors) / Odric's keys (gates)
//   opensFrom: the side the door can be opened from (the one-way block)
export const DOORS = [
  { at: [9, 2], note: 'Opened by the lever under the bed in 8', lever: [10, 5] },
  { at: [29, 3], note: 'Sliding panel behind the packing cases' },
  { at: [2, 12], key: 'odric', note: 'Locked; Odric has the key' },
  { at: [5, 7], key: 'odric', note: 'Cell, locked' },
  { at: [7, 7], key: 'odric', note: 'Cell, locked' },
  { at: [4, 9], key: 'odric', note: 'Cell, locked' },
  { at: [31, 14], rotten: true, note: 'Rotten: kicking it drops the kicker into the pit' },
  { at: [33, 29], opensFrom: [34, 29], note: 'Spring-loaded sliding block: shuts after 6 rounds, no handle inside' },
];

// Ways between tiles that aren't walking.
export const LINKS = [
  { id: 'tunnel-9-18', from: [22, 10], to: [29, 23], kind: 'tunnel', note: 'Covered pit in 9, 10 ft down by wall rings, then a crawl tunnel to under the pit at 18' },
  { id: 'stairs-15', from: [7, 27], to: 'surface', kind: 'stairs', note: "Stairs up to the upper world: Odric's escape" },
  { id: 'entrance', from: [50, 14], to: 'surface', kind: 'tunnel', note: 'The 40 ft tunnel up to the hole in the temple floor' },
];

// Where the party arrives from the tunnel.
export const START = [49, 14];

// Furniture and fittings, in tile units (centres may fall between tiles). w, d: footprint;
// h: height; rot: turn in degrees. M0 draws them as grey boxes.
export const PROPS = [
  { kind: 'table', at: [39.6, 10.6], w: 1, d: 2, h: 0.55, rot: -30, room: '1' },
  { kind: 'bunk', at: [40.6, 9.4], w: 1.4, d: 0.6, h: 1.1, room: '1' },
  { kind: 'bunk', at: [37.8, 12.5], w: 1.4, d: 0.6, h: 1.1, room: '1' },
  { kind: 'cases', at: [29.6, 4.35], w: 1.6, d: 0.6, h: 0.9, room: '5' },
  { kind: 'coffins', at: [19.5, 3.3], w: 1.2, d: 0.5, h: 0.75, room: '7' },
  { kind: 'coffins', at: [20.7, 3.3], w: 1.2, d: 0.5, h: 0.75, room: '7' },
  { kind: 'coffins', at: [18.3, 4.5], w: 0.5, d: 1.2, h: 0.75, room: '7' },
  { kind: 'coffins', at: [21.7, 4.5], w: 0.5, d: 1.2, h: 0.75, room: '7' },
  { kind: 'coffins', at: [19.9, 4.7], w: 1.2, d: 0.5, h: 0.75, room: '7' },
  { kind: 'bed', at: [11, 5.7], w: 1.7, d: 0.9, h: 0.5, room: '8' },
  { kind: 'wardrobe', at: [14.6, 7.5], w: 0.6, d: 1.2, h: 1.4, room: '8' },
  { kind: 'table', at: [20.5, 9.6], w: 1.2, d: 0.8, h: 0.55, room: '9' },
  { kind: 'bundles', at: [26.5, 17.4], w: 0.8, d: 0.6, h: 0.4, room: '10' },
  { kind: 'urn', at: [16.6, 25.6], w: 0.5, d: 0.5, h: 1, room: '11' },
  { kind: 'urn', at: [17.2, 25.6], w: 0.5, d: 0.5, h: 1, room: '11' },
  { kind: 'urn', at: [17.8, 25.6], w: 0.5, d: 0.5, h: 1, room: '11' },
  { kind: 'urn', at: [18.4, 25.6], w: 0.5, d: 0.5, h: 1, room: '11' },
  { kind: 'urn', at: [19.0, 25.6], w: 0.5, d: 0.5, h: 1, room: '11' },
  { kind: 'urn', at: [19.6, 25.6], w: 0.5, d: 0.5, h: 1, room: '11' },
  { kind: 'pole', at: [13, 18], w: 0.2, d: 0.2, h: 2, room: '12' },
  { kind: 'brazier', at: [9.5, 18], w: 0.5, d: 0.5, h: 0.8, room: '12' },
  { kind: 'brazier', at: [16.5, 18], w: 0.5, d: 0.5, h: 0.8, room: '12' },
  { kind: 'chest', at: [4.6, 11.4], w: 0.6, d: 0.4, h: 0.4, room: '14' },
  { kind: 'chest', at: [4.6, 12.1], w: 0.6, d: 0.4, h: 0.4, room: '14' },
  { kind: 'chest', at: [4.6, 12.8], w: 0.6, d: 0.4, h: 0.4, room: '14' },
  { kind: 'chest', at: [4.6, 13.5], w: 0.6, d: 0.4, h: 0.4, room: '14' },
  { kind: 'chest', at: [7.5, 23.6], w: 0.8, d: 0.5, h: 0.5, rot: 45, room: '15' },
  { kind: 'sconce', at: [7.1, 27.2], w: 0.2, d: 0.2, h: 1.6, room: '15' },
  { kind: 'lamp', at: [20.5, 9.6], w: 0.2, d: 0.2, h: 0.85, room: '9' },
  { kind: 'candles', at: [25.5, 17.3], w: 0.4, d: 0.2, h: 0.2, room: '10' },
  { kind: 'table', at: [34.5, 21.4], w: 0.8, d: 0.8, h: 0.55, room: '16' },
  { kind: 'bench', at: [33.2, 20], w: 0.4, d: 2.6, h: 0.35, room: '16' },
  { kind: 'statue', at: [38.6, 21.7], w: 0.8, d: 0.8, h: 1.4, room: '17' },
  { kind: 'curtain', at: [40, 21], w: 4, d: 0.1, h: 2, room: '17' },
  { kind: 'chest', at: [22.3, 23.5], w: 0.5, d: 0.8, h: 0.5, room: '19' },
  { kind: 'corpse', at: [39.6, 26.5], w: 1.2, d: 0.4, h: 0.2, room: '20' },
  { kind: 'statue', at: [30.5, 30.5], w: 0.8, d: 0.8, h: 1.4, room: '21' },
  { kind: 'rock', at: [11, 32.4], w: 0.9, d: 0.7, h: 0.6, room: '23' },
  { kind: 'rock', at: [13.4, 32.3], w: 1.1, d: 0.8, h: 0.7, room: '23' },
  { kind: 'rock', at: [15.2, 31.2], w: 0.7, d: 0.7, h: 0.5, room: '23' },
  { kind: 'barrel', at: [11.6, 30.2], w: 0.5, d: 0.5, h: 0.6, room: '23' },
  { kind: 'barrel', at: [14.2, 30.4], w: 0.5, d: 0.5, h: 0.6, room: '23' },
];

// Fixed lights (PLAN.md 3.5). Only the fires, the pool and the daylight are lit: the human
// cultists keep lamps and candles, the infravision races live in the dark. The lamp, candles
// and sconce are our addition, not the book's. at: tile units; h: height in tiles.
export const LIGHTS = [
  { kind: 'brazier', at: [9.5, 18], h: 1.0, room: '12' },
  { kind: 'brazier', at: [16.5, 18], h: 1.0, room: '12' },
  { kind: 'lamp', at: [20.5, 9.6], h: 0.75, room: '9' },
  { kind: 'candles', at: [25.5, 17.3], h: 0.35, room: '10' },
  { kind: 'sconce', at: [7.1, 27.2], h: 1.6, room: '15' },
  { kind: 'pool', at: [23.5, 5.5], h: 0.3, room: '6' },
  { kind: 'sun', at: [12.5, 30.2], h: 1.95, room: '23' },
  { kind: 'daylight', at: [50.6, 14.5], h: 1.4, room: 'entrance' },
];

// Shafts of daylight (god rays): the hole in room 23's ceiling, and the light falling down the
// entrance tunnel. at: where the shaft meets the floor (tile units); len: its length; lean:
// radians from vertical, toward +x (yaw turns that direction); r: radius.
export const SHAFTS = [
  { at: [12.9, 30.4], len: 2.8, lean: -0.32, yaw: 0, r: 0.9, col: [1, 0.9, 0.7], i: 0.6 },
  { at: [49.6, 14.5], len: 2.4, lean: 0.85, yaw: 0, r: 0.45, col: [0.75, 0.82, 1], i: 0.22 },
];

// Room 12's floor markings: a huge green circle, white in the corners.
export const CIRCLE_12 = { at: [13, 18], r: 5.2 };
