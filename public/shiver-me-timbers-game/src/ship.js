// A galleon entity: procedural mesh + Ammo rigid body + buoyancy, sailing, and
// damage/sinking behaviour. Both the player and the AI scallywags are Ships;
// only the source of their control inputs differs.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { getWaveHeight } from './waves.js';
import { createGalleon } from './galleon.js';
import { clamp, damp, smoothstep } from './util.js';

let _idCounter = 0;

export class Ship {
  constructor({ physics, scene, position, faction = 'enemy', isPlayer = false, galleonOpts }) {
    this.id = _idCounter++;
    this.physics = physics;
    this.faction = faction;
    this.isPlayer = isPlayer;
    this.name = isPlayer ? 'The Black Gambit' : 'Marauder';

    this.mesh = createGalleon(galleonOpts);
    scene.add(this.mesh);
    this.dims = this.mesh.userData.dims;
    this.muzzles = this.mesh.userData.muzzles;

    this.maxHealth = CONFIG.ship.maxHealth;
    this.health = this.maxHealth;
    this.alive = true;
    this.sinking = false;
    this.sinkT = 0;
    this.removed = false;

    // Control state
    this.sail = isPlayer ? 0 : 0.4; // trim 0..1
    this.throttleInput = 0; // -1..1 (raise/furl)
    this.rudder = 0; // -1..1 actual deflection
    this.rudderInput = 0; // -1..1 command
    this.sailEff = 0;
    this.submergedFrac = 0;

    this.reload = { port: 0, starboard: 0 };

    // Rigid body
    this.body = physics.createBoxBody({
      half: CONFIG.ship.half,
      mass: CONFIG.ship.mass,
      position,
    });
    this.body.setDamping(CONFIG.ship.waterLinearDamp, CONFIG.ship.waterAngularDamp);

    // Scratch
    this._wp = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._vAtP = [0, 0, 0];
    this.floatPoints = CONFIG.ship.floatPoints.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  }

  worldPos(out = this._wp) {
    return out.copy(this.mesh.position);
  }
  forward(out = this._fwd) {
    return out.set(0, 0, 1).applyQuaternion(this.mesh.quaternion);
  }
  right(out = this._right) {
    return out.set(1, 0, 0).applyQuaternion(this.mesh.quaternion);
  }
  getVelocity(out) {
    const lv = this.body.getLinearVelocity();
    return out.set(lv.x(), lv.y(), lv.z());
  }
  speed() {
    const lv = this.body.getLinearVelocity();
    return Math.hypot(lv.x(), lv.z());
  }

  canFire(side) {
    return this.alive && !this.sinking && this.reload[side] <= 0;
  }
  markFired(side) {
    this.reload[side] = CONFIG.cannon.reload;
  }

