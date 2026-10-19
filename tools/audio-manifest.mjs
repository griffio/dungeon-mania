// Every sound in the game (PLAN.md 8.1). generate-audio.mjs turns this into assets/audio/*.mp3
// and writes assets/audio/manifest.json, which the game loads at runtime.
//   NARRATION   the narrator: intro, room entries, moments, endings (src/narration.js)
//   BARKS       the party's voices: vo_<who>_<event>_<n>
//   LINES       what Kollchap's people say, word for word as in the scripts: say_<hash>
//   SFX         [id, prompt, seconds, loop, prompt influence]
// The account has no music generation, so the music beds are looping drones from the sound
// effects model (PLAN.md 8.1's fallback).
import * as N from '../src/narration.js';
import { lineId } from '../src/voice.js';

// ElevenLabs premade voices.
export const VOICES = {
  narrator: 'JBFqnCBsd6RMkjVDRZzb',  // George: warm, captivating British storyteller
  brannoc: 'SOYHLrjzK2X1ezoPC6cr',   // Harry: fierce warrior
  ysolde: 'Xb7hH8MSUJpSbSDYk0k2',    // Alice: clear, British
  aldwin: 'pqHfZKP75CvOlQylNhV4',    // Bill: wise, mature
  fennick: 'N2lVS1w4EtoT3dr4eOWO',   // Callum: husky trickster
  belisarius: 'TX3LPaxmHKxFdv7VOQHJ', // Liam: quick and jittery, pushed nervous by the text
  rosa: 'cgSgspJ2msm6clMCkdW9',      // Jessica: bright, plucky
  odric: 'cjVigY5qzO86Huf0OWal',     // Eric: smooth (silken, sinister)
  archdeaconess: 'pFZP5JQG7iQjIQuC4Bku', // Lily: velvety, commanding
  kithar: 'pNInz6obpgDQGcFmaJgB',    // Adam: dominant, firm
  merchant: 'iP95p4xoKVk53GoZ742B',  // Chris: down to earth (fussy, by the text)
  lizardman: 'CwhRBWXzGAHq8TQ4Fs17', // Roger: pitched down and hissed at runtime
  oracle: 'nPczCjzI2devNBz1zQrb',    // Brian: deep and resonant, through the stone chain
};
// How each voice is delivered: stability (lower is more expressive), style.
export const DELIVERY = {
  narrator: { stability: 0.55, style: 0.35 }, oracle: { stability: 0.7, style: 0.2 },
  belisarius: { stability: 0.3, style: 0.6 }, odric: { stability: 0.45, style: 0.55 },
};

export const NARRATION = [
  ['nar_intro', N.INTRO],
  ...Object.entries(N.ROOMS).map(([id, text]) => [`nar_room_${id}`, text]),
  ...Object.entries(N.MOMENTS).map(([id, text]) => [`nar_${id}`, text]),
  ...Object.entries(N.ENDINGS).map(([id, text]) => [`nar_end_${id}`, text]),
];

