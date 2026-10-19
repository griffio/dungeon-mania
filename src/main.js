import { Renderer } from './renderer.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { Audio } from './audio.js';
import { hum } from './ending.js';
import * as settings from './settings.js';
import * as saves from './save.js';
import { Menus } from './menus.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#gpu');
const renderer = new Renderer();
const audio = new Audio();
const prefs = settings.load();
let ui, game = null, menus, attract = true;

// Sound can only start after a tap or a key (browser rules): the first one starts it.
let started = false;
async function startAudio() {
  if (started) { audio.resume(); return; }
  started = true;
  try { audio.setMuted(localStorage.getItem('kollchap-muted') === '1'); } catch {}
  await audio.init();
  audio.resume();
  applyPrefs();
  // a new adventure started before the first tap: the intro now
  if (game && !attract) { game.audio = audio; if (game.clock === 0 && game.L.id === 'surface') audio.narrate('nar_intro'); }
  muteIcon();
}
const muteIcon = () => { $('#mute').textContent = audio.muted ? '🔇' : '🔊'; };
window.addEventListener('pointerdown', startAudio);
window.addEventListener('keydown', startAudio);

// Settings that act at once: text size, reduced motion, the volumes.
function applyPrefs() {
  document.documentElement.style.setProperty('--ui', String(prefs.textSize || 1));
  document.body.classList.toggle('calm', !!prefs.reduceMotion);
  audio.setLevels?.(prefs);
}

// A game in play (or behind the title): wired to the UI, the sound and the autosave.
function setGame(g, { play }) {
  game = g;
  window.game = game; // handy for debugging from the console
  attract = !play;
  game.prefs = prefs;
  game.audio = play && started ? audio : null;
  game.autosave = play ? () => { if (saves.canSave(game)) saves.write(game, 'auto'); } : null;
  ui.playing = play; // (no tips or bestiary cards behind the title)
  ui.attach(game);
  $('#hud').classList.toggle('show', play);
}
const act = {
  newGame(difficulty) {
    const g = new Game({ ui, difficulty, prefs });
    setGame(g, { play: true });
    menus.hideTitle();
    if (started) audio.narrate('nar_intro');
  },
  load(slot) {
    const data = saves.read(slot);
    if (!data) return;
    try {
      const g = saves.restore(data, { ui, prefs });
      setGame(g, { play: true });
      menus.hideTitle();
      game.say(`Resumed: ${data.where}, turn ${data.turn}.`);
    } catch (e) {
      console.error(e);
      menus.open(`<h2>Can't load that</h2><p>${e.message}.</p><div class="foot"><button onclick="document.querySelector('#panel').classList.remove('show')">Back</button></div>`);
    }
  },
  save(slot) { return saves.canSave(game) && saves.write(game, slot); },
  canSave() { return !attract && saves.canSave(game); },
  title() { if (!attract && saves.canSave(game)) saves.write(game, 'auto'); toTitle(); },
  settingsChanged() { applyPrefs(); ui.update(game); },
};
// The title, over the ruins at sunset, the view slowly turning.
function toTitle() {
  setGame(new Game({ ui, prefs }), { play: false });
  game.camera.distGoal = 22;
  menus.showTitle();
}

async function boot() {
  try {
    await renderer.init(canvas);
  } catch (err) {
    $('#nogpu').classList.add('show');
    $('#nogpu .why').textContent = err.message;
    $('#loading').classList.remove('show');
    return;
  }
  renderer.onLost = () => $('#lost').classList.add('show');
  $('#reload').addEventListener('click', () => location.reload());
  ui = new UI(prefs);
  menus = new Menus(prefs, act);
  ui.menus = menus;
  new Input(canvas, () => (attract ? null : game));
  applyPrefs();
  toTitle();
  $('#loading').classList.remove('show');
  requestAnimationFrame(loop);
}

$('#help').addEventListener('click', () => $('#howto').classList.toggle('show'));
$('#howto').addEventListener('click', () => $('#howto').classList.remove('show'));
$('#menubtn').addEventListener('click', () => menus.showMenu());
$('#mute').addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  try { localStorage.setItem('kollchap-muted', audio.muted ? '1' : '0'); } catch {}
  muteIcon();
});
// Esc with nothing else going on opens the menu
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || attract || !game || game.selected || game.casting || game.dialogue || game.target >= 0 || game.attackPlan) return;
  if ($('#panel').classList.contains('show')) menus.close(); else menus.showMenu();
});

let last = performance.now(), ema = 1 / 60, slow = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // adaptive resolution: drop render scale if we can't hold ~40fps
  ema += (dt - ema) * 0.05;
  slow = ema > 1 / 40 ? slow + dt : 0;
  if (slow > 2.5 && (renderer.scale ?? 1) > 0.55) { renderer.scale = (renderer.scale ?? 1) - 0.15; slow = 0; }
  renderer.resize();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (attract) game.camera.yaw += dt * 0.04;
  game.update(dt);
  game.frame(renderer, w, h);
  ui.frame(game, w, h);
  if (!attract) audio.update(game, hum(game));
  requestAnimationFrame(loop);
}

boot();