  damage(amount) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.alive = false;
      this.sinking = true;
      this.sinkT = 0;
      this.body.setDamping(0.35, 0.55);
    }
  }

  update(dt, env) {
    // Reflect last step's physics onto the mesh before reading orientation.
    this.physics.syncMesh(this.body, this.mesh);

    if (this.sinking) {
      this.updateSinking(dt, env);
      return;
    }

    // Sail trim (W/S) and rudder (A/D with auto-centre)
    this.sail = clamp(this.sail + this.throttleInput * CONFIG.ship.sailTrimRate * dt, 0, 1);
    if (this.rudderInput !== 0) {
      this.rudder = clamp(this.rudder + this.rudderInput * CONFIG.ship.rudderRate * dt, -1, 1);
    } else {
      this.rudder = damp(this.rudder, 0, CONFIG.ship.rudderCenterRate, dt);
    }

    // Buoyancy rides a little lower as the hull takes damage (PBI flavour).
    const buoyScale = 0.7 + 0.3 * (this.health / this.maxHealth);
    this.applyBuoyancy(dt, env, buoyScale);

    // Sailing thrust — square-rig: stalls head-to-wind, fills off the wind.
    const fwd = this.forward();
    const hlen = Math.hypot(fwd.x, fwd.z) || 1;
    const hx = fwd.x / hlen;
    const hz = fwd.z / hlen;
    const wind = env.wind;
    const align = hx * wind.dir.x + hz * wind.dir.z; // -1 in irons .. +1 running
    const eff = smoothstep(-0.6, 0.12, align);
    this.sailEff = eff;
    const thrust = this.sail * wind.strength * CONFIG.ship.maxThrust * eff;
    this.physics.applyCentralForce(this.body, hx * thrust, 0, hz * thrust);

    // Steering — sluggish at low speed, responsive at full billow.
    const resp = clamp(this.speed() / CONFIG.ship.steerSpeedRef, CONFIG.ship.steerMinResponse, 1);
    const yaw = -this.rudder * CONFIG.ship.turnTorque * resp;
    this.physics.applyTorque(this.body, 0, yaw, 0);

    this.applyRighting();

    this.reload.port = Math.max(0, this.reload.port - dt);
    this.reload.starboard = Math.max(0, this.reload.starboard - dt);

    this.animateRig(env.time);
  }

  applyBuoyancy(dt, env, scale) {
    const body = this.body;
    const t = env.time;
    const m = this.mesh.matrixWorld;
    const perPoint = CONFIG.ship.buoyancyPerPoint * scale;
    const fullDepth = CONFIG.ship.submergeForFull;
    const o = body.getWorldTransform().getOrigin();
    const ox = o.x();
    const oy = o.y();
    const oz = o.z();
    let submerged = 0;

    for (let i = 0; i < this.floatPoints.length; i++) {
      this._wp.copy(this.floatPoints[i]).applyMatrix4(m);
      const waterH = getWaveHeight(this._wp.x, this._wp.z, t);
      const depth = waterH - this._wp.y;
      if (depth <= 0) continue;
      submerged++;
      const sub = Math.min(depth, fullDepth);
      this.physics.getVelocityAtPoint(body, this._wp.x, this._wp.y, this._wp.z, this._vAtP);
      // Hooke-like spring up + velocity damping to kill vertical oscillation.
      let force = perPoint * sub - this._vAtP[1] * perPoint * 0.16;
      if (force < 0) force = 0;
      this.physics.applyForce(body, 0, force, 0, this._wp.x - ox, this._wp.y - oy, this._wp.z - oz);
    }
    this.submergedFrac = submerged / this.floatPoints.length;
  }

  // Arcade self-righting: torque that rotates the ship's up-axis back toward
  // world-up. Gentle enough that waves still pitch and roll the hull.
  applyRighting() {
    const up = this._up.set(0, 1, 0).applyQuaternion(this.mesh.quaternion);
    const k = CONFIG.ship.rightingTorque;
    const av = this.body.getAngularVelocity();
    // axis = up × worldUp = (-up.z, 0, up.x)
    const tx = -up.z * k - av.x() * k * 0.09;
    const tz = up.x * k - av.z() * k * 0.09;
    this.physics.applyTorque(this.body, tx, 0, tz);
  }

  animateRig(t) {
    const furl = 0.16 + 0.84 * this.sail;
    const sails = this.mesh.userData.sails;
    for (let i = 0; i < sails.length; i++) sails[i].scale.y = furl;
    const flag = this.mesh.userData.flag;
    if (flag) {
      flag.rotation.y = Math.sin(t * 4 + this.id) * 0.5;
      flag.rotation.z = Math.sin(t * 6 + this.id) * 0.12;
    }
  }

  updateSinking(dt, env) {
    this.sinkT += dt;
    // Residual buoyancy fades over ~7s so she settles, then slips under.
    const fade = clamp(1 - this.sinkT / 7, 0, 1) * 0.5;
    if (fade > 0.01) this.applyBuoyancy(dt, env, fade);
    // List to starboard and pitch down by the bow for drama (no self-righting
    // now — let her roll over and slip beneath the swells).
    this.physics.applyTorque(this.body, 900, 0, 2600);

    if (env.particles) {
      if (Math.random() < 0.7) {
        this._wp.set((Math.random() - 0.5) * 4, 4 + Math.random() * 2, (Math.random() - 0.5) * 12).applyMatrix4(this.mesh.matrixWorld);
        env.particles.emit('smoke', this._wp, 2);
        if (Math.random() < 0.45) env.particles.emit('fire', this._wp, 1);
      }
    }
    if (this.mesh.position.y < -14) this.removed = true;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.physics.removeBody(this.body);
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((mm) => mm.dispose());
      }
    });
  }
}

// --- glTF loader hook -------------------------------------------------------
// Procedural galleons are the default. To swap in a real low-poly .gltf model,
// drop it under assets/ and call this, then parent it into a Ship's mesh group
// (you'll want to keep userData.muzzles / floatPoints from the procedural build,
// or re-author them to match your model). Lazily imports the addon so the core
// game never pays for it.
export async function loadShipModel(url) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  return gltf.scene;
}