// The party's barks, by event (PLAN.md 8.1). Played now and then, never over each other.
export const BARKS = {
  brannoc: {
    select: ['Ready.', 'Brannoc. Point me at it.'], move: ['With me.', 'Stay close.'],
    attack: ['Have at you!', 'For Kollchap!'], kill: ['Down you go.', 'One less.'],
    hurt: ['Is that all?', 'Argh! Still standing.'], downed: ["I'm down... get them!", "Can't... stand..."],
    spotted: ['Weapons out!', 'Contact, ahead!'], secret: ['A door, in the wall!'], trap: ['Careful! Trap!'],
    treasure: ['Now that is worth carrying.'], lowtorch: ['My torch is guttering.'],
  },
  ysolde: {
    select: ['Yes?', 'Ysolde. I have my spells.'], move: ['Coming.', 'Lead on.'],
    attack: ['Take that!', 'Stay back!'], kill: ['It is finished.', 'Got it!'],
    hurt: ['Ow! That hurt!', 'Keep them off me!'], downed: ["I'm hurt... badly...", 'Help me...'],
    cast: ['Words of power!', 'By the old names!'], spotted: ['Something moves!', 'They are here!'],
    secret: ['There, in the stone. A seam.'], trap: ['Wait. Something is wrong with the floor.'],
    treasure: ['Oh, that is lovely.'], lowtorch: ['The light is failing.'],
  },
  aldwin: {
    select: ['I am here.', 'Aldwin. Bless you.'], move: ['As you say.', 'Onward, then.'],
    attack: ['In the name of the light!', 'Begone!'], kill: ['Rest, now.', 'May you find peace.'],
    hurt: ['Mercy!', 'The light protects me.'], downed: ['Pray for me...', 'I cannot... rise...'],
    cast: ['Hear me, and heal.', 'By the light, be warded.'], turn: ['Back, unclean things! Back!'],
    spotted: ['Evil ahead.', 'Be on your guard.'], secret: ['A hidden way.'], trap: ['Mind your step, friends.'],
    treasure: ['A fair reward.'], lowtorch: ['We need more light.'],
  },
  fennick: {
    select: ['Fennick.', 'Need something done quietly?'], move: ['Right behind you.', 'Quiet, now.'],
    attack: ['Surprise!', 'Gotcha.'], kill: ["He won't be missed.", 'Sweet dreams.'],
    hurt: ['Ow! Watch it!', 'Not the face!'], downed: ["I'm... done for...", 'Someone... help...'],
    spotted: ['Company.', 'Look sharp.'], secret: ['Well, well. A hidden door.'], trap: ['Hold it. Trapped.'],
    treasure: ['Mine. I mean, ours.'], lowtorch: ['Torch is nearly out.'],
  },
  belisarius: {
    select: ['Do I have to?', 'Belisarius. At the back.'], attack: ['Get away from me!'], kill: ['Did I do that?'],
    hurt: ['Ah! I knew it!'], downed: ["I knew I shouldn't have come..."], spotted: ['Oh no. Oh no no no.'],
  },
  rosa: {
    select: ['Rosa Dobbit, ready!', "Let's go!"], attack: ['This is for my aunt!', 'Take that!'], kill: ['And stay down!'],
    hurt: ['Ow! Cheeky!'], downed: ["Don't... leave me..."], spotted: ['Priests! Let me at them!'],
  },
};
export const BARK_IDS = Object.entries(BARKS).flatMap(([who, ev]) => Object.entries(ev).flatMap(([e, lines]) => lines.map((t, k) => [`vo_${who}_${e}_${k + 1}`, who, t])));

