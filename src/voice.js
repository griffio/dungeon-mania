// Spoken lines (PLAN.md 8.1). Whatever someone says in quotes, in a dialogue or in the log, is
// voiced if a recording of exactly those words exists: the file is named by a hash of the words,
// so the scripts keep their text and tools/audio-manifest.mjs lists who says what. Pure, so the
// generator and the tests can use it too.

// Normalise a quote: trim, collapse spaces, curly quotes and dashes made plain, no trailing comma.
export function norm(text) {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().replace(/,$/, '');
}
// FNV-1a, 32 bits, as 8 hex digits.
export function hash(text) {
  let h = 0x811c9dc5;
  const s = norm(text);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
// The audio id for a line said by someone: say_<speaker>_<hash>. The game finds a recording by
// the hash of the words alone, and the speaker in the name says which voice chain it goes through.
export const lineId = (who, text) => `say_${who}_${hash(text)}`;
// The quoted speech in a piece of text, in order.
export function quotes(text) {
  const out = [], re = /"([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}
