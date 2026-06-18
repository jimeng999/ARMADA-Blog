// Global wind vector — a dynamic, shifting Vector3 (direction it blows TOWARD).
// Direction and strength wander smoothly via summed sines. 0deg = +X, 90deg = +Z,
// matching the wave direction convention so HUD and sailing math agree.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, degToRad, TAU } from './util.js';

export class Wind {
  constructor() {
    this.angle = degToRad(CONFIG.wind.initialDeg);
    this.strength = CONFIG.wind.strength;
    this.dir = new THREE.Vector3(Math.cos(this.angle), 0, Math.sin(this.angle));
    this._t = 0;
    this._p1 = Math.random() * TAU;
    this._p2 = Math.random() * TAU;
  }

  update(dt) {
    this._t += dt;
    const drift =
      (Math.sin(this._t * 0.05 + this._p1) + 0.5 * Math.sin(this._t * 0.13 + this._p2)) *
      CONFIG.wind.dirDriftRate;
    this.angle += drift * dt;
    this.dir.set(Math.cos(this.angle), 0, Math.sin(this.angle));

    const s = 0.5 * (Math.sin(this._t * 0.07 + this._p2) + 1); // 0..1
    this.strength = clamp(
      CONFIG.wind.minStrength + s * (CONFIG.wind.maxStrength - CONFIG.wind.minStrength),
      CONFIG.wind.minStrength,
      CONFIG.wind.maxStrength
    );
  }
}
