// The statue oracle's client (PLAN.md 8.3). The player asks a "How" question of 12 words or fewer
// (typed, or picked from suggestions); the Worker answers in a rhyming couplet from a fact sheet
// built here from the game's own state, true or false as the game decides; the answer is then
// voiced through the Worker. With no network or no Worker, a keyword match over canned couplets
// answers instead, so the game never depends on the service.
import { validate } from '../worker/src/index.js';

// Where the Worker is: ?oracle=<url> (remembered), else localhost:8787 when the game is served
// locally, else the same origin (/api, when the Worker sits behind Pages Functions).
export function endpoint() {
  if (typeof location === 'undefined') return null;
  try {
    const q = new URLSearchParams(location.search).get('oracle');
    if (q !== null) localStorage.setItem('kollchap-oracle', q);
    const saved = localStorage.getItem('kollchap-oracle');
    if (saved !== null) return saved || null;
  } catch {}
  return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:8787' : '';
}
const session = Math.random().toString(36).slice(2, 10);

// What the oracle knows: where things are and how to get past them, and what's still to do.
export function facts(g) {
  const st = g.state, D = g.levels.dungeon, d = D.dungeon, alive = (kind) => D.foes.some((f) => f.kind === kind && f.alive && !f.fled);
  const out = [];
  if (!st.sword) {
    out.push('The Sword of the Sorcerer lies behind a rock in the flooded storeroom (room 23), down slippery wet stairs south of the great chamber (room 12).');
    if (alive('lizardman') && !g.scriptState.lizardman?.bribed) out.push('A lizardman guards the sword. He will let it go for food, or if charmed or put to sleep.');
  } else out.push('The sword has been taken. The ways out are the tunnel at the east end of the entrance corridor, and the stairs up from the changing room (room 15).');
  const block = [...d.doors.values()].find((x) => x.opensFrom >= 0), west = d.doors.get(d.idx(27, 29));
  out.push('This statue room (room 21) is closed by a sliding stone block with no handle inside.' + (west && !west.found ? ' A secret door in its west wall is the way out; search there.' : ''));
  if (alive('odric') && !g.keys.has('odric')) out.push('Odric, the high priest, wears the iron keys to the cells (room 13) and the treasure chamber (room 14). He is at the green circle in the great chamber (room 12).');
  if (g.keys.has('odric')) out.push("The party carries Odric's keys.");
  if (D.cells.some((c) => !c.freed)) out.push('Eight villagers are locked in the cells (room 13), guarded by two zombies. The keys, a thief\'s picks or a hammer open the gates.');
  if (D.foes.some((f) => f.kind === 'rosa' && f.alive && f.state === 'captive')) out.push('Odric means to sacrifice Rosa, a halfling, at the green circle. He must be fought at once, or she dies within three rounds.');
  if (alive('archdeaconess') && !['guided', 'killed'].includes(st.deaconess)) out.push('The Arch-deaconess of Tranfax, in the office (room 9), wants back a statue stolen from her temple: this very statue. Telling her where it is wins her friendship.');
  if (D.traps.some((t) => !t.found)) out.push('A covered pit lies in the floor of the passage at room 18. The goblins of room 19 jump it. A ten-foot pole finds it.');
  if (D.foes.some((f) => f.kind === 'slime' && f.alive)) out.push('Green slime clings to the west wall of the long corridor (room 4). Only fire harms it.');
  if (D.chests.some((c) => c.trap && !c.opened)) out.push('Two of the four chests in the treasure chamber (room 14) have poisoned needles in their locks. One chest has a false bottom.');
  if (!st.leverPulled) out.push('A lever under the bed in Odric\'s bedroom (room 8) opens a hidden door in its north-west corner.');
  const orcDoor = d.doors.get(d.idx(40, 13));
  if (orcDoor && !orcDoor.found) out.push('The orcs\' guardroom (room 1) has a hidden door onto the entrance corridor. Noise brings them out behind you.');
  if (!st.casesMoved) out.push('Behind packing cases in the storeroom (room 5), a sliding panel hides a starving thief who knows the dungeon.');
  out.push('The healing pool (room 6) heals wounds. The cult\'s robes in the changing room (room 15) fool cultists from afar.');
  return out;
}

// The canned couplets: the oracle's voice when the Worker can't be reached. [keywords, true, false]
export const CANNED = [
  [/sword|blade|weapon/, 'Down the wet stairs where the sunlight falls, / behind the rock in the flooded halls.', 'Up the stair where the braziers glow, / in Odric\'s bed the sword lies low.'],
  [/out|leave|escape|room|block|door/, 'Search the west wall, stone by stone: / a door is hidden there, unknown.', 'Push the block the way you came; / it turns for those who speak its name.'],
  [/prisoner|cell|free|villager|key/, 'Iron keys on Odric\'s belt / unlock the cells where the captives knelt.', 'Speak the goddess\'s name out loud, / and the bars will part before the crowd.'],
  [/odric|priest|kill|beat|defeat/, 'Strike while his rite is still undone; / in heavy iron he\'s slow to run.', 'Only silver finds his heart; / steel and iron fall apart.'],
  [/deaconess|tranfax|woman|office|statue/, 'Bring her word of what was stolen: / a seated figure, stone and solemn.', 'Bow and call her mother dear, / and she will let you pass from here.'],
];
export const VAGUE = 'Patience, seeker, in the deep; / some answers dark and silent keep.';
export function offline(question, truthful) {
  const q = question.toLowerCase(), hit = CANNED.find(([re]) => re.test(q));
  return hit ? hit[truthful ? 1 : 2] : VAGUE;
}

// Ask. Returns { answer, source: 'oracle' | 'offline' | 'canned' }.
export async function ask(g, question, truthful) {
  const v = validate(question);
  if (v.canned) return { answer: v.canned, source: 'canned' };
  const base = endpoint();
  if (base !== null && typeof fetch !== 'undefined') {
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch(`${base}/api/oracle`, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: v.q, truthful, facts: facts(g), session }) });
      clearTimeout(timer);
      if (res.ok) { const out = await res.json(); if (out.answer) return { answer: out.answer, source: out.canned ? 'canned' : 'oracle' }; }
    } catch { /* offline: fall through */ }
  }
  return { answer: offline(v.q, truthful), source: 'offline' };
}

// The answer, in the stone voice: from the Worker, unless it's a line already recorded.
export async function voice(g, text) {
  const base = endpoint();
  if (!g.audio || base === null || g.audio.lineFor?.(text)) return false;
  try {
    const res = await fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, session }) });
    if (!res.ok) return false;
    g.audio.speakBuffer(await res.arrayBuffer(), 'oracle');
    return true;
  } catch { return false; }
}