// What the people of Kollchap say: [speaker, the quoted words, exactly as in the scripts].
// test/audio.test.js checks every one still appears in the source.
export const SPOKEN = [
  ['belisarius', 'Food... please, have you any food? Three days I\'ve hidden in here.'],
  ['belisarius', 'You came back! Have you any food?'],
  ['belisarius', 'Bless you. Belisarius, thief, at your service. I came for the shrine\'s silver, same as you, I\'d guess.'],
  ['belisarius', 'Orcs in the guardroom by the way in. They watch the corridor through a door in the wall: you\'d never see it. Make noise out there and they come out behind you.'],
  ['belisarius', 'The high priest, Odric, keeps the keys on his belt: cells, treasure room, all of it. He\'s in the great chamber with the green circle. Don\'t go in there.'],
  ['belisarius', 'There were four of us. Hamar went south, into the caves, looking for another way out. He never came back. And Rosa, our halfling... they took her. For the circle.'],
  ['belisarius', 'On an empty stomach? I couldn\'t walk ten feet.'],
  ['belisarius', 'Better than starving in a cupboard. But I don\'t go in front. Ever.'],
  ['belisarius', 'Their door is there, look, by the end of the corridor.'],
  ['belisarius', 'Hamar. You fool. You found the way, and it found you.'],
  ['belisarius', 'I was... guarding the rear.'],
  ['belisarius', 'Not in front'],
  ['belisarius', 'I\'ll watch the back.'],
  ['belisarius', 'I did'],
  ['belisarius', 'I\'m good at it.'],
  ['archdeaconess', 'You are not Odric\'s. Good. I am the Arch-deaconess of Tranfax. Odric\'s people stole a statue from my temple: a seated figure, so high, that speaks. Where is it?'],
  ['archdeaconess', 'Well? Have you found it?'],
  ['archdeaconess', 'Behind a stone that shuts? Then you will take me to it. Now.'],
  ['archdeaconess', 'Then you are of no use to me.'],
  ['archdeaconess', 'Then bring me word of it, and I will make it worth your while. Go.'],
  ['archdeaconess', 'You lie badly.'],
  ['archdeaconess', 'Gold is gold.'],
  ['archdeaconess', 'Now leave me to my work.'],
  ['archdeaconess', 'Then go. And do not come back empty-handed.'],
  ['archdeaconess', 'Lead on. My rockmen will wait.'],
  ['archdeaconess', 'To me!'],
  ['archdeaconess', 'I will find it myself'],
  ['kithar', 'Enough! Enough, we yield!'],
  ['kithar', 'Odric? High priest of our order. He is at the green circle tonight, with the goddess\'s offering. His dead stand round him. You will not get past them.'],
  ['kithar', 'The keys hang on his belt, always: the cells, the treasure room, the chests. Nobody else has a set.'],
  ['kithar', 'The sword? There is a cellar below the great chamber where the water comes in, down the wet stairs past the meditation room. Something lives there. We do not go.'],
  ['kithar', 'The robes, in the changing room by his stair: wear them, and the brothers will not look twice until you are close.'],
  ['kithar', 'Thieves! Defilers!'],
  ['lizardman', 'Shiny is mine'],
  ['lizardman', 'Go away.'],
  ['lizardman', 'Take shiny. Go.'],
  ['lizardman', 'Mine!'],
  ['odric', 'Visitors, at the goddess\'s hour! Kill them, my dead. She will have her blood either way.'],
  ['odric', 'It is done'],
  ['odric', 'Feed, my pet!'],
  ['odric', 'This is not finished!'],
  ['rosa', 'You came back for me?'],
  ['rosa', 'Rosa Dobbit, of the Dobbits of Kollchap. They were going to... You saved my life.'],
  ['rosa', 'Try and stop me. Give me a blade and point me at a priest.'],
  ['rosa', 'I\'ll see you in the village. Drinks are on me.'],
  ['rosa', 'Belisarius? You old coward, you\'re alive!'],
  ['rosa', 'They said you ran.'],
  ['rosa', 'That\'s my aunt Tansy. And the Brockhouse boys. They told us wolves took them.'],
  ['merchant', 'Ambrose Tull, merchant, of Kollchap village! Get me out of here and there\'s fifty gold in it for you!'],
  ['merchant', 'Help us! Get us out! The high priest has the keys, on his belt!'],
  ['oracle', 'Three questions, each of them how, / I answer today. Ask, and ask now. / But mark me well, as you go your way: / one of my three is a lie, they say.'],
  ...[
    'Past the circle, green and wide, / the sword lies drowned where the sunbeams hide.',
    'A door of stone that shuts behind / hides another, hard to find.',
    'The goblins leap where the floor is thin; / mark where they jump, or you\'ll fall in.',
    'Iron keys on the green priest\'s belt / unlock the cells where the captives knelt.',
    'In the south, a statue speaks, / three times a day, to one who seeks.',
    'Down the wet stairs where the sunlight falls, / behind the rock in the flooded halls.',
    'Up the stair where the braziers glow, / in Odric\'s bed the sword lies low.',
    'Search the west wall, stone by stone: / a door is hidden there, unknown.',
    'Push the block the way you came; / it turns for those who speak its name.',
    'Iron keys on Odric\'s belt / unlock the cells where the captives knelt.',
    'Speak the goddess\'s name out loud, / and the bars will part before the crowd.',
    'Strike while his rite is still undone; / in heavy iron he\'s slow to run.',
    'Only silver finds his heart; / steel and iron fall apart.',
    'Bring her word of what was stolen: / a seated figure, stone and solemn.',
    'Bow and call her mother dear, / and she will let you pass from here.',
  ].map((t) => ['oracle', t]),
];
export const LINE_IDS = SPOKEN.map(([who, text]) => [lineId(who, text), who, text.replace(/ \/ /g, ', ')]);

