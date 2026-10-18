# Dungeon Mania: The Shrine of Kollchap. Game plan

A turn-based Dungeons & Dragons dungeon crawl in WebGPU, built for desktop Chrome with a mouse and for iPad with touch. You control a party of four (Fighter, Magic-User, Cleric, Thief). The computer controls the denizens. The party goes down into the Dungeons of Kollchap to recover **the Sword of the Sorcerer** and get back out alive.

This is a plan only. No code has been written yet. It is in the same style as `proceed-to-the-chopper`, and reuses its architecture, renderer approach, input model and asset pipelines wherever it can.

> Reference material is in `docs/reference/`: `kollchap-map.jpg` (the book's map, a clean 3346 × 1988 photo) and `kollchap-entrance.jpg` (cross-section of the 40 ft entrance tunnel).
> Scenario text: https://muffinlabs.com/pages/the-shrine-of-kollchap.html/
> Book: *What Is Dungeons & Dragons?* (Butterfield, Parker, Honigmann; Penguin 1982). Chapter 3 designs Kollchap, and chapter 4 plays it.

---

## 1. Pitch and pillars

**Pitch:** a painted-miniature diorama that comes to life. The dungeon is a dark tabletop model lit only by the party's torches. The characters look like painted pewter miniatures on round bases, which is a nod to chapter 6 of the book, about metal miniatures. A Dungeon Master narrator reads the boxed text as each room is revealed, and every dice roll is shown and explained.

**Pillars**
1. **The book's dungeon, faithfully.** The game uses the same rooms, the same denizens, the same traps, and the same tricks and secrets. Where the book is vague, we pick the reading that plays best (§6).
2. **Classic Basic D&D rules, made readable.** The rules are B/X (1981) style: descending AC, d20 to hit, morale, saving throws, Vancian spells and thief percentages. The UI shows the maths behind every roll, the way the chopper game explains every shot.
3. **Light is life.** Passages have no light at all. Torches burn down, denizens with infravision see you before you see them, and the torch flame bends toward secret doors.
4. **Narrow corridors matter.** Most passages are 5 ft (one tile) wide, so marching order, who holds the front, and fighting through a doorway all count.
5. **Touch first, mouse equal.** Everything works with one finger on iPad. On desktop, hover adds path and roll previews.

---

## 2. Could 3D character models be created? Yes. There are three ways to do it.

The renderer is raw WebGPU, so any of these can work. They differ in look, cost, coverage and effort.

### Option A: procedural "miniature" rigs (recommended to start)
This extends the chopper's approach, where characters are jointed rigs built from instanced primitives and posed every frame (`proceed-to-the-chopper/src/game.js` `drawRig`). The upgrades are:
- **More primitives:** capsule, frustum/cone, tapered box, half-sphere (helmets), torus (shield rims, belts) and a lathe mesh (urns, pots). Each part is still one instance.
- **Painted-miniature shading:** each part has a flat paint colour, cavity darkening and edge highlights (a cheap rim term plus a curvature map baked into the primitives' normals). Every figure stands on a round base with a coloured rim: brass for the party, red for hostiles, and a glow when selected.
- **Cloth:** robes, capes and tabards are short chains of tapered boxes on a verlet spring. They sway when a character walks or turns. This suits the mage and all the Chaos priests.
- **Rig families:** these cover every creature in Kollchap. A data file describes each monster as a list of parts attached to joints.
  - **Biped:** heroes, orcs, goblins, hobgoblins, bugbear, priests, halflings, villagers, lizardman (plus tail), skeletons (thin bones), zombies (shambling gait), ghoul (crouched lope), rockmen (stacked boulders).
  - **Quadruped:** giant rats, the gecko.
  - **Segmented:** the giant centipede, as a chain of segments with a travelling leg wave.
  - **Insect:** the cave locusts, with 6 legs, hops and a spit.
  - **Flyer:** bats, drawn as an instanced flock with flapping wings.
  - **Blob:** the green slime, a sphere wobbled in the vertex shader with a translucent, glossy material.
- **Animation states:** idle breathing, walk (stepped to distance), melee swing, thrust, missile, cast (arms up and particles), hit flinch, death (skeletons collapse into a bone pile), asleep (lying down with "Zzz" motes), paralysed (frozen and frost-tinted), petrified (grey stone shader), fleeing and cowering.

*Pros:* no asset licensing, a tiny download, every creature can be built, one consistent style, and the code is proven in the sibling project. *Cons:* the figures look like toys. The miniature art direction turns that into a deliberate style.

### Option B: rigged 3D models from free CC0 packs (upgrade path)
- [KayKit Character Pack: Adventurers](https://kaylousberg.itch.io/kaykit-adventurers) is CC0, rigged, and has about 75 animations and a single 1024 px gradient-atlas texture. Kay Lousberg's [KayKit](https://kaylousberg.itch.io/kaykit) range also has skeleton and dungeon prop packs. Check the exact character list in the free tier before committing.
- New work needed:
  - Extend the chopper's `tools/build-vehicles.py` approach into `tools/build-models.py`. It would turn GLB files into JSON with joints, skin weights and animation clips baked to 30 fps.
  - Add a **skinned vertex path in WGSL**, with a joint-matrix palette in a storage buffer and an offset per instance.
  - Add animation blending (crossfade between clips).
- Coverage gap: humanoids and skeletons are covered well, but rats, centipedes, locusts, bats, the gecko and the slime probably aren't. Those stay procedural (Option A).
- Props are the easy win here: coffins (room 7), urns (11), chests (14, 15, 19), bunks and tables (1), barrels (23) and statues (17, 21). Static GLB props go through the same tool as the chopper's cars.

### Option C: AI-generated 3D models
- Pipeline:
  1. Generate a consistent front and side reference image per creature with an image model (Gemini "Nano Banana" is already used for chopper textures).
  2. Turn the image into a 3D model with an image-to-3D service (Meshy, Tripo, Rodin, Hunyuan3D or TRELLIS).
  3. Auto-rig the bipeds (Meshy, Tripo or Mixamo).
  4. Decimate to 2–5k triangles.
  5. Export GLB and feed it through the same `build-models.py` as Option B.
- **Neither ElevenLabs nor Cloudflare Workers AI offers 3D generation** (I found none in Cloudflare's catalog), so this needs another paid account.
- Quality varies. Bipeds rig acceptably, but multi-legged creatures don't, and a set made this way needs art-direction passes to look consistent.

### Decision (§12)
Build **Option A for everything** through the core milestones. It proves the gameplay, and the art direction holds together on its own. Keep a clean seam between game state and visuals: each unit type points at a **visual provider** (`procedural` or `skinned`). Then at milestone M9, evaluate Option B for the four heroes and the humanoid villains, and keep the procedural creatures. Separately, use an image model for **2D portraits** of the party and NPCs on the HUD cards and in dialogue. That is cheap, and it lifts the game a lot.

---

## 3. Rules base: classic Basic D&D (B/X), adapted

The scenario's stat blocks are B/X: `AC 6; HD; MV 90'; Save F1; ML 8`. We use those rules and keep the numbers recognisable.

### 3.1 Scale and grid
- **1 tile = 5 ft = 1 world unit.** The map's scale bar is 5 ft, and passages are 5 ft wide, so that is 1 tile. The passages to room 12 are 10 ft, so 2 tiles. Ceilings are 10 ft, so walls are 2 units high.
- On the 3346 × 1988 map, the scale bar's ticks are about 66 px apart, but 5 ft passages measure only 42–55 px between their wall lines. **The trace uses 54 px per tile**, which fits passages to 1 tile, since that is what play depends on (§7.3). The curated grid is **52 × 34 tiles with 630 walkable tiles**, small enough to keep fully resident.
- Movement is 4-way, with diagonals allowed only when both side tiles are open. That stops anyone slipping through corridor corners.

### 3.2 Two modes, both turn-based
D&D itself splits play into **exploration turns** (10 minutes each) and **combat rounds** (10 seconds each). We use the same split:

| | Exploration mode | Encounter mode |
|---|---|---|
| Trigger | No hostiles are aware or visible | Either side sees the other, a trap fires, or someone opens a door onto monsters |
| Movement | Tap a destination. The party walks there in **marching order**, or one character moves alone if selected | Each character moves up to their encounter speed, then takes one action |
| Time | Distance walked and actions taken advance the **dungeon clock** (10-minute turns). Torches burn and wandering-monster checks run | Rounds. The clock stays still |
| Actions | Search, Listen at door, Open/Force door, Pick lock, Disarm trap, Rest, Swap marching order, Light torch | Attack, Cast, Turn Undead, Use item, Withdraw, Dash, Hide, Open door, Pick up |

The switch is shown on screen: the screen dims, a gong sounds, and the **surprise roll** (d6; 1–2 means surprised) and **initiative roll** are shown on 3D dice.

### 3.3 Round structure
- **Group initiative** each round: each side rolls d6 and the higher roll acts first. A tie goes to the party. Settings will offer an option for "party always first".
- On the party's phase, characters act in **any order the player chooses**, like the chopper. Each character can **move and act, in either order, once per round**. Moving after an action is allowed only if the character didn't move before it.
- Denizens act with visible choreography: the camera follows, and promise-based tweens sequence everything (the chopper's `tween`/`sleep` pattern).
- Encounter speed is B/X encounter movement, which is base MV ÷ 3:

| Base MV | Per round | Tiles | Who |
|---|---|---|---|
| 120' | 40' | 8 | Magic-User, rats, bats, orcs |
| 90' | 30' | 6 | Thief, hobgoblins, ghoul, bugbear |
| 60' | 20' | 4 | Fighter and Cleric in metal armour, goblins, skeletons, locusts, lizardman |
| 30' | 10' | 2 | Chaos priests in heavy armour |
| 3' | ~1' | 0–1 | Green slime |

- **Dash** doubles the move but allows no action. **Withdraw** is B/X's fighting withdrawal: half move, and no free attack from enemies.
- Wading through water (room 23), rubble and the cave count as difficult terrain and cost 2 tiles each.

### 3.4 Attacks, damage, saves, morale
- **To-hit:** B/X attack matrix. A level 1–3 character needs `19 − targetAC` on d20. Monsters use the HD rows. A natural 20 always hits and a natural 1 always misses.
- **Modifiers**, each listed in the attack panel before you commit:
  - STR bonus to melee, DEX bonus to missiles
  - Backstab +4 (thief, unseen target, ×2 damage)
  - Attacking from behind +2. Darkness or an unseen attacker −4
  - Bat swarm −2 (and no casting)
  - Sun glare in room 23: −2 on the first round
  - An untrained user swinging a skeleton's scimitar −2
  - Bless, Shield (AC 2 vs missiles, AC 4 vs melee), Protection from Evil (enemy −1, and summoned or enchanted creatures cannot touch you)
  - Cover against missiles
  - A target that is asleep, held or paralysed is hit automatically
- **Damage:** variable weapon dice: sword d8, mace d6, short sword d6, dagger d4, sling d4, short bow d6. Monster damage uses the scenario's own values.
- **Saving throws:** the five B/X categories by class and level (Death/Poison, Wands, Paralysis/Stone, Breath, Spells). They are used for the ghoul's paralysis, the rockmen's petrification, the chest needles, the centipede's poison and Hold Person.
- **Morale (ML):** each enemy group rolls 2d6 against ML at its first death and again when half the group is down. On a failure, it flees or surrenders according to the room script (§6). ML 12 never breaks (undead, slime, rockmen).
- **Death:**
  - Normal: at 0 HP a character is *Downed* and dies at the end of their 3rd round unless healed (Cure Light Wounds, a potion or a bandage action). This mirrors the chopper's downed state.
  - Classic: 0 HP is death.

### 3.5 Light, vision, noise, stealth
- **Light:** a torch lights 30 ft (6 tiles) and lasts 6 turns. A lantern lights 30 ft and lasts 24 turns per flask. The Light spell lights a 15 ft radius for 12 turns, or blinds a target if cast on their eyes. A carried light makes the carrier visible from anywhere with line of sight.
- **Torch-bearers:**
  - Each lit torch burns down on its own clock, so every extra torch costs light later. The default is **two lit torches**, one at the front of the marching order and one at the rear. Players can light more or fewer.
  - Carrying a torch or lantern takes a hand, so the bearer can't use a shield, bow or sling. The game suggests Ysolde as the first bearer, because she has no shield to give up.
  - Dropping a light is a free action in an encounter. It keeps burning on the floor and lighting its radius until it runs out or someone picks it up.
  - The budget is 9 torches (54 torch-turns), one lantern, and the Light spells. At two torches, that is about 27 turns of light before the lantern and spells, which is enough for a careful run but not for searching every wall.
- **Lantern and oil:** Ysolde carries a hooded lantern, which starts full. Shuttering it is a free action: the lantern goes dark and stops giving the carrier away, which suits sneaking with the thief. Each of the 2 flasks of oil either refuels the lantern for 24 turns or is thrown as fire (1d8 on a hit, then 1d8 the next round), for use against green slime, zombies and the gecko. Each flask can only be used one way, so players have to choose.
- **Fixed lights:** almost everywhere is dark. The few lit places are:
  - The entrance, with daylight coming down the shaft.
  - Room 6, with the healing pool's green glow.
  - Room 9, with an oil lamp on the Arch-deaconess's table.
  - Room 10, with candles where the underpriests are praying.
  - Room 12, with the green braziers.
  - Room 15, with a wall sconce beside the stairs on Odric's escape route.
  - Room 23, with the shaft of sunlight.
  - The rule behind them: the human cultists need light and keep it, while the orcs, goblins and other infravision races live in the dark. The lamp, candles and sconce are our addition, not the book's. Hide in Shadows doesn't work in a lit room, and when a door to one opens, its light spills into the corridor.
- **Infravision:** orcs, goblins, hobgoblins and the bugbear see 60 ft in the dark, so they often spot the party first. That makes for real tension and fair ambushes, because the HUD shows "You hear movement…".
- **Visibility:** a tile is visible if it is in line of sight **and** lit, or within 1 tile.
  - Explored tiles stay as a dim, desaturated memory, the way fog of war works in the chopper.
  - Unexplored tiles are black. The renderer skips shading there, as in the chopper.
- **Noise:**
  - Sources include combat, forcing doors, smashing locks or urns, falling into pits, and armour clanking when running.
  - Each source makes noise with a radius. Denizens inside the radius investigate, following the chopper's `noise(x, y, r)` and the suspicious → investigate → alerted ladder.
  - The orcs in room 1 are scripted to react to noise exactly as the book says (§6).
- **Thief stealth:**
  - Move Silently stops the thief's movement making noise.
  - Hide in Shadows works on dark tiles and makes the thief unseen, which enables backstab.
  - Hear Noise works at doors: on 1–2 on d6, it reveals who is on the other side as audio cues and silhouettes.

### 3.6 Doors, secret doors, traps, searching
- **Doors** are oak, 6 × 3 ft, and open into the higher-numbered room. They follow the book's rule.
  - A stuck door opens on 1–2 on d6, or 1–3 with a STR bonus. Forcing a door makes noise.
  - A closed door blocks sight and halves noise.
- **Locked doors and chests:**
  - The thief can try Open Locks. A failure costs a turn of exploration time, or a round in an encounter. Retrying is allowed, unlike in B/X, and is house-ruled for a video game.
  - A lock can also be smashed: loud, with a 20% chance of breaking the weapon, as in room 14.
  - Keys open the matching locks automatically.
- **Secret doors:**
  - Search covers a 2-tile radius in 1 exploration turn, and finds a secret door on 1 in 6. Anyone can search. Each further search raises the odds a little, so nobody gets stuck.
  - **Fair hint:** within 3 tiles of an undiscovered secret door, torch flames lean toward it and dust motes drift. Observant players can spot it without grinding rolls.
- **Traps:**
  - The thief's Find Traps works on a tile or object. Anyone else finds traps on 1 in 6.
  - Disarm uses Remove Traps. A failure by 20 or more springs the trap.
  - The traps are listed per room in §6.

### 3.7 Time, resting, healing
- **The dungeon clock:**
  - Exploration time ticks by distance: 120 ft (24 tiles) of walking is one turn.
  - Searching, picking a lock, listening and resting each cost a turn.
  - The HUD shows a torch-burn meter and the turn count.
- **Wandering monsters:** a check every 2 turns, on 1 in 6. The scenario has no table, so we draw from the residents: a 2-orc patrol, a goblin runner, 1d4 giant rats or a skeleton. Residents who leave their post are removed from their room, which keeps the count consistent.
- **Resting:** a 1-turn breather recovers 1 HP per character, once per room cleared. A **full camp** restores spells and 1d3 HP. It is only allowed in a cleared room with the door shut, and it costs 6 turns and 3 wandering-monster checks.
- **The healing pool (room 6):** half a pint heals 1d6, no more than maximum. Flasks can be filled, but the water turns poisonous (1d6) in daylight, which matters if anyone tries to carry it to the surface. This is from the book.

### 3.8 Difficulty
| Setting | Party level | HP | Death | Notes |
|---|---|---|---|---|
| Story | 3 | Maximum | Downed, revive at end of encounter | +2 potions |
| **Normal** (default) | 2 | Maximum at 1st level, rolled after | Downed for 3 rounds | 2 potions |
| Classic | 1 | Rolled | 0 HP = dead | B/X as written. The cleric has no spells at level 1 |

---

## 4. The party

These names are decided (§12). We use them rather than the book's chapter 4 party.

| | **Brannoc**, Fighter | **Ysolde**, Magic-User | **Aldwin**, Cleric | **Fennick**, Thief |
|---|---|---|---|---|
| Key stats | STR 16 (+1/+1), CON 14 | INT 17, DEX 13 | WIS 16, STR 13 | DEX 17 (+2 AC, +2 missile) |
| HP (Normal, L2) | ~15 | ~6 | ~10 | ~7 |
| AC | 2 (plate + shield) | 9 | 4 (chain + shield) | 5 (leather + DEX) |
| Encounter move | 4 tiles | 8 tiles | 4 tiles | 6 tiles |
| Weapons | Sword d8 and shield, short bow d6 for reach down corridors | Dagger d4, 3 throwing daggers | Mace d6, sling d4 (clerics use blunt weapons only) | Short sword d6, sling d4, backstab ×2 |
| Specials | Holds the line: enemies moving past an adjacent fighter stop (zone of control). Force doors +1 | Spellbook: Sleep, Magic Missile, Light, Shield, Charm Person, Read Magic. Memorises 2 at L2 | Turn Undead. 1 spell at L2 (Cure Light Wounds, Protection from Evil, Light, Detect Evil, Remove Fear) | Open Locks 20%, Find/Remove Traps 15%, Move Silently 25%, Hide in Shadows 15%, Climb Walls 88%, Hear Noise 1–2 |
| Kit | Torch ×3, rope 50', iron spikes | Torch ×2, hooded lantern (full), flask of oil ×2 | Holy water ×2, holy symbol, torch ×2 | Thieves' tools, 10' pole, torch ×2 |

**Spells for v1:**
- **Magic-User:** Sleep (2d8 HD of creatures, none above 4+1 HD, no save; it is *the* lifesaver against goblins and orcs), Magic Missile (1d6+1, auto-hit), Light, Shield, Charm Person (with a save; a charmed denizen becomes an ally and guide, which is great against Belisarius's captors or a goblin), Read Magic (scrolls).
- **Cleric:** Cure Light Wounds (1d6+1, or cures paralysis), Protection from Evil, Light, Detect Evil (shows Chaotic auras through walls within 120 ft for 6 turns), Remove Fear.
- **Turn Undead** (B/X table), against the 3 skeletons, 2 zombies and the ghoul. At L1: Skeleton 7, Zombie 9, Ghoul 11. At L2: Skeleton T, Zombie 7, Ghoul 9. At L3: Skeleton T, Zombie T, Ghoul 7.
- **Enemy spells:** Hold Person and Light (the Arch-deaconess), Cure Light Wounds (Kithar), and Protection from Evil.
- **Scrolls in room 14:** Protection from Evil, and Cure Light Wounds ×2. The cleric uses them directly. The Magic-User needs Read Magic only for arcane scrolls.

**Recruits** (each one joins as a 5th or 6th controllable character):
- **Belisarius** (Thief L1, room 5) is starving and frightened. He refuses to stand in the front rank and has a 50% chance to flee from any fight where an ally is down. He knows the orcs and the secret door in room 1.
- **Rosa Dobbit** (Halfling Fighter L1, room 12) joins out of gratitude if rescued. She is likely the captured halfling from Belisarius's party, and they get a reunion line.

---

## 5. Goal, endings and rating

- **Main goal:** find the Sword of the Sorcerer (room 23) and get out alive, either by the entrance tunnel or by the stairs from room 15.
- **The sword:** +2, and it **hums within 20 ft (4 tiles) of any Chaotic creature**. In the game:
  - A low hum loop plays, rising with how close the Chaotic creature is.
  - A pulse ring on the wielder's base shows the direction.
  - This works as a sonar for ambushes and hidden priests, so finding the sword changes how the way out plays.
- **Side goals (they count toward the rating):**
  - Rescue Rosa
  - Free the 8 prisoners in room 13 (they need Odric's keys). One of them is a merchant who pays 50 gp
  - Defeat Odric, or drive him off
  - Resolve the Arch-deaconess, either by fighting her or by guiding her to the Tranfax statue
  - Treasure (gp value)
  - Rounds and turns taken, and characters lost
- **End screen:** this follows the chopper's rank-and-stats grid, framed as the DM's tally of XP earned in B/X terms (gp plus monster XP). The narrator voices one of several endings: for example, sword recovered with the shrine to be destroyed, villagers freed, or party lost.

---

## 6. The dungeon, room by room

The topology below was read from the book's map and the scenario text. **(?)** marks an interpretation to confirm while tracing. Where the scan is ambiguous, keep at least two routes to room 23.

### 6.1 Topology
- **Surface → Entrance:**
  - The temple ruins (2 hobgoblins) have a 4 ft hole.
  - The hole leads down a steep 40 ft tunnel heading west, with stalactites and a bat nest about 30 ft in.
  - The tunnel arrives "From above" at the **east end of the Entrance Corridor**.
- **Entrance Corridor** (E–W):
  - A **secret door** in its north wall leads to **room 1**.
  - Part way along, a branch goes **south**, past room 16, to the 16/17/18 corridor.
  - Its west end reaches **room 3**.
- **Room 3** (floorless) links the Entrance Corridor (east door) to **Corridor 4** (west door).
- **Corridor 4** (N–S, green slime on the west wall):
  - At its north end it meets the E–W passage that leads to **room 2** and **room 1's west door**, then continues to **room 5**.
  - A **secret door** on its west side opens into a short passage under 9a that joins the **wide (10 ft) corridor**. The wide corridor runs along room 9's south wall (9's door) from **room 8's south-east door** to **room 12's NE double door**, with a branch south into **10**.
- **North corridor** (E–W): from the top of corridor 4 west, past the **healing pool (6)** and the door of **room 7**, to **room 8's** east door.
- **Room 9** ↔ **9a** through the hole in its wall (the book says the north wall; the map puts it at the north-east corner). A **covered pit** next to 9's table drops 10 ft into a crawl tunnel to **room 18**. Model this as a traversal link, not a second map layer.
- **Room 8** (Odric's bedroom):
  - **A** marks where the ghoul waits, not a door. Room 12's north tip only touches 8's south wall, and the book gives no link between 8 and 12. Room 8 reaches 12 through its **south-east door** and the wide corridor.
  - A **lever-operated secret door** at its NW corner opens onto the **rear corridor**, which runs west, then south down the dungeon's west edge.
- **Rear corridor:** room 8 ↔ room 14 (locked door, Odric's key) ↔ room 15 (secret door) ↔ **stairs up to the surface**, which is the alternative exit.
- **Room 13** (cells): a passage from its south arm leads to 12's NW face.
- **Room 12** (Great Sacrifice Chamber, a diamond with a green circle):
  - NE double door to the wide corridor, NW door to 13's south arm
  - SW door through a small antechamber to **15**
  - SE door to a passage that runs along the SE face, past **room 11's** door, down to the **southern junction**
- **Southern junction:** the passage from 12's SE door, the corridor east past **22's** door and then stepped down to **room 21's west secret door**, and the **wet stairs down to room 23**.
- **Room 10** is reached only by the branch from the wide corridor. On the book's map its west door opens into a dead-end alcove squeezed behind room 11; the grid leaves the alcove out.
- **Room 19** (goblins): two doors on its east side, each with its own corridor to **18**, forming a loop the goblins run when they flee.
- **Room 18** (pit trap; it is the bottom end of the tunnel from 9) is a hub:
  - Corridors to 19 (×2)
  - East to 17, with 16 nearby
  - South down a dead-end corridor along **room 21's east wall** (the one-way sliding block door), with a branch east to the **cave, room 20**

### 6.2 Routes to the sword
1. **The east route:** Entrance → south branch → 18 (pit trap) → corridor south → **21** (the one-way trap room; the party must find the west secret door) → stepped corridor past 22 → junction → stairs → **23**.
2. **The north route, through 12:** Entrance → 3 (floorless) → 4 (slime) → secret door → wide corridor → **12** (Odric's chamber, the biggest fight) → SE door → junction → **23**. Every way in from the north crosses 12: through the wide corridor, from 13's arm, or from the rear corridor through 15 and the antechamber.
3. **The tunnel route:** 18 → climb the tunnel → up through 9's pit (the Arch-deaconess) → wide corridor.

### 6.3 Encounters and adaptations

Stat blocks are in Appendix A.

| # | Room | Book content | Game adaptation |
|---|---|---|---|
| — | **Temple ruins** (surface) | 2 hobgoblins. They attack only if someone climbs into the hole or they are attacked | The **tutorial**: a sunset daylight scene with long shadows. You can sneak (Hide), fight, or descend while they watch, which triggers the attack. Teaches move, attack and the roll panel |
| — | **Entrance tunnel** | 40 ft steep descent. DEX check or fall for 1d6. Being hit while climbing: fall on 1–4. Bats 30 ft in | Using **rope and spikes** removes the checks. The **bat swarm** is a boid flock: −2 to hit and no casting for a few rounds. The bats scatter from torch waves and are never "killed" one by one |
| 1 | **Orc guardroom** | 4 orcs. If the party is noisy, they sneak out of the secret door and attack from behind. One guards the door | Scripted noise trigger: entrance-corridor noise ≥ threshold → orcs exit the secret door **behind the party** with surprise. Quiet parties find them on their bunks. Coins on the bodies need a Search |
| 2 | **Rubbish dump** | 5 giant rats. 216 sp in the rubble | Searching disturbs the rats. On a morale failure they flee into the rubble and come back if you keep searching. The rat bite carries a disease chance (Save vs Poison or −1 max HP until rested) |
| 3 | **Floorless room** | The floor has collapsed into a 10 ft pit. Kicking the rotten door collapses it into the pit. The far door has a ledge for one | The door asks **Force?** (risk of a fall) or **Open carefully**. Crossing: climb down and up (thief: automatic; others: DEX check), a rope bridge with spikes, or a 10' pole for testing. Only one character fits on the ledge at the far door |
| 4 | **Corridor trap** | Green slime on the west wall drops on a random passer-by. Only fire or cold hurt it. It eats metal and wood in 6 rounds, then turns the victim into slime | A subtle wet-shine tell in torchlight, which the Search or Find Traps action spots. If it hits: a 6-round countdown on the victim's card. **Burning it off** with a torch or oil splits damage between slime and victim. Cure Disease isn't available at these levels, so fire is the answer |
| 5 | **Storeroom** | Belisarius hides behind a sliding panel behind packing cases | Moving cases takes 1 turn, then Search. Dialogue: he begs for food and offers what he knows about room 1 and Odric. He is **recruitable** |
| 6 | **Healing pool** | Heals 1d6 per half pint. Turns poisonous in daylight | Greenish glow and caustics. Flasks can be filled. The poison twist triggers only above ground |
| 7 | **Coffin storeroom** | 15 empty coffins | A red-herring dread room. Searching each coffin costs time. One rattling coffin gives a jump scare: a rat. A good room for camping |
| 8 | **Odric's bedroom** | Ghoul "pet" at A, fights to the death. Silk and vestments worth 100 gp. Secret door opened by a lever under the bed | Ghoul paralysis (save, or paralysed for 2d4 rounds; elves are immune but there are none here). Turn Undead matters. The lever is found by searching the bed, and the torch-lean hint points at the outline |
| 9 | **The office** | The Arch-deaconess of Tranfax (C4) asks about her stolen statue. If you know where it is, she asks you to guide her. Otherwise she attacks and calls the 2 rockmen. Table: map (20%). Covered pit to 18 | Lit by an oil lamp on the table. **Dialogue branch** (§8.3): lie, bargain, guide her (she becomes a temporary NPC ally until room 21, then leaves with her statue), or fight. Hold Person on the fighter is her opening move. The 20% map reveals the whole automap |
| 9a | **Collapsed room** | 2 rockmen searching the rubble. They come when called | Petrifying touch (Save vs Stone, or the character becomes a statue until the end of the mission on Normal; dead on Classic). They obey the Arch-deaconess only |
| 10 | **Underpriests' room** | Kithar (C2, holding a silver hemisphere), Kerzen and Ojar (C1, praying). They fight unless they surrender, and take the hemisphere if they flee | Lit by their prayer candles, so the party sees them as soon as the door opens. **Surrender** is a real option (they keep their morale numbers). Prisoners can be questioned with scripted lines. Kithar casts Cure Light Wounds on allies. The hemisphere is worth 100 gp |
| 11 | **Room of absolution** | A bugbear guards 6 urns. A pearl (60 gp) in each. A Chaotic priest seeing a pearl attacks | Smashing urns makes noise (crushing weapons only). Carrying pearls makes Chaotic priests hostile on sight, even ones who had surrendered |
| 12 | **Great sacrifice chamber** | Odric (C3), 3 skeletons, a gecko chained to the pole, Rosa being dragged to it. Odric orders the skeletons in, tries to sacrifice Rosa, unchains the gecko and flees by room 15 when it looks hopeless. Keys and 30 gp | **The boss set-piece.** Rosa's sacrifice is a **round timer** (3 rounds), shown on her portrait. The gecko only attacks inside the green circle until unchained. Odric's escape path goes through 15 to the rear corridor and stairs. Chasing him or cutting him off is a choice. Skeleton scimitars can be picked up at −2. Green braziers light the room |
| 13 | **The cells** | 2 zombies. 8 prisoners behind bars, including a merchant who pays 50 gp. Odric's keys needed | Turn Undead or fight. Freed prisoners are escorted NPCs who follow the party, can't fight, and panic in combat. Escorting them out raises the rating |
| 14 | **Treasure chamber** | Locked (Odric's key). A giant centipede between the chests. 4 chests: a false bottom with 3,000 sp; a statuette worth 300 gp; a poison-trapped chest with 1,000 gp and 2 gems (save or paralysed 2d4 hours); a death-poison chest with 3 scrolls (save or die in 10 minutes unless Cure Light Wounds) | Find and Remove Traps on each chest. A needle hit on chest 4 starts a **10-turn death clock** that only Cure Light Wounds stops, after which the victim is helpless for the rest of the mission. Smashing locks risks breaking the weapon (20%) |
| 15 | **Changing room** | Odric's robes. Secret door to the rear corridor. Stairs up | Odric's escape hatch and the alternative exit. A wall sconce lights the stairs. The chest of green and white robes can be worn as a disguise: unaware cultists ignore the wearer at a distance |
| 16 | **Old waiting room** | Bench and junk, nothing of value | A quiet camp spot near the hub |
| 17 | **Oracle room** | A 7 ft statue holding an alms dish marked "Offerings". Red curtains behind | Offering coins gives a scripted cryptic hint, which signposts that statues here *talk*. Behind the curtain is a draughty wall, but no door |
| 18 | **Pit trap** | Stepping on the cover drops you 10 ft for 1d6. It is the bottom end of the tunnel from room 9 | Find Traps or a 10' pole reveals it. Fleeing goblins **jump it**, which shows the player where it is if they're watching. The tunnel climb up to 9 uses the old handholds (Climb Walls, or a DEX check for others) |
| 19 | **Goblins' room** | 4 goblins. On a failed morale check they flee out the other door, loop through 18 and return by the first door. A chest: 23 gp, 570 sp, 3,004 cp | The loop is scripted. The return shows up as an ambush from behind if you didn't close the far door. Coins are heavy: 3,004 cp is the classic "is it worth carrying?" choice |
| 20 | **Cave** | 2 cave locusts, camouflaged. A corpse in plate mail with a sword and a map of rooms 1, 2 and 5 | Locusts reveal themselves only when you're adjacent or they spit (Save vs Poison, or 1 round of retching). The corpse's map reveals that part of the automap, and the body is the start of Belisarius's story |
| 21 | **Statue room** | A one-way sliding block door shuts after 60 seconds. A statue answers 3 "How" questions a day, of 12 words or fewer, and one answer is false. Secret door west | **The AI oracle** (§8.3). The door shuts **after 6 rounds**, which the HUD counts down, and can't be opened from inside, so the party must find the west secret door. This is also the Arch-deaconess's stolen statue, which ties the plot together |
| 22 | **Meditation room** | Frescoes of halflings being tortured | No encounter. Rosa (if present) reacts with a voice line. The frescoes are a texture set piece |
| 23 | **Flooded storeroom** | Wet stairs (save or fall 1d3). A shaft of sunlight dazzles (−2 first round). A lizardman sits on a rock. **The Sword of the Sorcerer** is behind the rock, with a bag of 5 cp | **The finale:** a god-ray light shaft, water glitter, wading (difficult terrain). The lizardman (Neutral, 1 HP, ML 12) can be fought, **bribed with food**, or charmed. Picking up the sword plays the narrator's sting, the hum starts, and the objective changes to **Escape** |

The scenario has no wandering monster table, so the residents serve as wanderers (§3.7). On the way out, the dungeon is **re-alerted**. If Odric escaped, surviving priests and orcs regroup at chokepoints. That gives the sword's hum a job to do.

---

## 7. Technical architecture

### 7.1 Stack (same as proceed-to-the-chopper)
- **Zero-dependency static site:** `index.html` (inline CSS plus the DOM HUD) and `src/*.js` ES modules. There is no build step, and it is served with `npx http-server`.
- **Raw WebGPU and WGSL** in template strings. There is no engine.
- The core files are copied over and adapted: `util.js` (mat4, rng, heap), `input.js` (pointer events, pinch, twist, tap-twice), the renderer skeleton (instancing, bloom, MSAA, adaptive resolution) and the camera.
- **New:** a small `node:test` suite for the pure modules (rules, dice, LOS, pathfinding, map validation). It still needs no dependencies. The chopper has no tests, but D&D rules are exactly the kind of code that breaks quietly.

### 7.2 File layout
```
index.html                 HUD DOM + CSS (same panel language as chopper, parchment/brass palette)
src/
  main.js                  boot, RAF loop, attract-mode title (camera drifts through the lit dungeon)
  renderer.js              WebGPU: instancing, grid shadows, point lights, fog, cutaway, water, god rays, bloom
  scene.js                 dungeon → geometry (walls, floors, rubble, cave rock, props), chunked
  dungeon-data.js          traced ASCII map + room table + doors/secrets/traps/links (hand-curated)
  dungeon.js               tile arrays, LOS, light/visibility, reach/pathTo (Dijkstra), doors state
  rules.js                 PURE: dice, attack matrix, saves, morale, turn undead, thief skills, spells
  defs.js                  classes, party, monsters (Appendix A), items, spells, difficulty
  game.js                  modes, clock, rounds, actions, events queue, encounter triggers, room scripts
  scripts/rooms.js         per-room behaviours (orc ambush, goblin loop, Odric, door 21 timer…)
  ai.js                    denizen brains: guard/patrol/investigate/combat/flee/surrender, spellcasters
  models.js                miniature rig definitions per creature type (data)
  anim.js                  procedural animation: gait, swing, cast, cloth verlet, death poses
  dice3d.js                d20/d6 meshes + tumble-to-result animation overlay
  fx.js                    torch embers, bats boids, spell fx, splashes, dust, blood/ichor, decals
  ui.js                    party cards, initiative bar, roll panel, log, automap, dialogue, menus
  automap.js               parchment map drawn in the book's style as you explore
  dialogue.js              scripted dialogue trees (Belisarius, Arch-deaconess, priests, Rosa, merchant)
  oracle.js                client for /api/oracle (+ offline fallback)
  audio.js                 Web Audio buses, dungeon reverb, positional sound, voice gate, sword hum
  save.js                  autosave/resume (localStorage, versioned JSON)
  util.js
tools/
  trace-map.py             map scan → grid draft (see 7.3)
  audio-manifest.mjs       voices, lines, SFX prompts
  generate-audio.mjs       ElevenLabs generator (from chopper, extended for narration + music)
  generate-textures.py     seamless textures, --provider gemini|cf-lucid|cf-phoenix|cf-flux2 (from chopper)
  texture-manifest.json    shared style + per-texture prompts, size, pick
  generate-portraits.mjs   portraits + bestiary cards, same --provider switch
  compare.html             side-by-side provider bake-off (textures tiled 3×3, portraits)
  build-models.py          (M9) GLB → JSON for props / skinned characters
worker/                    Cloudflare Worker (or Pages Functions; hosting undecided): /api/oracle, /api/tts
test/                      node:test suites
assets/ audio/ textures/ portraits/ models/
docs/reference/            book map + entrance cross-section
```

### 7.3 Map authoring: trace, then curate
1. `tools/trace-map.py` opens the scan's light areas so the rock speckle drops out, measures the 5 ft scale bar and the passage widths (§3.1), fits the grid origin, and writes a **draft ASCII grid**. `#` is rock and `.` is floor. With `--overlay` it draws the curated map over the scan for checking.
2. Hand-curate `dungeon-data.js` using these glyphs:
   - `+` door, `S` secret door, `L` lever secret door, `B` one-way sliding block, `G` barred cell gate, `=` bars
   - `P` pit, `h` covered pit (the hatch in 9), `~` water, `O` deep pool, `_` stairs, `r` rubble, `c` cave floor, `<` tunnel up to the surface
   - Thin walls on the book's map still take a whole rock tile, and every door takes a tile of its own, so a few rooms shift by up to a tile (7, 9a and 22 most).
3. Add a **room table**: id, name, an anchor and a box (tiles are a flood fill from the anchor inside the box, stopping at doors), light, ambient sound and script id. Two-digit room numbers don't fit a one-character grid, so anchors live in the table, not in the map.
4. Add **links**: the 9↔18 tunnel, the 15 stairs and the surface exits.
5. Add a **prop list**: tables, bunks, coffins, urns, chests, pole and chain, statues, curtains, barrels and rocks.
6. Validate the result with a test. Every room must be reachable, at least two routes must lead to room 23, and every key must be on the reachable side of its locks.

Hand-authored, not procedural, because the whole point is the book's dungeon. The trace keeps proportions honest, and curation fixes doors and secrets.

### 7.4 Rendering: what changes from the chopper
| Area | Chopper | Kollchap |
|---|---|---|
| Key light | Moon directional and a cached shadow map | **Point lights only**: party torches and the lantern, the fixed lights in §3.5 (braziers, the lamp, candles, the sconce, the healing pool glow) and sun shafts |
| Shadows | 2048 shadow map | **Grid-raymarched shadows.** Walls sit on tiles, so each fragment DDA-steps through a wall-occupancy texture toward each nearby light. That gives exact, crisp wall shadows for every light at once, cheaply. Add a **single cube shadow map for the selected character's torch**, so figures cast moving shadows. It can be switched off on iPad. Units get blob or contact shadows |
| Light binning | 32 lights, per-tile bitmask | Same system, 64 lights in two 32-bit words per tile. The torch **flickers** (out-of-step sines on intensity and position) and the flame bends toward undiscovered secret doors |
| Occlusion | Rooftops seen from above | **Cutaway walls:** walls between the camera and the focus drop to knee height and rise back to full height across a ring, so the cut has a terraced edge. (A dithered edge was tried first, but the walls are hollow boxes, so dithering one away shows its empty inside.) This works at any yaw, because the chopper's camera rotates 360° |
| Materials | Asphalt, brick and wet streets | Procedural first, textures add detail on top: hewn rock walls (running-bond blocks, each face cut slightly off true), Voronoi flagstones, cave rock (noise), oak doors with iron bands, the green circle and white corner inlays in room 12, frescoes in rooms 10 and 22, **water** (room 23: animated normals, sun glints, caustics on the walls) |
| Atmosphere | Rain and bloom | Dust motes in torchlight (fixed to the world, lit by the torch), **god rays** (an additive open tube with a noise-scrolled dust volume) in room 23 and the entrance, bloom on fire and spells, a cool blue grade in the dark and warm in the light, vignette and slight grain |
| Fog of war | Visible / explored / AO texture | Same texture, but "visible" = LOS ∧ lit. Explored areas are drawn as a dim, desaturated memory |
| Extras | — | **3D dice** overlay (an instanced icosahedron and cube, tumbled to the predetermined face) |

**Performance budget (iPad):**
- Whole dungeon: 630 walkable tiles. The M0 grey-box scene is about 2,000 box instances plus about 120 cylinders and spheres, in three instanced draws.
- Shadow raymarch capped at 16 DDA steps per light, enough for the widest light (7.5 tiles). A pixel typically sees 1–3 lights.
- Adaptive render scale as in the chopper (step down below about 40 fps).
- 4× MSAA on desktop, and optional on iPad.

### 7.5 Camera and input
- **Camera:** the chopper's orbit camera, with pitch about 55°, 360° twist or Q/E, and pinch or wheel zoom.
  - Default zoom is closer: rooms are small and the miniatures should read.
  - It auto-frames the active character and the denizen that is acting.
- **iPad:** tap a tile to preview the path, then tap again to go.
  - Tap an enemy to open the attack panel, then tap **Attack**.
  - **Long-press** inspects a tile, monster or object.
  - Drag pans, pinch zooms, and twist rotates.
- **Desktop:**
  - **Hover** previews the path and the roll odds, and click confirms.
  - Right-click cancels, and the wheel zooms.
  - WASD pans, Q/E rotate, Tab cycles characters and Space ends the phase.
  - Number keys 1–9 pick actions.
- **Marching order:** a 2×2 formation widget on the HUD (drag portraits to reorder). Corridors collapse it to single file automatically.

### 7.6 HUD (same DOM-overlay technique as the chopper; a parchment, brass and iron palette)
- **Party cards** (left column):
  - AI portrait, HP bar, AC, memorised-spell pips, torch icon, and status chips (asleep, paralysed, held, poisoned, slimed with a countdown, downed with a countdown)
- **Top bar:** dungeon turn clock, a burn meter for each lit torch or the lantern, the total torches and oil left, objective text, mute, settings and help.
- **Initiative bar** (encounter mode): the side order and the active unit.
- **Action bar** (bottom): context actions with counts, such as spells left and torches.
- **Roll panel:**
  - Shows the target, the needed d20 roll, every modifier line, and the odds.
  - After rolling, the 3D die result stays on screen with the breakdown.
- **Adventure log** (collapsible): a scroll of rolls and narration, for players who want the numbers.
- **Automap:**
  - Parchment, drawn in the book's style (hatched rock edges, room numbers once a room is visited, an "S" once a secret door is found).
  - Tap it to centre the camera. The map from room 9 or the corpse in room 20 reveals sections of it.
- **Dialogue panel:** portrait, voiced line, response buttons, and a free-text field for the oracle.
- **World-anchored DOM** (as in the chopper): HP bars over hurt units, floating damage numbers, and "Zzz" or "!" or "?" alert icons.
- **Screens:**
  - Title/attract, intro story narration with the entrance cross-section art, how-to-play
  - Settings (difficulty, show dice, party-first initiative, voice volume, reduce motion)
  - Pause, and end/tally

### 7.7 Save and load
Unlike the chopper, a full crawl is long (1–2 hours), so:
- The game **autosaves** to `localStorage` when the party enters a room and at the end of each encounter round. The save is versioned JSON: map state, units, inventory, clock, RNG state and room-script flags.
- **Continue** appears on the title screen. There is one autosave slot and 3 manual slots.
- The seeded RNG makes saves resume deterministically, which also helps reproduce bugs.

---

## 8. AI services

Three services, each with its own job:

| Service | Job | When |
|---|---|---|
| **Gemini** (`gemini-3.1-flash-image`) | **Main image source:** seamless textures, character portraits, bestiary cards | Build time |
| **Cloudflare Workers AI** | **Runtime text:** the statue oracle only, through a Worker (§8.2–8.3). **Comparison images (optional, later):** the same prompts run against Cloudflare models if any Gemini results disappoint (§8.4) | Runtime, and optionally build time |
| **ElevenLabs** | **All voice and sound:** narration, character and NPC voices, SFX, music. Dynamic statue answers are voiced through the Worker | Build time and runtime |

**Keys** live in a gitignored `.env` in this project and are never shipped to the browser. Runtime keys are stored as Worker secrets.
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token with the Workers AI permission)
- `ELEVENLABS_API_KEY` or `ELEVEN_LABS_API_KEY`

### 8.1 ElevenLabs: build-time voices, narration, SFX and music
This copies the chopper's pipeline: `tools/audio-manifest.mjs` → `tools/generate-audio.mjs` → `assets/audio/*.mp3` + `manifest.json`.
- The pipeline is idempotent, uses parallel workers, and backs off on 429 errors.
- The key is read from `.env` and is never shipped.
- The `eleven-api` skill (sound effects) is available when writing prompts.

**Voices**
| Voice | Character | Use |
|---|---|---|
| Narrator | A warm, gravelly British storyteller (the DM) | Intro (~45 s), first entry to each room (~30 lines, paraphrasing the book), traps, the sword sting, the endings |
| Brannoc / Ysolde / Aldwin / Fennick | Distinct party voices | Events as in the chopper: select, move, attack, kill, hurt, cast, wounded, downed, find secret, trap, treasure, door, low torch |
| Belisarius | Nervous and wheedling | Recruitment, reluctance, his reunion with Rosa |
| Rosa Dobbit | Plucky halfling | Rescue, gratitude, combat barks, reaction to the frescoes |
| Odric | Silken and sinister | Sacrifice speech, orders to the skeletons, taunts as he flees |
| Arch-deaconess | Cold and imperious | Interrogation and bargaining branches |
| Kithar | Proud underpriest | Surrender or defiance |
| Merchant | Fussy and grateful | Escort lines and the reward |
| Statue oracle | A deep stone voice | The opening rhyme (pre-generated) and dynamic answers (§8.3) |

**SFX (about 55 prompts)**
- Ambient loops: dungeon drips, the entrance wind, rushing water (room 23), torch crackle, sword hum, healing pool bubbling, room 12 brazier roar
- Doors: open, creak, stuck thud, forced crash, secret grind, the sliding block slam (room 21)
- Falls: pit fall, splash
- Combat: sword swing, hit, miss and clang on plate, shield block, mace thud, sling and bow, dagger throw
- Spells: Magic Missile, Sleep shimmer, Light bloom, Cure, the Turn Undead holy chime
- Monsters: skeleton rattle and collapse, zombie groan, ghoul hiss, rat squeaks, goblin chatter, orc grunt, bugbear roar, gecko hiss, locust chitter and spit, slime squelch, rockman grind, centipede skitter, bat swarm
- Treasure: lock picking, trap needle click, coins, gems, urn smash, potion drink
- **Dice tumbling on a wooden table**, an encounter gong, the turn chime, and victory and defeat stings
- **Music:** if the account has Eleven Music, generate exploration, tension, combat and boss loops. Otherwise, build drones from SFX loops.

**Runtime audio** (extending the chopper's `audio.js`):
- A **dungeon convolution reverb**, using a generated impulse whose size depends on the room (large for 12, tight for corridors, a wet slap for 23). The narrator stays dry.
- The oracle voice goes through pitch-down, stone reverb and a slight chorus.
- Positional sound and the voice busy-gate work as in the chopper.

### 8.2 Cloudflare: Worker proxy and Workers AI (runtime)
The chopper makes no runtime API calls. Here, only the statue oracle earns one:
- A **Worker** holds the secrets, exposes small JSON endpoints, applies per-session rate limits, checks the request origin, caps tokens, and caches responses in KV by request hash.
- **Model:** a fast instruct model from the Workers AI catalog, pinned in the Worker config. Current examples are `@cf/zai-org/glm-4.7-flash` and `@cf/google/gemma-4-26b-a4b-it`; check the catalog when building, because models are deprecated regularly.
- **Text-to-speech for dynamic lines:** proxy ElevenLabs' low-latency TTS through the same Worker and cache it by text hash. I found no TTS in Cloudflare's own catalog.
- **The oracle has an offline fallback,** so the game is fully playable with no network or API.
- **Hosting is not decided yet** (§12). The Worker code is written to run as a standalone Worker or as Pages Functions, so either choice works. During development it runs locally with `wrangler dev`.

### 8.3 Runtime AI: the statue oracle only
1. **The Statue Oracle (room 21).**
   - The book's mechanic is free-text questions: three "How…" questions of 12 words or fewer, with one random answer false.
   - The player types a question, or picks from suggestions, which is easier on iPad.
   - The Worker receives the question plus a **ground-truth fact sheet**: where the sword is, how to open the secret doors, who holds the keys, the traps, and the flags for what the party has already seen.
   - It also receives a `truthful: bool` flag, decided at the start of the mission.
   - The prompt makes the statue answer in a short rhyming couplet, true or false according to the flag, and only from the fact sheet. The Worker enforces length and refuses questions over 12 words with the book's "confusing nonsense" response.
   - The answer is voiced with dynamic TTS through the oracle effects chain, and the statue's eyes glow while the request is in flight.
   - Fallback: keyword-matched canned couplets.
**Not AI, by decision (§12):** there are no AI hints and no AI narration or combat lines. All narration is pre-written and pre-voiced (§8.1). NPC dialogue for Belisarius, the Arch-deaconess, the priests, Rosa and the merchant uses **scripted dialogue trees** with pre-generated voices. They are quest-critical, so they need to be deterministic, testable and fully voiced. Denizen tactics are ordinary game AI (§9), not an LLM.

### 8.4 Images (build time): Gemini first, Cloudflare to compare later
**Gemini is the starting image source** (§12). Every asset is first generated with Gemini only. The Cloudflare comparison is an optional later step: for any asset where Gemini disappoints, or as a full comparison once the game is playable. The tools are built with a `--provider` switch from the start, so adding Cloudflare later needs no rework.

**What gets generated**
- **Textures (about 25):** hewn rock wall, flagstones, cave rock, rubble, oak planks, iron bands, straw, bone litter, moss, the green and white inlay (room 12), two fresco panels (rooms 10 and 22), and water normals.
  - They are **surface detail only** (stone grain, chisel marks, wood grain, rust), with no joints or edges of their own. The shader lays out the blocks, flagstones and planks and multiplies the texture on top, so a texture can never misalign with the layout and repetition is hard to spot. The frescoes are the exception: they are pictures, placed as panels.
  - Done in M1: stone, flag, cave, oak, wood, iron, greenstone and marble, for $0.55. Water stays procedural.
- **Portraits (about 12):** the 4 heroes, the 2 recruits and about 6 NPCs.
- **Bestiary cards:** one per monster type. Everything is drawn in one painted fantasy-illustration style.

**Providers**
| Provider | Model | Role | Seam repair |
|---|---|---|---|
| **Gemini** | `gemini-3.1-flash-image` | Main source, using the chopper's proven pipeline | AI: shift the image by half and ask Gemini to repaint the seam |
| Cloudflare | `@cf/leonardo/lucid-origin` | Main comparison. Up to 2500 px, has seed and guidance settings, about $0.03 per 1024 px image | Without AI: crop to whole repeats, then blend the seam after the half shift |
| Cloudflare | `@cf/leonardo/phoenix-1.0` | Second comparison. Its negative prompt helps rule out "perspective, objects, lighting" | Same as Lucid Origin |
| Cloudflare | `@cf/black-forest-labs/flux-2-klein-9b` / `flux-2-dev` | Try once their input fields are confirmed. They are described as supporting editing and reference images, which could mean AI seam repair and a style reference | AI, if editing works |
| Cloudflare (fallback) | `@cf/runwayml/stable-diffusion-v1-5-inpainting` | Seam repair only, if the blend isn't good enough for patterned textures (planks, frescoes) | AI inpainting. Beta, and the mask is sent as a raw number array |

Cloudflare calls use the Workers AI REST endpoint, `POST https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/run/{model}` with a Bearer token, so no Worker is needed at build time.

**Tooling**
- **One manifest for both providers.** `tools/texture-manifest.json` keeps the chopper's format: a shared style description plus a prompt and tile, crop and fix flags per texture. Two fields are added:
  - `size`
  - `pick`: which provider's result ships
- **`tools/generate-textures.py --provider gemini|cf-lucid|cf-phoenix|cf-flux2`**
  - Writes raw output to `.texture-cache/<provider>/` (gitignored).
  - Runs the same seamless processing on every result.
  - Records the cost per provider in the ledger, with a shared `--cap`.
  - Seeds are fixed, so a re-run reproduces a candidate.
- **`tools/generate-portraits.mjs --provider …`** works the same way for portraits and bestiary cards.

**How we compare**
- **`tools/compare.html`:** a local page showing each asset from each provider side by side. Textures are shown tiled 3×3, so seams and visible repetition stand out.
- **A switch in the game:** the URL parameter `?tex=<provider>` loads that provider's texture set, so candidates can be judged under real torchlight on the rock geometry.
- **Picking:** set `pick` per asset in the manifest. `--promote` then copies the winners into `assets/textures/` and `assets/portraits/`. Mixing providers is fine, because the shader uses textures as detail maps and the base colours set the overall tone.

**Cost**
- The chopper's 15 Gemini textures cost about $1.43, including retries.
- The full Kollchap set should come to a few dollars per provider. The default cap is $5 per provider per run.
- Gemini images carry Google's invisible SynthID watermark. The README should say so, as the chopper's does.

---

## 9. Denizen AI

The structure follows the chopper's `ai.js`: a state machine per unit, with group sharing of last-known positions and utility scoring for where to stand.
- **States:**
  - Guard or idle (posted)
  - Patrol (wanderers, or the goblin loop)
  - Investigate (noise or light seen)
  - Combat
  - Flee (to a scripted retreat)
  - Surrender (priests)
  - Scripted (room set-pieces)
- **Combat tile scoring:**
  - Prefer doorways and corridor mouths, where a single enemy front is good for them.
  - Favour flanking the party's soft back rank when there is a route around (the corridor loops make this real: 18/19, the rear corridor).
  - Avoid the fighter's zone of control.
  - Infravision users stay out of torchlight and in the dark.
- **Casters:** the Arch-deaconess opens with Hold Person on the biggest threat. Kithar heals the ally most hurt, and Odric uses commands and runs.
- **Undead:** mindless. They advance and attack the nearest target, and ignore morale. Turned undead flee for 2d6 rounds.
- **Creatures:**
  - Rats swarm the weakest target
  - The gecko stays in the circle until unchained
  - The slime waits on the wall
  - Locusts hop away and spit
  - Bats are a hazard field, not units
- **Morale and surrender** follow §3.4 and the room scripts. Surrendered units can be bound, which takes 1 turn, or let go.

---

## 10. Milestones (each ends playable)

| # | Milestone | Done when |
|---|---|---|
| **M0** | **Scaffold and map**: copy the chopper core (util, input, camera, renderer skeleton), `trace-map.py`, curated `dungeon-data.js`, map validation tests | The dungeon renders as grey boxes. You can orbit it, and the pathfinding overlay works. **Done 2026-10-18** |
| **M1** | **The look**: rock and floor geometry, **Gemini textures** (§8.4), torch point lights with flicker, grid shadows, fog of war and memory, cutaway walls, bloom | Walking one torch-bearer through the dark looks good on desktop and iPad at 40+ fps. **Torchlight, fixed lights, wall shadows, fog of war, cutaway walls, materials, atmosphere and the first 8 Gemini textures ($0.55) done 2026-10-18; the iPad pass still to do** |
| **M2** | **Party and exploration**: 4 hero miniatures with procedural animation, group and solo movement, marching order, doors, secret doors and search (with the torch-lean hint), the dungeon clock, torches, automap | The whole dungeon can be explored with no combat |
| **M3** | **Combat core**: encounter switch, surprise, initiative, move and act, attacks with the roll panel and 3D dice, damage, morale, downed state. Monsters for the first area: hobgoblins, bats, orcs, rats. Basic AI | The surface tutorial, the entrance and rooms 1–2 play end to end |
| **M4** | **Magic and skills**: the spells in §4, Turn Undead, thief skills, traps, saves, status effects, scrolls and potions | Rooms 3–6, 18 and 19 play, including the slime, the pits and the goblin loop |
| **M5** | **Full content**: Gemini portraits and bestiary cards, every room script, every monster model, Belisarius, Rosa, prisoners, keys and chests, the Arch-deaconess branch, the Odric set-piece, the sword and its hum, escape, re-alerting, endings and the tally | A complete crawl from surface to sword and back out |
| **M6** | **Audio**: manifest, generation, narration, VO, SFX, music, reverb | Fully voiced, with a soundscape per room |
| **M7** | **Statue oracle**: Worker (running locally until hosting is decided), oracle prompt and fact sheet, TTS proxy, caching, rate limits, offline fallback | The statue answers in rhyme with a voice, and the game still works with the network off |
| **M8** | **Polish and ship**: save and load, settings, difficulties, tutorial prompts, iPad performance pass, accessibility (reduce motion, text size), README with screenshots, deploy | Deployed over HTTPS and played through on an iPad |
| M9 | *(Optional)* **Model upgrade**: `build-models.py`, skinned WGSL path, CC0 heroes and humanoids (Option B), GLB props | The heroes use skinned models, and the creatures stay procedural |
| M10 | *(Optional)* **Cloudflare image comparison**: run `--provider cf-lucid` / `cf-phoenix` (and FLUX.2 once its fields are confirmed), compare with `tools/compare.html` and `?tex=`, then promote any winners | Every shipped image is a deliberate pick |

---

## 11. Risks and mitigations
- **Ambiguous or OCR-garbled source text.** The coin counts in room 1 and Kithar's stats are examples. *Mitigation:* the data lives in `defs.js` with a comment where we chose a reading, and checking against a physical copy of the book is worthwhile.
- **Map ambiguities** (secret-door placement, which wall each door is on). *Mitigation:* the trace plus curation, and validation tests that guarantee two routes to room 23.
- **B/X lethality.** A single orc can kill a 1st-level magic-user. *Mitigation:* difficulty tiers, the downed state, and a roll panel that makes risk visible before you commit.
- **iPad GPU cost** of per-pixel shadow raymarching. *Mitigation:* light and step caps, adaptive resolution, the cube shadow can be switched off, and unexplored pixels skip shading.
- **WebGPU availability.** iPad needs Safari on iPadOS 26 or later, and it needs HTTPS. The game shows a clear "no WebGPU" screen otherwise, as the chopper does.
- **LLM latency and drift** in the oracle. *Mitigation:* fact-sheet grounding, a short output cap, the animation while waiting, caching, and canned fallbacks.
- **Cloudflare image models change, and some are poorly documented.** The FLUX.2 input fields aren't on Cloudflare's model pages, and the Stable Diffusion models are beta. *Mitigation:* Gemini is the main source, so the game never depends on a Cloudflare image. Model ids are pinned in the manifest, and FLUX.2 is checked with a test request before it is relied on.
- **Copyright.** The book's text and map are © 1982. That is fine for a personal project. For public release, keep room descriptions paraphrased (as planned for narration) and replace the scanned map with our own automap art.

---

## 12. Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Turn model | **Decided:** free movement while exploring, with the dungeon clock ticking, and turn-based rounds in encounters (§3.2) |
| 2 | Character models | **Decided:** procedural miniatures for everything first, then an optional CC0 rigged upgrade for the heroes at M9 (§2) |
| 3 | Default lethality | **Decided:** Normal is the default: party level 2, maximum HP at 1st level, and a 3-round downed state before death (§3.8) |
| 4 | Hosting | **Open.** Decide before M7, the first milestone that needs a deployed Worker. The options are Cloudflare Pages + Functions, or GitHub Pages like the chopper plus a separate Worker. Until then, the oracle runs locally (`wrangler dev`) or on its offline fallback |
| 5 | Runtime AI scope | **Decided:** the statue oracle only (§8.3). No AI hints, no AI narration, no free-form NPC talk |
| 6 | Party names | **Decided:** keep the placeholders: Brannoc, Ysolde, Aldwin, Fennick (§4) |
| 7 | Image source | **Decided:** Gemini first. Cloudflare image comparison is an optional later step (§8.4). ElevenLabs does all voice and sound |

---

## Appendix A: Denizens (from the scenario)

| Where | Creature | AC | HP | MV | Attacks / damage | Save | ML | Align | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Surface | Hobgoblin ×2 | 6 | 2, 6 | 90' | 1 / 1d8 | F1 | 8 | C | Infravision |
| Tunnel | Normal bat ×11 | 6 | 1 each | 120' | Confusion | NM | 6 | N | −2 to hit, no casting |
| 1 | Orc ×4 | 6 | 3, 2, 3, 8 | 120' | 1 / 1d6 | F1 | 8 | C | Coins garbled in the source: "2, 11, 7, 9 ep" |
| 2 | Giant rat ×5 | 7 | 4, 3, 1, 3, 2 | 120' | bite 1d3 + disease | F1 | 8 | N | |
| 4 | Green slime | always hit | 4 | 3' | corrosion | F1 | 12 | N | Only fire or cold harm it |
| 5 | Belisarius (T1) | 7 | 2 | 90' | 1 / 1d8 | T1 | 6 | N | ST 9 IN 11 WI 12 DX 15 CO 9 CH 11 |
| 8 | Ghoul | 6 | 10 | 90' | 2 claws, 1 bite / 1d3 each + paralysis | F2 | 9 | C | Fights to the death |
| 9 | Arch-deaconess of Tranfax (C4) | 2 | 14 | 30' | mace 1d6 | C4 | 10 | C | Light, Protection from Evil, Hold Person. ST 11 IN 12 WI 15 DX 10 CO 7 CH 10 |
| 9a | Rockman ×2 | 5 | 5, 8 | 90' | 2 / 1d4, 1d4 + petrify | F1 | 12 | C | Loaned by Khan |
| 10 | Kithar (C2), Kerzen, Ojar (C1) | 2 | 10, 5, 3 (assignment inferred) | 30' | mace 1d6 | C2/C1 | 7 | C | Kithar: Cure Light Wounds |
| 11 | Bugbear | 5 | 11 | 90' | 1 / 2d4 | F3 | 9 | C | 76 sp |
| 12 | Skeleton ×3 | 7 | 6, 2, 8 | 60' | scimitar 1d8 | F1 | 12 | C | |
| 12 | Gecko | 5 | 14 | 120' | bite 1d8 | F2 | 7 | N | Chained to the pole |
| 12 | Odric (C3) | 3 | 9 | 30' | mace 1d6 | C3 | 10 | C | Keys to 13 and 14, 30 gp |
| 12 | Rosa Dobbit (halfling F1) | 9 | 4 | 120' | 1 / 1d6 | F1 | 8 | L | Captive. Recruit |
| 13 | Zombie ×2 | 8 | 6, 5 | 120' | 1 / 1d8 | F1 | 12 | C | |
| 14 | Giant centipede | 9 | 2 | 60' | bite / poison | NM | 7 | N | Between the chests |
| 19 | Goblin ×4 | 6 | 4, 3, 6, 4 | 60' | 1 / 1d6 | NM | 7 | C | Flee loop through 18 |
| 20 | Cave locust ×2 | 4 | 9, 3 | 60' | bite 1d2 / bump 1d4 / spit | F2 | 5 | N | Camouflaged |
| 23 | Lizardman | 5 | 1 | 60' | sword, weapon + 1 | F2 | 12 | N | Guards the sword |

## Appendix B: Treasure summary
Room 1: coins on the orcs. Room 2: 216 sp. Room 8: vestments worth 100 gp (heavy). Room 10: silver hemisphere, 100 gp. Room 11: 6 pearls at 60 gp each, and 76 sp on the bugbear. Room 12: 30 gp and the keys. Room 13: merchant's reward, 50 gp. Room 14: 3,000 sp (false bottom), statuette 300 gp, 1,000 gp, 2 gems at 150 gp each, 3 scrolls. Room 19: 23 gp, 570 sp, 3,004 cp, plus pouches (6 sp, 7 sp, 2 ep, 3 sp). Room 23: 5 cp and **the Sword of the Sorcerer (+2, hums near Chaos)**.
