// Broadside ballistics. Firing a side queues a *rolling* broadside (guns go off
// bow-to-stern, boom-boom-boom). Each ball is a real Ammo rigid body so it
// arcs under gravity; we add per-step wind + air drag so the player must lead
// targets. Collisions (vs the wave surface and vs ship hulls) are resolved with
// cheap manual tests for robustness, then the ball is destroyed.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { getWaveHeight } from './waves.js';
import { degToRad, randRange } from './util.js';

export class CannonSystem {
  constructor(physics, scene, particles) {
    this.physics = physics;
    this.scene = scene;
    this.particles = particles;
    this.balls = [];
    this.pending = [];

    this.ballGeo = new THREE.SphereGeometry(CONFIG.cannon.ballRadius, 10, 8);
    this.ballMat = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.5, metalness: 0.65 });

    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._vel = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._inv = new THREE.Matrix4();
    this._local = new THREE.Vector3();
  }

  // Returns true if the broadside was loosed (side was loaded).
  fireBroadside(ship, side, env) {
    if (!ship.canFire(side)) return false;
    ship.markFired(side);
    const muzzles = ship.muzzles[side];
    const sideSign = side === 'starboard' ? 1 : -1;
    for (let i = 0; i < muzzles.length; i++) {
      this.pending.push({
        ship,
        sideSign,
        local: muzzles[i],
        t: i * CONFIG.cannon.rollDelay,
        env,
      });
    }
    return true;
  }

  _spawnBall(shot) {
    const { ship, sideSign, local, env } = shot;
    if (!ship.alive) return; // she went down before this gun spoke

    const muzzleWorld = this._tmp.copy(local).applyMatrix4(ship.mesh.matrixWorld);

    // Aim: ship's beam outward, elevated, with a little random spread.
    const aim = ship.right(this._dir).multiplyScalar(sideSign);
    const elev = degToRad(CONFIG.cannon.elevationDeg);
    aim.multiplyScalar(Math.cos(elev));
    aim.y += Math.sin(elev);
    aim.normalize();
    const spread = degToRad(CONFIG.cannon.spreadDeg);
    aim.applyAxisAngle(this._up, randRange(-spread, spread));
    aim.y += randRange(-spread, spread) * 0.5;
    aim.normalize();

    const speed = CONFIG.cannon.muzzleSpeed;
    ship.getVelocity(this._vel); // inherit the firing ship's velocity
    const velocity = {
      x: aim.x * speed + this._vel.x,
      y: aim.y * speed + this._vel.y,
      z: aim.z * speed + this._vel.z,
    };

    const body = this.physics.createSphereBody({
      radius: CONFIG.cannon.ballRadius,
      mass: CONFIG.cannon.ballMass,
      position: muzzleWorld,
      velocity,
    });
    const mesh = new THREE.Mesh(this.ballGeo, this.ballMat);
    mesh.position.copy(muzzleWorld);
    this.scene.add(mesh);
    this.balls.push({ body, mesh, life: CONFIG.cannon.life, ownerId: ship.id });

    // Muzzle FX + recoil + report
    this.particles.emit('flash', muzzleWorld, 6, aim);
    this.particles.emit('muzzle', muzzleWorld, 12, aim);
    this.physics.applyCentralImpulse(
      ship.body,
      -aim.x * CONFIG.cannon.recoilImpulse,
      0,
      -aim.z * CONFIG.cannon.recoilImpulse
    );
    if (env.audio) env.audio.cannon(muzzleWorld);
  }

  update(dt, env, ships) {
    // Release scheduled (rolling) shots whose delay has elapsed.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i];
      s.t -= dt;
      if (s.t <= 0) {
        this._spawnBall(s);
        this.pending.splice(i, 1);
      }
    }

    const drag = CONFIG.cannon.ballDrag;
    const windInf = CONFIG.cannon.windInfluence;
    const ballR = CONFIG.cannon.ballRadius;

    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      this.physics.syncMesh(b.body, b.mesh);
      b.life -= dt;

      // Wind push + quadratic air drag (so shots curve with the gale).
      const lv = b.body.getLinearVelocity();
      const vx = lv.x();
      const vy = lv.y();
      const vz = lv.z();
      this.physics.applyCentralForce(
        b.body,
        env.wind.dir.x * env.wind.strength * windInf - vx * drag * Math.abs(vx),
        -vy * drag * Math.abs(vy),
        env.wind.dir.z * env.wind.strength * windInf - vz * drag * Math.abs(vz)
      );

      const px = b.mesh.position.x;
      const py = b.mesh.position.y;
      const pz = b.mesh.position.z;

      // Splash on the wave surface
      if (py <= getWaveHeight(px, pz, env.time)) {
        this._tmp.set(px, getWaveHeight(px, pz, env.time), pz);
        this.particles.emit('splash', this._tmp, 16);
        if (env.audio) env.audio.splash(this._tmp);
        this._remove(i, b);
        continue;
      }

      // Hull intersection (AABB in each ship's local space)
      let consumed = false;
      for (let s = 0; s < ships.length; s++) {
        const ship = ships[s];
        if (!ship.alive || ship.id === b.ownerId) continue;
        this._inv.copy(ship.mesh.matrixWorld).invert();
        this._local.set(px, py, pz).applyMatrix4(this._inv);
        const h = ship.dims;
        if (
          Math.abs(this._local.x) < h.x + ballR &&
          Math.abs(this._local.y) < h.y + ballR + 1.8 &&
          Math.abs(this._local.z) < h.z + ballR
        ) {
          this._tmp.set(px, py, pz);
          this.particles.emit('splinter', this._tmp, 18);
          this.particles.emit('fire', this._tmp, 8);
          this.particles.emit('smoke', this._tmp, 5);
          ship.damage(CONFIG.cannon.damage);
          if (env.audio) env.audio.hit(this._tmp);
          if (env.onHit) env.onHit(ship, b.ownerId);
          this._remove(i, b);
          consumed = true;
          break;
        }
      }
      if (consumed) continue;

      if (b.life <= 0) this._remove(i, b);
    }
  }

  _remove(index, b) {
    this.scene.remove(b.mesh);
    this.physics.removeBody(b.body);
    this.balls.splice(index, 1);
  }

  clear() {
    for (const b of this.balls) {
      this.scene.remove(b.mesh);
      this.physics.removeBody(b.body);
    }
    this.balls.length = 0;
    this.pending.length = 0;
  }
}
