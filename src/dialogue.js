// Scripted dialogue (PLAN.md 8.3: deterministic, not AI). Someone speaks, with their portrait;
// the party picks an answer, which runs and may lead to another line. While a line is up, the
// map waits.
//   talk(g, { who, name, text, options: [{ label, hint, ok, run }] })   who: the portrait id

export function talk(g, { who, name, text, options }) {
  g.dialogue = { who, name, text, options: options?.length ? options : [{ label: 'Go on', run: () => {} }] };
  // the quoted words are spoken, if there is a recording of them
  g.audio?.sayQuotes(text);
  g.ui.update(g);
}

export function choose(g, k) {
  const d = g.dialogue, o = d?.options[k];
  if (!o || o.ok === false) return;
  g.dialogue = null;
  o.run?.();
  g.refreshPreview();
  g.ui.update(g);
}
