# The Shrine of Kollchap

A turn-based Dungeons & Dragons dungeon crawl in WebGPU, for desktop Chrome and iPad. It recreates the dungeon designed in *What Is Dungeons & Dragons?* (Penguin, 1982). The full design is in [PLAN.md](PLAN.md).

**Status: M0 done, M1 under way.** The Dungeons of Kollchap are traced from the book's map, curated onto a 5 ft grid and shown as grey boxes. The dungeon is dark: the party's torch, the fires, the healing pool and the daylight are the only light, and the walls cast crisp shadows. Under fog of war you see only what is lit and in view; places you have seen stay as a dim memory. Walls between the camera and the party drop to knee height, so the party is never hidden. The stone, wood and iron are laid out procedurally in the shader with generated detail textures on top, and there are shafts of daylight and dust in the torchlight. You can orbit the dungeon and preview paths. There's no combat yet.

## Run it

```sh
npm run serve        # http://localhost:8080
npm test             # map validation and movement rules (node:test, no dependencies)
```

WebGPU needs a secure page: `localhost` or HTTPS. There is no build step. The game is plain ES modules loaded straight from `src/`.

## Map viewer controls

| | iPad | Desktop |
|---|---|---|
| Preview a path | Tap a tile | Hover a tile |
| Walk there | Tap it again | Click it again |
| Pan | Drag | Drag, WASD or arrow keys |
| Zoom | Pinch | Mouse wheel |
| Rotate | Twist two fingers, or ↺ ↻ | Q / E (N faces north) |
| Whole map / the party | ⤢ / ◉ | F |

The toggles switch on low walls (H), a tint per room (R), room labels (L), paths through secret doors (X, shown purple), climbing through pits (P), the tunnel between rooms 9 and 18 (T), and a map light that lifts the fog and shows the whole dungeon (M).

## The map

- `src/dungeon-data.js` is the curated map, one character per 5 ft tile. Its glyphs, the room table, special doors, links and props are documented in the file.
- `src/dungeon.js` parses it and provides the rooms, door state, Dijkstra pathfinding (diagonals only past open corners), reach and line of sight. It is pure JavaScript, so the tests run it under Node.
- `test/dungeon.test.js` checks the rules from PLAN.md 7.3: every room is reachable and can be left again, no single door cuts off room 23, and Odric's keys can be reached before the locks they open.
- `tools/trace-map.py` (Python 3 with Pillow and NumPy) traces the scan into a draft grid. Run `python3 tools/trace-map.py --overlay 0,0,27,34` to draw the curated map over the scan and check it.

## Textures

`tools/generate-textures.py` makes the surface textures with Gemini (`gemini-3.1-flash-image`), from the prompts in `tools/texture-manifest.json`. It needs a Gemini key in `GEMINI_API_KEY` or the project's `.env`, caches raw output in `.texture-cache/`, and stops before a run passes its spending cap ($5 by default). The images carry Google's invisible SynthID watermark. The game runs without them: any texture that fails to load falls back to the plain procedural surface.

The book's text and map are © 1982 and are used here for a personal project (PLAN.md §11).
