# The Shrine of Kollchap

A turn-based Dungeons & Dragons dungeon crawl in WebGPU, for desktop Chrome and iPad. It recreates the dungeon designed in *What Is Dungeons & Dragons?* (Penguin, 1982). The full design is in [PLAN.md](PLAN.md).

**Status: M0–M2 done (M1's iPad pass still to do).** The Dungeons of Kollchap are traced from the book's map and curated onto a 5 ft grid. The party of four explores it: walking in marching order, opening stiff doors, picking or smashing locks, searching for secret doors and keeping their torches lit while the dungeon clock runs. The dungeon is dark: the party's torch, the fires, the healing pool and the daylight are the only light, and the walls cast crisp shadows. Under fog of war you see only what is lit and in view; places you have seen stay as a dim memory. Walls between the camera and the party drop to knee height, so the party is never hidden. The stone, wood and iron are laid out procedurally in the shader with generated detail textures on top, and there are shafts of daylight and dust in the torchlight. There's no combat yet.

## Run it

```sh
npm run serve        # http://localhost:8080
npm test             # map validation and movement rules (node:test, no dependencies)
```

WebGPU needs a secure page: `localhost` or HTTPS. There is no build step. The game is plain ES modules loaded straight from `src/`.

## Playing

| | iPad | Desktop |
|---|---|---|
| Walk | Tap a tile to preview, tap again to go | Hover to preview, click to go |
| Move one hero alone | Tap their card or figure | Tab cycles, Esc clears |
| Actions (search, doors, locks, light) | Buttons along the bottom | Number keys 1–9 |
| Marching order | Tap two names to swap them | Same |
| Pan / zoom / rotate | Drag / pinch / twist | Drag or WASD / wheel / Q, E |
| Look somewhere | Tap the automap | Click the automap |

The party follows in marching order: single file in passages, closing into a 2×2 block in rooms. Walking stops at a closed door and tries to open it. Every 120 ft is a 10-minute turn, and a torch lasts 6. Torch flames lean toward undiscovered secret doors. 👁 holds viewing aids: low walls, room tint, labels, a map light that lifts the fog, and showing secret doors.

## The map

- `src/dungeon-data.js` is the curated map, one character per 5 ft tile. Its glyphs, the room table, special doors, links and props are documented in the file.
- `src/dungeon.js` parses it and provides the rooms, door state, Dijkstra pathfinding (diagonals only past open corners), reach and line of sight. It is pure JavaScript, so the tests run it under Node.
- `test/dungeon.test.js` checks the rules from PLAN.md 7.3: every room is reachable and can be left again, no single door cuts off room 23, and Odric's keys can be reached before the locks they open.
- `tools/trace-map.py` (Python 3 with Pillow and NumPy) traces the scan into a draft grid. Run `python3 tools/trace-map.py --overlay 0,0,27,34` to draw the curated map over the scan and check it.

## Textures

`tools/generate-textures.py` makes the surface textures with Gemini (`gemini-3.1-flash-image`), from the prompts in `tools/texture-manifest.json`. It needs a Gemini key in `GEMINI_API_KEY` or the project's `.env`, caches raw output in `.texture-cache/`, and stops before a run passes its spending cap ($5 by default). The images carry Google's invisible SynthID watermark. The game runs without them: any texture that fails to load falls back to the plain procedural surface.

The book's text and map are © 1982 and are used here for a personal project (PLAN.md §11).
