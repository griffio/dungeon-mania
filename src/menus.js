// The title screen and the menus (PLAN.md 7.6): new adventure (choosing the difficulty), continue,
// load and save (an autosave and three slots, PLAN.md 7.7), settings, and the in-game menu. DOM
// only; main.js says what each choice does through `act`.
//   act: { newGame(difficulty), load(slot), save(slot), title(), settingsChanged(), canSave() }
import { DIFFICULTIES, save as saveSettings } from './settings.js';
import { list } from './save.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const slotName = (slot) => (slot === 'auto' ? 'Autosave' : `Slot ${slot}`);
const slotNote = (d) => (d ? `${esc(d.where)} · turn ${d.turn} · ${DIFFICULTIES[d.difficulty]?.name || ''} · ${when(d.saved)}` : 'Empty');

export class Menus {
  constructor(prefs, act) {
    this.prefs = prefs;
    this.act = act;
    this.panel = $('#panel');
  }

  // ---------- the title ----------
  showTitle() {
    const auto = list().find((s) => s.slot === 'auto')?.data, any = list().some((s) => s.data);
    const m = $('#title-menu');
    m.innerHTML = '';
    const add = (label, note, fn, main) => {
      const b = document.createElement('button');
      if (main) b.className = 'main';
      b.innerHTML = `${label}${note ? `<span>${note}</span>` : ''}`;
      b.onclick = fn;
      m.appendChild(b);
    };
    if (auto) add('Continue', slotNote(auto), () => this.act.load('auto'), true);
    add('New adventure', '', () => this.showNew(), !auto);
    if (any) add('Load', '', () => this.showSlots('load'));
    add('Settings', '', () => this.showSettings());
    add('How to play', '', () => $('#howto').classList.add('show'));
    $('#title').classList.add('show');
  }
  hideTitle() { $('#title').classList.remove('show'); }

  // ---------- panels ----------
  open(html, wire) {
    this.panel.querySelector('.panelbox').innerHTML = html;
    this.panel.classList.add('show');
    this.panel.onclick = (e) => { if (e.target === this.panel) this.close(); };
    wire?.(this.panel.querySelector('.panelbox'));
  }
  close() { this.panel.classList.remove('show'); }

  showNew() {
    this.open(`<h2>A new adventure</h2><p>Choose how hard Kollchap plays. It can't be changed once you're inside.</p><div class="opts">${
      Object.entries(DIFFICULTIES).map(([id, d]) => `<button class="opt" data-d="${id}">${d.name}${id === 'normal' ? ' (recommended)' : ''}<span>${d.note}</span></button>`).join('')
    }</div><div class="foot"><button data-x>Back</button></div>`, (box) => {
      for (const b of box.querySelectorAll('[data-d]')) b.onclick = () => { this.prefs.difficulty = b.dataset.d; saveSettings(this.prefs); this.close(); this.act.newGame(b.dataset.d); };
      box.querySelector('[data-x]').onclick = () => this.close();
    });
  }

  // mode: 'load' or 'save'
  showSlots(mode) {
    const slots = list().filter((s) => mode === 'load' ? s.data : s.slot !== 'auto');
    this.open(`<h2>${mode === 'load' ? 'Load an adventure' : 'Save the adventure'}</h2><div class="opts">${
      slots.map(({ slot, data }) => `<button class="opt" data-s="${slot}">${slotName(slot)}<span>${slotNote(data)}</span></button>`).join('')
    }</div><div class="foot"><button data-x>Back</button></div>`, (box) => {
      for (const b of box.querySelectorAll('[data-s]')) b.onclick = () => {
        if (mode === 'load') { this.close(); this.act.load(b.dataset.s); return; }
        const ok = this.act.save(b.dataset.s);
        b.querySelector('span').textContent = ok ? 'Saved' : 'Could not save here';
        setTimeout(() => this.close(), 600);
      };
      box.querySelector('[data-x]').onclick = () => this.close();
    });
  }

  // the in-game menu
  showMenu() {
    const canSave = this.act.canSave();
    this.open(`<h2>Kollchap</h2><div class="opts">
      <button class="opt" data-a="resume">Back to the adventure</button>
      <button class="opt" data-a="save" ${canSave ? '' : 'disabled'}>Save<span>${canSave ? 'To one of three slots' : 'Not now: wait until nothing is moving, and no one is talking'}</span></button>
      <button class="opt" data-a="load">Load</button>
      <button class="opt" data-a="settings">Settings</button>
      <button class="opt" data-a="help">How to play</button>
      <button class="opt" data-a="title">Back to the title<span>The autosave keeps your place</span></button>
    </div>`, (box) => {
      for (const b of box.querySelectorAll('[data-a]')) b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'resume') this.close();
        if (a === 'save') this.showSlots('save');
        if (a === 'load') this.showSlots('load');
        if (a === 'settings') this.showSettings();
        if (a === 'help') { this.close(); $('#howto').classList.add('show'); }
        if (a === 'title') { this.close(); this.act.title(); }
      };
    });
  }

  showSettings() {
    const p = this.prefs;
    const check = (k, label, note) => `<div class="row"><label for="s-${k}">${label}<small>${note}</small></label><input type="checkbox" id="s-${k}" data-k="${k}" ${p[k] ? 'checked' : ''}></div>`;
    const range = (k, label, min, max, step) => `<div class="row"><label for="s-${k}">${label}</label><input type="range" id="s-${k}" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${p[k]}"></div>`;
    this.open(`<h2>Settings</h2>
      <div class="row"><div>Difficulty<small>For the next new adventure</small></div><div class="seg">${Object.entries(DIFFICULTIES).map(([id, d]) => `<button data-diff="${id}" class="${p.difficulty === id ? 'on' : ''}">${d.name}</button>`).join('')}</div></div>
      ${check('showDice', 'Roll the dice on the table', 'Off: just the numbers')}
      ${check('partyFirst', 'The party always acts first', 'Instead of rolling initiative each round')}
      ${check('wanderers', 'Wandering monsters', 'Residents who leave their posts to hunt you')}
      ${check('tips', 'Hints', 'A tip the first time something new comes up')}
      ${check('reduceMotion', 'Reduce motion', 'Quick dice, no animations')}
      ${range('textSize', 'Text size', 0.85, 1.3, 0.05)}
      ${range('volume', 'Volume', 0, 1, 0.05)}
      ${range('voices', 'Voices', 0, 1.5, 0.05)}
      ${range('music', 'Music', 0, 0.8, 0.02)}
      <div class="foot"><button data-x>Done</button></div>`, (box) => {
      for (const b of box.querySelectorAll('[data-diff]')) b.onclick = () => { p.difficulty = b.dataset.diff; for (const o of box.querySelectorAll('[data-diff]')) o.classList.toggle('on', o === b); this.changed(); };
      for (const el of box.querySelectorAll('[data-k]')) el.oninput = () => { p[el.dataset.k] = el.type === 'checkbox' ? el.checked : Number(el.value); this.changed(); };
      box.querySelector('[data-x]').onclick = () => this.close();
    });
  }
  changed() { saveSettings(this.prefs); this.act.settingsChanged(); }
}