// [id, prompt, seconds, loop, prompt influence]
export const SFX = [
  // ambience: the soundscape per room (PLAN.md 8.1)
  ['amb_drips', 'Dungeon ambience: slow water drips echoing in a stone cellar, faint distant low rumble, very quiet, no voices', 24, true, 0.5],
  ['amb_wind', 'Cold wind moaning down a stone tunnel from the surface, soft gusts, cave ambience', 20, true, 0.5],
  ['amb_water', 'Rushing and lapping water in a flooded underground cellar, trickling stream, echo', 20, true, 0.5],
  ['amb_pool', 'Small spring pool bubbling gently in a stone chamber, soft gurgle, quiet', 16, true, 0.5],
  ['amb_braziers', 'Large fire braziers roaring and crackling steadily in a vast stone hall, deep resonant', 20, true, 0.5],
  ['amb_evening', 'Outdoor evening ambience among ruins: crickets, a distant owl, gentle breeze in trees, crackling campfire', 24, true, 0.5],
  ['amb_torch', 'Close torch flame crackling and fluttering steadily, burning pitch', 10, true, 0.6],
  ['amb_hum', 'A low eerie magical sword hum, resonant metallic drone with slow pulsing, sustained', 8, true, 0.7],
  // music beds: drones
  ['mus_explore', 'Dark fantasy dungeon ambient music drone: low sustained cello and deep male choir pad, slow and mysterious, no percussion, no melody', 30, true, 0.6],
  ['mus_combat', 'Tense dark fantasy battle music loop: driving low taiko drums, staccato cellos, urgent and grim, steady tempo', 30, true, 0.6],
  ['mus_boss', 'Ominous ritual chant music loop: deep chanting choir, heavy slow drums, dissonant low strings, sinister ceremony', 30, true, 0.6],
  ['mus_surface', 'Mystical quiet evening ambience: soft distant chiming bells and slow shimmering swirls of airy sound, sparse and hushed, fading away to near silence between phrases, no flute, no drums, no melody line', 30, true, 0.6],
  ['sting_victory', 'Short triumphant medieval fanfare: brass and timpani flourish, heroic, ends cleanly', 4, false, 0.7],
  ['sting_defeat', 'Short tragic orchestral sting: low strings fall and a deep drum, mournful, ends', 4, false, 0.7],
  ['sting_sword', 'Mystical revelation sting: shimmering choir swell, bright metallic ring, a magic sword awakens', 4, false, 0.7],
  ['sting_encounter', 'Single deep bronze gong strike with long ringing decay', 3, false, 0.8],
  // doors and the dungeon
  ['door_open', 'Heavy old oak door creaking open slowly on iron hinges, stone room', 2, false, 0.6],
  ['door_stuck', 'Shoulder thudding against a stuck wooden door that will not give, rattle', 1.5, false, 0.6],
  ['door_force', 'Stuck wooden door forced open with a bang and a scrape of wood on stone', 1.5, false, 0.6],
  ['door_close', 'Heavy wooden door swinging shut with a deep thud and latch click', 1.5, false, 0.6],
  ['door_smash', 'Iron lock smashed off a wooden door with a heavy hammer blow, metal clang and splintering', 1.5, false, 0.6],
  ['door_secret', 'Hidden stone door grinding open, heavy stone scraping on stone, dust trickling', 2.5, false, 0.6],
  ['door_block', 'Huge stone block sliding and slamming shut with a deep boom, stone grinding', 3, false, 0.6],
  ['gate_open', 'Rusty iron cell gate creaking open, chain rattling, dungeon', 2, false, 0.6],
  ['lock_pick', 'Lock picking: small metal tools clicking and scraping inside an old lock, then a click', 2, false, 0.6],
  ['lever', 'Heavy iron lever pulled with a clunk, then distant stone mechanism rumbling', 2, false, 0.6],
  ['search', 'Hands searching rough stone walls, tapping and scraping, shuffling feet, quiet', 2.5, false, 0.5],
  // footsteps: three muted scuffs, picked at random so walking doesn't tick like a clock
  ['step_1', 'One short muted footstep: the quick scuff of a soft leather sole set down on gritty stone, a brief dry tap, no drag, no scrape, quiet and close, no echo, no music', 0.5, false, 0.8],
  ['step_2', 'A single footstep: a soft leather sole landing with a short dull scuff on a dusty stone floor, crisp and brief, no dragging, close, no echo', 0.5, false, 0.8],
  ['step_3', 'One soft step of a leather shoe on flagstone, a tiny dull scuff as it lands, short and clean, no slide or drag, muted, close, no echo', 0.5, false, 0.8],
  ['torch_light', 'Torch catching fire with a whoosh and crackle', 1.5, false, 0.6],
  ['fall', 'Body falling into a pit and landing hard on stone with a thud and grunt', 1.5, false, 0.6],
  ['splash', 'Wading footsteps splashing through knee deep water', 1.5, false, 0.6],
  // combat
  ['swing', 'Sword swing whoosh through the air', 0.6, false, 0.7],
  ['hit', 'Sword blade hitting flesh, meaty impact', 0.7, false, 0.7],
  ['clang', 'Weapon striking plate armour, sharp metallic clang', 0.7, false, 0.7],
  ['miss', 'Blade glancing off a wooden shield, dull knock', 0.7, false, 0.6],
  ['mace', 'Heavy mace thudding into a body, blunt crunch', 0.7, false, 0.7],
  ['bow', 'Bow string twang and arrow whoosh', 0.8, false, 0.7],
  ['sling', 'Sling whirling and releasing a stone with a snap', 0.9, false, 0.7],
  ['throw', 'Dagger thrown spinning through the air', 0.7, false, 0.7],
  ['dice_d20', 'A single plastic twenty-sided die rolling and clattering across a wooden table, then settling', 1.2, false, 0.7],
  ['dice_d6', 'Two small wooden dice rolling across a table and settling', 1, false, 0.7],
  ['body_fall', 'Body collapsing to a stone floor with armour rattling', 1, false, 0.6],
  // spells
  ['spell_missile', 'Magic missile: a crackling bolt of arcane energy whooshing and striking with a zap', 1.2, false, 0.6],
  ['spell_sleep', 'Sleep spell: soft shimmering magical chime with a gentle descending sigh', 2, false, 0.6],
  ['spell_light', 'Light spell: bright magical bloom, warm rising shimmer', 1.5, false, 0.6],
  ['spell_cure', 'Healing spell: soft warm chime and gentle choir breath', 2, false, 0.6],
  ['spell_turn', 'Holy power: a ringing bell chime and a radiant swell that drives evil back', 2, false, 0.6],
  ['spell_cast', 'Generic spell cast: magical whoosh and sparkle', 1.2, false, 0.6],
  ['spell_hold', 'Dark binding spell: a hissing whisper and a cold magical crackle that freezes', 1.5, false, 0.6],
  // the denizens
  ['mon_hobgoblin', 'Hobgoblin warrior roaring a guttural battle shout', 1.5, false, 0.6],
  ['mon_orc', 'Orc grunting and snarling aggressively', 1.5, false, 0.6],
  ['mon_rat', 'Giant rats squeaking and hissing, scrabbling claws', 1.5, false, 0.6],
  ['mon_bats', 'Swarm of bats shrieking and flapping wings in a tunnel', 3, false, 0.6],
  ['mon_slime', 'Wet slimy squelch, gooey dripping', 1.5, false, 0.6],
  ['mon_goblin', 'Goblins chattering and cackling, high pitched', 1.5, false, 0.6],
  ['mon_ghoul', 'Ghoul hissing and snarling, wet rasping undead breath', 1.5, false, 0.6],
  ['mon_rockman', 'Stone golem moving: heavy rocks grinding and crunching', 1.5, false, 0.6],
  ['mon_priest', 'Low menacing chant of cultist priests, murmured', 2, false, 0.6],
  ['mon_bugbear', 'Huge hairy beast roaring', 1.5, false, 0.6],
  ['mon_skeleton', 'Skeleton bones rattling and clacking as it moves', 1.5, false, 0.6],
  ['mon_skeleton_die', 'Skeleton collapsing into a pile of clattering bones', 1.5, false, 0.6],
  ['mon_gecko', 'Giant lizard hissing loudly', 1.5, false, 0.6],
  ['mon_zombie', 'Zombie groaning, low and hungry', 1.5, false, 0.6],
  ['mon_centipede', 'Giant centipede skittering, many legs clicking on stone', 1.5, false, 0.6],
  ['mon_locust', 'Giant insect chittering and clicking', 1.5, false, 0.6],
  ['mon_spit', 'Wet spitting splat', 0.8, false, 0.6],
  ['mon_lizardman', 'Lizard man hissing threateningly', 1.2, false, 0.6],
  // treasure
  ['coins', 'Handful of coins clinking into a leather bag', 1.2, false, 0.6],
  ['chest', 'Old wooden chest lid creaking open', 1.5, false, 0.6],
  ['needle', 'Tiny metallic click of a trap needle springing', 0.6, false, 0.6],
  ['urn', 'Clay urn smashing on stone, shards scattering', 1.2, false, 0.6],
  ['potion', 'Drinking from a small glass bottle, gulp, cork pop', 1.2, false, 0.6],
];
