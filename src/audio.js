// Web Audio playback of the pre-generated ElevenLabs sound (PLAN.md 8.1), extending the chopper's.
//   buses: sound effects, the party's voices, people's speech and the narrator (dry), ambience,
//   and music, all into a master with a gentle compressor.
//   reverb: four generated dungeon impulses (a tight passage, a room, the great hall of 12, the
//   wet slap of 23), crossfaded by where the party stands; the surface is dry.
//   the oracle: pitched down, through a long stone reverb and a slow chorus.
//   positional: one-shots in the world are panned and fall off with distance from the view.
//   voices: one at a time. The narrator and people's lines queue; the party's barks only speak
//   into silence.
// Memory: short sounds are decoded up front; speech is decoded when needed and kept in a small
// cache; the long loops stream from <audio> elements, so an iPad doesn't hold minutes of PCM.
import { hash, quotes } from './voice.js';

const LOOPS = /^(amb_|mus_)/;
const CACHE = 48;

export class Audio {
  constructor() {
    this.ids = new Set();
    this.buffers = new Map();
    this.loops = new Map();
    this.queue = [];
    this.speaking = null;
    this.busyUntil = 0;
    this.listener = { x: 0, z: 0, zoom: 14 };
    this.muted = false;
    this.ready = false;
  }

  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3;
    this.master.connect(comp); comp.connect(c.destination);
    const bus = (v, to = this.master) => { const g = c.createGain(); g.gain.value = v; g.connect(to); return g; };
    // the room reverbs, each with its own send level; everything wet goes in through verbIn
    this.verbs = {};
    this.verbIn = c.createGain();
    for (const [name, secs, decay, bright] of [['tight', 0.6, 3.5, 0.5], ['room', 1.3, 3, 0.45], ['hall', 3.2, 2.2, 0.35], ['wet', 2, 2.6, 0.7]]) {
      const conv = c.createConvolver(); conv.buffer = this.impulse(secs, decay, bright);
      const send = c.createGain(); send.gain.value = 0;
      this.verbIn.connect(send); send.connect(conv); conv.connect(this.master);
      this.verbs[name] = send;
    }
    const wetDry = (v, wet) => { const g = bus(v); const w = c.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.verbIn); return g; };
    this.sfxBus = wetDry(0.8, 0.5);
    this.voiceBus = wetDry(1, 0.25);
    this.speechBus = wetDry(1, 0.3);
    this.narratorBus = bus(1);
    this.ambBus = wetDry(0.5, 0.2);
    this.musicBus = bus(0.32);
    // the oracle: dry, plus a long stone reverb and a slow chorus
    this.oracleBus = bus(1);
    const stone = c.createGain(), conv = c.createConvolver();
    stone.gain.value = 0.7; conv.buffer = this.impulse(4.5, 1.8, 0.3);
    this.oracleBus.connect(stone); stone.connect(conv); conv.connect(this.master);
    const chorus = c.createDelay(0.05); chorus.delayTime.value = 0.02;
    const lfo = c.createOscillator(), depth = c.createGain(); lfo.frequency.value = 0.4; depth.gain.value = 0.006;
    lfo.connect(depth); depth.connect(chorus.delayTime); lfo.start();
    const chorusMix = c.createGain(); chorusMix.gain.value = 0.5;
    this.oracleBus.connect(chorus); chorus.connect(chorusMix); chorusMix.connect(this.master);

    let list = [];
    try { list = await (await fetch('assets/audio/manifest.json')).json(); } catch { list = []; }
    this.ids = new Set(list);
    // spoken lines by the hash of their words: say_<who>_<hash>
    this.lines = new Map(list.filter((id) => id.startsWith('say_')).map((id) => [id.slice(-8), { id, who: id.slice(4, -9) }]));
    // the short sounds up front
    await Promise.all(list.filter((id) => !LOOPS.test(id) && !/^(nar_|say_|vo_)/.test(id)).map((id) => this.load(id)));
    this.ready = true;
  }

  // A dungeon impulse: decaying noise, darker as it dies.
  impulse(secs, decay, bright) {
    const c = this.ctx, n = Math.floor(c.sampleRate * secs), buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n, k = bright * (1 - t) + 0.05;
        lp += ((Math.random() * 2 - 1) - lp) * k;
        d[i] = lp * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  async load(id) {
    if (this.buffers.has(id)) return this.buffers.get(id);
    if (!this.ids.has(id)) return null;
    try {
      const ab = await (await fetch(`assets/audio/${id}.mp3`)).arrayBuffer();
      const b = await this.ctx.decodeAudioData(ab);
      this.buffers.set(id, b);
      // speech is played once in a while: keep only the most recent
      const spoken = [...this.buffers.keys()].filter((k) => /^(nar_|say_|vo_)/.test(k));
      if (spoken.length > CACHE) this.buffers.delete(spoken[0]);
      return b;
    } catch { return null; }
  }
  has(id) { return this.ids.has(id); }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    for (const l of this.loops.values()) l.el.muted = m;
  }

  // A one-shot. pos: [x, z] in the world, for panning and distance.
  play(id, opts = {}) { return this.playBuffer(this.buffers.get(id), opts); }
  playBuffer(b, { vol = 1, pos = null, rate = 1, bus = this.sfxBus, jitter = 0.06 } = {}) {
    const c = this.ctx;
    if (!b || !c) return null;
    const src = c.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * jitter);
    const g = c.createGain();
    let v = vol, out = g;
    if (pos) {
      const dx = pos[0] - this.listener.x, dz = pos[1] - this.listener.z, d = Math.hypot(dx, dz), near = this.listener.zoom * 0.5;
      v *= d < near ? 1 : Math.max(0.1, near / d);
      if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-0.7, Math.min(0.7, dx / 14)); g.connect(p); out = p; }
    }
    g.gain.value = v;
    src.connect(g); out.connect(bus);
    src.start();
    return src;
  }

  // ---------- voices ----------
  // Speech in turn: { id, bus, rate }. The narrator and people queue; returns at once.
  async speak(id, bus = this.speechBus, rate = 1) {
    if (!this.ids.has(id)) return;
    this.queue.push({ id, bus, rate });
    // don't fall behind the game: past three waiting, the oldest goes unsaid
    if (this.queue.length > 3) this.queue.shift();
    if (!this.speaking) this.next();
  }
  // Speech that arrived as audio (the oracle's live answers), queued like the rest.
  async speakBuffer(ab, who) {
    if (!this.ctx) return;
    try {
      const b = await this.ctx.decodeAudioData(ab);
      const id = `live_${Math.random().toString(36).slice(2)}`;
      this.buffers.set(id, b);
      this.queue.push({ id, bus: who === 'oracle' ? this.oracleBus : this.speechBus, rate: who === 'oracle' ? 0.9 : 1, once: true });
      if (!this.speaking) this.next();
    } catch {}
  }
  // A recording of these words, if there is one.
  lineFor(text) { return this.lines?.get(hash(text)) || null; }
  async next() {
    const item = this.queue.shift();
    if (!item) { this.speaking = null; this.duck(false); return; }
    this.speaking = item;
    this.duck(true);
    const b = item.once ? this.buffers.get(item.id) : await this.load(item.id);
    if (item.once) this.buffers.delete(item.id);
    if (!b) { this.next(); return; }
    const src = this.playBuffer(b, { bus: item.bus, rate: item.rate });
    this.busyUntil = this.ctx.currentTime + b.duration / item.rate + 0.3;
    src.onended = () => setTimeout(() => this.next(), 250);
  }
  // The music and ambience dip under a voice.
  duck(on) { if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.14 : 0.32, this.ctx.currentTime, 0.3); }
  narrate(id) { this.speak(id, this.narratorBus); }
  // Whatever is said in quotes in this text: each line that has a recording, in turn, in its
  // speaker's voice (the oracle through the stone, the lizardman pitched down).
  sayQuotes(text) {
    if (!this.lines) return;
    for (const q of quotes(text)) {
      const line = this.lines.get(hash(q));
      if (!line) continue;
      if (line.who === 'oracle') this.speak(line.id, this.oracleBus, 0.9);
      else if (line.who === 'lizardman') this.speak(line.id, this.speechBus, 0.86);
      else this.speak(line.id, this.speechBus);
    }
  }
  // A party member's bark: only into silence, and not too often. variants: vo_<who>_<event>_<n>.
  bark(who, event, { force = false } = {}) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (!force && (this.speaking || now < this.busyUntil || now < (this.lastBark || 0) + 2.5)) return;
    const opts = [1, 2, 3].map((n) => `vo_${who}_${event}_${n}`).filter((id) => this.ids.has(id));
    if (!opts.length) return;
    this.lastBark = now;
    const id = opts[Math.floor(Math.random() * opts.length)];
    this.load(id).then((b) => { if (b) { this.play(id, { bus: this.voiceBus, jitter: 0 }); this.busyUntil = this.ctx.currentTime + b.duration + 0.2; } });
  }

  // ---------- loops: ambience and music, streamed ----------
  loop(id, vol, bus) {
    if (!this.ctx || !this.ids.has(id)) return;
    let l = this.loops.get(id);
    if (!l) {
      const el = new window.Audio(`assets/audio/${id}.mp3`);
      el.loop = true; el.crossOrigin = 'anonymous'; el.muted = this.muted;
      const src = this.ctx.createMediaElementSource(el), g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(g); g.connect(bus);
      l = { el, g, vol: 0 };
      this.loops.set(id, l);
    }
    if (Math.abs(l.vol - vol) < 0.01) return;
    l.vol = vol;
    l.g.gain.setTargetAtTime(vol, this.ctx.currentTime, vol > 0 ? 0.8 : 0.6);
    if (vol > 0 && l.el.paused) l.el.play().catch(() => {});
    if (vol === 0) { clearTimeout(l.stop); l.stop = setTimeout(() => { if (l.vol === 0) l.el.pause(); }, 4000); }
  }

  // ---------- the soundscape, every frame ----------
  // Music for the moment, ambience and reverb for the place, the torches' crackle, the sword's hum.
  update(g, hum) {
    if (!this.ready || !this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx, cam = g.camera;
    this.listener = { x: cam.tx, z: cam.tz, zoom: cam.dist };
    const d = g.dungeon, room = d.roomOf(g.leader.tile), surface = g.L.id === 'surface';
    const boss = g.mode === 'encounter' && g.enc?.groups.has('odric');
    const music = g.mode === 'over' ? null : boss ? 'mus_boss' : g.mode === 'encounter' && g.activeFoes().length ? 'mus_combat' : surface ? 'mus_surface' : 'mus_explore';
    for (const id of ['mus_boss', 'mus_combat', 'mus_surface', 'mus_explore']) this.loop(id, id === music ? 1 : 0, this.musicBus);
    const place = surface ? 'amb_evening' : { wind: 'amb_wind', pool: 'amb_pool', braziers: 'amb_braziers', 'rushing-water': 'amb_water' }[room?.sound] || 'amb_drips';
    for (const id of ['amb_evening', 'amb_wind', 'amb_pool', 'amb_braziers', 'amb_water', 'amb_drips']) this.loop(id, id === place ? 0.9 : id === 'amb_drips' && !surface ? 0.35 : 0, this.ambBus);
    const torches = g.party.filter((m) => !m.dead && m.light === 'torch').length;
    this.loop('amb_torch', surface ? 0 : Math.min(0.45, torches * 0.22), this.ambBus);
    this.loop('amb_hum', hum ? 0.25 + 0.75 * (1 - hum.dist / 4) : 0, this.sfxBus);
    // reverb by the size of the place
    const kind = surface ? null : !room || room.passage ? 'tight' : room.id === '12' ? 'hall' : room.id === '23' ? 'wet' : 'room';
    if (kind !== this.place) {
      this.place = kind;
      for (const [name, send] of Object.entries(this.verbs)) send.gain.setTargetAtTime(name === kind ? 0.6 : 0, c.currentTime, 0.5);
    }
  }
}
