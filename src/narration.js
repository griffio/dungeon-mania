// The Dungeon Master's narration (PLAN.md 8.1): the intro, a line on first entering each room
// (paraphrasing the book, never quoting it), the great moments, and the endings. Shown in the log
// and read aloud by the narrator. tools/audio-manifest.mjs voices every line here.

export const INTRO = 'Kollchap was a quiet village once. Then the shrine in the hills woke up. Villagers have gone missing, a halfling family among them, and the priests of a forgotten goddess walk the woods by night. Somewhere beneath the ruined temple lies the Sword of the Sorcerer, a blade that sings when evil is near. Four adventurers have come to take it back. The sun is going down.';

// First entry to a room: by room id (the surface's ruins are 'temple').
export const ROOMS = {
  temple: 'The ruined temple stands open to the evening sky. At the far end of the nave, a ragged hole in the floor; beside it, two hobgoblins warm their hands at a fire.',
  entrance: 'The tunnel spills you into a corridor of dressed stone, running west into the dark. Water drips somewhere. Behind you, a grey smudge of daylight.',
  1: 'A guardroom. Bunks, a table scarred with knife marks, and the sour stink of orc.',
  2: 'A dump. Broken crates, bones and rotten sacking are heaped waist deep, and something in the heap is moving.',
  3: 'Beyond the door there is no floor at all. The room has fallen away into a pit ten feet deep, with a narrow ledge before the far door.',
  4: 'A long passage runs north, its west wall glistening wet in the torchlight.',
  5: 'A storeroom, stacked with packing cases. It smells of mice, and of something that is not mice.',
  '5a': 'Behind the sliding panel, a cramped hole in the rock, and in it, a man.',
  6: 'A small chamber lit by a soft green glow. In the floor, a pool of clear water bubbles gently.',
  7: 'Coffins. Fifteen of them, plain pine, stacked against the walls. Waiting.',
  8: 'A bedchamber, richly hung, with a wide bed and a wardrobe of dark wood. In the corner something crouches, and it is not furniture.',
  9: 'An office, lit by an oil lamp on a table heaped with papers.',
  '9a': 'Half the ceiling lies on the floor here, and something is sifting through the rubble.',
  10: 'Candlelight, and murmured prayer. Three priests in green and white kneel before a small altar.',
  11: 'Six tall urns stand along the wall of this little chamber. Between you and them stands something big, and hairy.',
  12: 'A vast chamber, shaped like a diamond, lit green by two braziers. A great green circle is set into the floor, a pole at its heart, and at the pole, someone is tied.',
  13: 'A row of cells, barred and gated, and the air is foul. Things shuffle between the cells. They are not guards.',
  14: 'The treasure chamber. Four chests stand against the wall, and between them something long and many legged stirs.',
  15: 'A changing room: hooks, a chest of robes, and a narrow stair climbing into the dark beside a single sconce.',
  16: 'An old waiting room. A bench, a table, a scatter of junk. Nothing here has moved in years.',
  17: 'A statue seven feet tall holds out an alms dish, and on its rim is carved one word: offerings. Red curtains hang behind it.',
  19: 'A goblin den. Straw, bones, a battered chest, and the goblins themselves.',
  20: 'The dressed stone gives way to a natural cave, rough and damp. Near the entrance lies a body in plate mail, long dead.',
  21: 'A bare room, and in it a statue: a seated figure, eyes closed. Behind you, the stone block begins to grind.',
  22: 'A meditation room, its walls painted from floor to ceiling.',
  23: 'Wet stairs lead down into a flooded storeroom. A shaft of sunlight falls through a crack far above, and in it, on a rock, sits a lizardman.',
};

// The great moments.
export const MOMENTS = {
  sword: 'The Sword of the Sorcerer. It wakes in your hand with a low, angry hum. Now all you have to do is get out alive.',
  rite: 'At the green circle, the high priest raises his knife.',
  trapped: 'The block slides home. There is no handle on this side.',
};

// The endings, by the tally's title key.
export const ENDINGS = {
  dead: 'The party has fallen. Kollchap keeps its sword, and the goddess her offerings. Perhaps another band will come.',
  empty: 'The party limps home with its scars and what silver it could carry. The sword still lies in the dark below the shrine.',
  broken: 'The sword is recovered, the high priest is dead, and every prisoner walks home. The village rings its bell all night, and the shrine will be pulled down, stone by stone.',
  escaped: 'The sword is recovered. But somewhere in the hills the high priest is still alive, and he will not forget who robbed his goddess.',
  sword: 'The Sword of the Sorcerer is carried home in triumph, and Kollchap sleeps a little easier tonight.',
};
