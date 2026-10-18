# The Shrine of Kollchap

A turn-based Dungeons & Dragons dungeon crawl in WebGPU, for desktop Chrome and iPad. It recreates the dungeon designed in *What Is Dungeons & Dragons?* (Penguin, 1982). The full design is in [PLAN.md](PLAN.md).

**Status: M0–M3 done (M1's iPad pass still to do).** The game starts at sunset in the ruined temple above Kollchap, where two hobgoblins watch the hole down. Climb down (or fight first), get past the bats, and explore the dungeon in marching order: stiff doors, picked or smashed locks, secret doors, burning torches and the dungeon clock. Meet the orcs and the giant rats in turn-based B/X combat: surprise, group initiative, move and act, an attack panel that lists every modifier and the odds, dice rolled out on the table, morale, and bleeding heroes to bandage. The dungeon is lit only by torches, fires, the healing pool and daylight, with crisp wall shadows and fog of war.

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
| Actions (search, doors, locks, light, climb) | Buttons along the bottom | Number keys 1–9 |
| Fight | Tap a blue tile to move, a foe to attack, then **Attack** | Same; Enter attacks, Space ends the round |
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
