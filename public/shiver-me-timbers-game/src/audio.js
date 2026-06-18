// Procedural spatial audio (Web Audio API). No asset files — every sound is
// synthesized: cannon booms, water splashes, wood hits, a wind/sea ambient bed,
// occasional gulls, and a whimsical looping sea-shanty. Positional sounds use
// PannerNodes tied to the camera-driven AudioListener for 3D placement.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.musicOn = false;
    this._musicTimer = null;
    this._gullTimer = null;
    this._fwd = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._pos = new THREE.Vector3();
  }

  async init() {
    if (this.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.master = this.ctx.createGain();
    this.master.gain.value = CONFIG.audio.master;
    this.master.connect(this.ctx.destination);

    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = CONFIG.audio.sfx;
    this.sfx.connect(this.master);

    this.music = this.ctx.createGain();
    this.music.gain.value = CONFIG.audio.music;
    this.music.connect(this.master);

    this.noiseBuf = this._noise(2.0);

    this._startAmbient();
    this._startMusic();
    this._scheduleGull();
    this.ready = true;
  }

  _noise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 24;
    p.maxDistance = 800;
    p.rolloffFactor = 1.1;
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    } else {
      p.setPosition(pos.x, pos.y, pos.z);
    }
    return p;
  }

  // --- one-shot SFX ---------------------------------------------------------
  cannon(pos) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const pan = this._panner(pos);
    pan.connect(this.sfx);

    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(36, t + 0.28);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(1.0, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(og).connect(pan);
    o.start(t);
    o.stop(t + 0.55);

    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.setValueAtTime(2400, t);
    nf.frequency.exponentialRampToValueAtTime(280, t + 0.25);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.9, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    n.connect(nf).connect(ng).connect(pan);
    n.start(t);
    n.stop(t + 0.4);
    n.onended = () => pan.disconnect();
  }

  splash(pos) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const pan = this._panner(pos);
    pan.connect(this.sfx);
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.18);
    f.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    n.connect(f).connect(g).connect(pan);
    n.start(t);
    n.stop(t + 0.5);
    n.onended = () => pan.disconnect();
  }

  hit(pos) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const pan = this._panner(pos);
    pan.connect(this.sfx);
    // wood crack: band-passed noise + a low thud
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1200;
    f.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    n.connect(f).connect(g).connect(pan);
    n.start(t);
    n.stop(t + 0.3);

    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.7, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og).connect(pan);
    o.start(t);
    o.stop(t + 0.32);
    o.onended = () => pan.disconnect();
  }

  gull(pos) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const pan = this._panner(pos);
    pan.connect(this.sfx);
    const g = this.ctx.createGain();
    g.gain.value = 0.0;
    g.connect(pan);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.connect(g);
    let when = t;
    for (let k = 0; k < 3; k++) {
      o.frequency.setValueAtTime(900 + Math.random() * 300, when);
      o.frequency.linearRampToValueAtTime(1500 + Math.random() * 400, when + 0.08);
      o.frequency.linearRampToValueAtTime(700, when + 0.18);
      g.gain.setValueAtTime(0.0, when);
      g.gain.linearRampToValueAtTime(0.12, when + 0.04);
      g.gain.linearRampToValueAtTime(0.0, when + 0.2);
      when += 0.32;
    }
    o.start(t);
    o.stop(when + 0.1);
    o.onended = () => pan.disconnect();
  }

  machineGun(pos) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const pan = this._panner(pos);
    pan.connect(this.sfx);
    // snappy report: short noise crack + a low click
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    n.connect(f).connect(g).connect(pan);
    n.start(t);
    n.stop(t + 0.09);
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.05);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.25, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(og).connect(pan);
    o.start(t);
    o.stop(t + 0.07);
    o.onended = () => pan.disconnect();
  }

  bulletHit(pos) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const pan = this._panner(pos);
    pan.connect(this.sfx);
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2600;
    f.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    n.connect(f).connect(g).connect(pan);
    n.start(t);
    n.stop(t + 0.1);
    n.onended = () => pan.disconnect();
  }

  // --- ambient + music ------------------------------------------------------
  _startAmbient() {
    // Wind: looped noise through a bandpass, gain set by setWind().
    const wind = this.ctx.createBufferSource();
    wind.buffer = this._noise(4.0);
    wind.loop = true;
    const wf = this.ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 600;
    wf.Q.value = 0.5;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.05;
    wind.connect(wf).connect(this.windGain).connect(this.master);
    wind.start();
    this.windFilter = wf;

    // Sea: low rumble with a slow swell LFO on the gain.
    const sea = this.ctx.createBufferSource();
    sea.buffer = this._noise(4.0);
    sea.loop = true;
    const sf = this.ctx.createBiquadFilter();
    sf.type = 'lowpass';
    sf.frequency.value = 420;
    const sg = this.ctx.createGain();
    sg.gain.value = 0.07;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(sg.gain);
    sea.connect(sf).connect(sg).connect(this.master);
    sea.start();
    lfo.start();
  }

  setWind(strength, shipSpeed = 0) {
    if (!this.ready) return;
    const target = 0.03 + strength * 0.06 + Math.min(shipSpeed, 18) * 0.004;
    this.windGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.5);
    this.windFilter.frequency.setTargetAtTime(450 + strength * 350, this.ctx.currentTime, 0.5);
  }

  _tone(freq, t, dur, type, vol) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _startMusic() {
    this.musicOn = true;
    const bpm = 108;
    const beat = 60 / bpm;
    // D natural-minor sea-shanty motif: pairs of (midi, beats). 0 = rest.
    const melody = [
      62, 2, 65, 1, 67, 1, 69, 2, 67, 1, 65, 1,
      62, 2, 65, 1, 62, 1, 64, 4,
      62, 2, 65, 1, 67, 1, 69, 2, 72, 1, 70, 1,
      69, 2, 67, 1, 65, 1, 62, 4,
    ];
    const bass = [38, 4, 45, 4, 46, 4, 45, 4, 38, 4, 45, 4, 46, 4, 43, 4];
    let totalBeats = 0;
    for (let i = 1; i < melody.length; i += 2) totalBeats += melody[i];
    const loopLen = totalBeats * beat;

    let when = this.ctx.currentTime + 0.15;
    const playLoop = () => {
      if (!this.musicOn) return;
      let tm = when;
      for (let i = 0; i < melody.length; i += 2) {
        const m = melody[i];
        const d = melody[i + 1] * beat;
        if (m) this._tone(midiToFreq(m), tm, d * 0.92, 'triangle', 0.11);
        tm += d;
      }
      let tb = when;
      for (let i = 0; i < bass.length; i += 2) {
        const m = bass[i];
        const d = bass[i + 1] * beat;
        if (m) this._tone(midiToFreq(m), tb, d * 0.95, 'sine', 0.16);
        tb += d;
      }
      when += loopLen;
      this._musicTimer = setTimeout(playLoop, loopLen * 1000 - 60);
    };
    playLoop();
  }

  _scheduleGull() {
    const tick = () => {
      if (this.ready && Math.random() < 0.6) {
        this._pos.set((Math.random() - 0.5) * 120, 40 + Math.random() * 30, (Math.random() - 0.5) * 120);
        this.gull(this._pos);
      }
      this._gullTimer = setTimeout(tick, 5000 + Math.random() * 9000);
    };
    this._gullTimer = setTimeout(tick, 4000);
  }

  // Keep the 3D listener glued to the camera.
  updateListener(camera) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    camera.getWorldDirection(this._fwd);
    this._up.copy(camera.up).applyQuaternion(camera.quaternion);
    const p = camera.position;
    if (l.positionX) {
      const tc = this.ctx.currentTime;
      l.positionX.setTargetAtTime(p.x, tc, 0.02);
      l.positionY.setTargetAtTime(p.y, tc, 0.02);
      l.positionZ.setTargetAtTime(p.z, tc, 0.02);
      l.forwardX.setTargetAtTime(this._fwd.x, tc, 0.02);
      l.forwardY.setTargetAtTime(this._fwd.y, tc, 0.02);
      l.forwardZ.setTargetAtTime(this._fwd.z, tc, 0.02);
      l.upX.setTargetAtTime(this._up.x, tc, 0.02);
      l.upY.setTargetAtTime(this._up.y, tc, 0.02);
      l.upZ.setTargetAtTime(this._up.z, tc, 0.02);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(this._fwd.x, this._fwd.y, this._fwd.z, this._up.x, this._up.y, this._up.z);
    }
  }
}
