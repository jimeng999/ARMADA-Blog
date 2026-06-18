// Machine-gun bullet system. Bullets are lightweight CPU projectiles (not Ammo
// bodies — far too many per second for that) with a mild gravity drop, drawn as
// additive tracer points. Collisions vs. ship hulls and the wave surface are
// the same cheap manual tests the cannons use.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { getWaveHeight } from './waves.js';
import { degToRad, randRange } from './util.js';

const BULLET_R = 0.25;

export class BulletSystem {
  constructor(physics, scene, particles) {
    this.physics = physics;
    this.scene = scene;
    this.particles = particles;
    this.bullets = [];
    this.cooldown = 0;
    this.sfxCount = 0;

    this.max = 400;
    this.geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.max * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.PointsMaterial({
      color: 0xffe24a,
      size: 1.3,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this._tmp = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._sv = new THREE.Vector3();
    this._inv = new THREE.Matrix4();
    this._local = new THREE.Vector3();
  }

  // Attempt a shot (rate-limited). Call every frame while the trigger is held.
  fire(shooter, env, ships) {
    if (this.cooldown > 0 || !shooter.canFire()) return;
    const G = CONFIG.machineGun;
    this.cooldown = 1 / G.fireRate;

    const muzzle = shooter.getMuzzleWorld(this._tmp);
    // Fire toward the reticle bearing (horizontal), with a slight elevation so
    // rounds carry over the swell — NOT along the chase cam's downward look.
    this._dir.copy(shooter.aimDir);
    this._dir.y += 0.06;
    const spread = degToRad(G.spreadDeg);
    this._dir.x += randRange(-spread, spread);
    this._dir.y += randRange(-spread, spread) * 0.6;
    this._dir.z += randRange(-spread, spread);
    this._dir.normalize();

    shooter.getVelocity(this._sv);
    this.bullets.push({
      x: muzzle.x,
      y: muzzle.y,
      z: muzzle.z,
      vx: this._dir.x * G.speed + this._sv.x,
      vy: this._dir.y * G.speed + this._sv.y,
      vz: this._dir.z * G.speed + this._sv.z,
      life: G.life,
      ownerId: shooter.id,
    });

    this.particles.emit('flash', muzzle, 2, this._dir);
    this.particles.emit('muzzle', muzzle, 2, this._dir);
    this.physics.applyCentralImpulse(shooter.body, -this._dir.x * G.recoil, 0, -this._dir.z * G.recoil);

    this.sfxCount = (this.sfxCount + 1) % Math.max(1, G.sfxEvery);
    if (this.sfxCount === 0 && env.audio) env.audio.machineGun(muzzle);
  }

  update(dt, env, ships) {
    if (this.cooldown > 0) this.cooldown -= dt;
    const drop = CONFIG.machineGun.drop;
    let n = 0;

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      b.vy -= drop * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;

      const waterH = getWaveHeight(b.x, b.z, env.time);
      if (b.y <= waterH) {
        this._tmp.set(b.x, waterH, b.z);
        this.particles.emit('splash', this._tmp, 3);
        this.bullets.splice(i, 1);
        continue;
      }

      let hit = false;
      for (let s = 0; s < ships.length; s++) {
        const ship = ships[s];
        if (!ship.alive || ship.id === b.ownerId) continue;
        this._inv.copy(ship.mesh.matrixWorld).invert();
        this._local.set(b.x, b.y, b.z).applyMatrix4(this._inv);
        const h = ship.dims;
        if (
          Math.abs(this._local.x) < h.x + BULLET_R &&
          Math.abs(this._local.y) < h.y + BULLET_R + 1.8 &&
          Math.abs(this._local.z) < h.z + BULLET_R
        ) {
          this._tmp.set(b.x, b.y, b.z);
          this.particles.emit('splinter', this._tmp, 5);
          this.particles.emit('fire', this._tmp, 1);
          ship.damage(CONFIG.machineGun.damage);
          if (env.audio && env.audio.bulletHit) env.audio.bulletHit(this._tmp);
          if (env.onHit) env.onHit(ship, b.ownerId);
          this.bullets.splice(i, 1);
          hit = true;
          break;
        }
      }
      if (hit) continue;
      if (b.life <= 0) {
        this.bullets.splice(i, 1);
        continue;
      }

      if (n < this.max) {
        this.positions[n * 3] = b.x;
        this.positions[n * 3 + 1] = b.y;
        this.positions[n * 3 + 2] = b.z;
        n++;
      }
    }

    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
  }

  clear() {
    this.bullets.length = 0;
    this.geo.setDrawRange(0, 0);
    this.geo.attributes.position.needsUpdate = true;
  }
}
