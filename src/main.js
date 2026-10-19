import { Renderer } from './renderer.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { Audio } from './audio.js';
import { hum } from './ending.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#gpu');
const renderer = new Renderer();
let ui, game = null;
const audio = new Audio();
// Sound can only start after a tap or a key (browser rules): the first one starts it, and the
// narrator reads the intro.
let started = false;
async function startAudio() {
  if (started) { audio.resume(); return; }
  started = true;
  try { audio.setMuted(localStorage.getItem('kollchap-muted') === '1'); } catch {}
  await audio.init();
  audio.resume();
  if (game) { game.audio = audio; if (game.clock === 0) audio.narrate('nar_intro'); }
  muteIcon();
}
const muteIcon = () => { $('#mute').textContent = audio.muted ? '🔇' : '🔊'; };
window.addEventListener('pointerdown', startAudio);
window.addEventListener('keydown', startAudio);

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
  ui = new UI();
  game = new Game({ ui });
  window.game = game; // handy for debugging from the console
  ui.attach(game);
  new Input(canvas, () => game);
  $('#loading').classList.remove('show');
  $('#hud').classList.add('show');
  requestAnimationFrame(loop);
}

$('#help').addEventListener('click', () => $('#howto').classList.toggle('show'));
$('#mute').addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  try { localStorage.setItem('kollchap-muted', audio.muted ? '1' : '0'); } catch {}
  muteIcon();
});
$('#howto').addEventListener('click', () => $('#howto').classList.remove('show'));

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
  game.update(dt);
  game.frame(renderer, w, h);
  ui.frame(game, w, h);
  audio.update(game, hum(game));
  requestAnimationFrame(loop);
}

boot();
