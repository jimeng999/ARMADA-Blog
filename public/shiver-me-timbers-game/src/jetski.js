// The player's ride: a fast, nimble jet ski with a REAR-mounted machine gun on
// a yaw turret (drive forward, swivel the gun to rake the galleons chasing your
// wake). Reuses the Ammo body + Gerstner buoyancy pattern but is engine-driven
// (throttle, not sails) and far more agile. Exposes the same interface the
// camera / HUD / combat expect, so it drops in where a Ship would.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { getWaveHeight } from './waves.js';
import { clamp, damp } from './util.js';

let _idCounter = 9000;

function mat(color, rough = 0.6, metal = 0.1) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true });
}

function buildJetskiMesh(opts = {}) {
  const { hullColor = 0xd8392b, trimColor = 0xf2f2f2, riderColor = 0x1b2a44 } = opts;
  const root = new THREE.Group();
  const model = new THREE.Group(); // banked/pitched for feel (cosmetic only)
  root.add(model);

  const hullMat = mat(hullColor, 0.5, 0.15);
  const trimMat = mat(trimColor, 0.45);
  const blackMat = mat(0x15151a, 0.6);
  const gunMat = mat(0x23262b, 0.45, 0.7);

  // --- Hull: deform a box into a pointed, vee'd, nose-up jet-ski hull ---
  const L = 4.8;
  const B = 1.9;
  const H = 1.0;
  const g = new THREE.BoxGeometry(B, H, L, 3, 2, 8);
  const pos = g.attributes.position;
  const HZ = L / 2;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const zf = v.z / HZ;
    const yf = (v.y + H / 2) / H;
    if (zf > 0) v.x *= 1 - 0.72 * Math.pow(zf, 1.8); // pointed bow
    else v.x *= 1 - 0.12 * Math.pow(-zf, 2.0);
    v.x *= 0.5 + 0.5 * yf; // vee bottom
    if (zf > 0.45 && yf > 0.5) v.y += Math.pow(zf, 2.2) * 0.7; // nose up
    if (yf < 0.4) v.y += Math.pow(Math.abs(zf), 2.4) * 0.4; // rocker
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  model.add(new THREE.Mesh(g, hullMat));

  // Cowling / dash up front
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 1.4), trimMat);
  cowl.position.set(0, 0.75, 0.9);
  model.add(cowl);

  // Seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 1.6), blackMat);
  seat.position.set(0, 0.7, -0.4);
  model.add(seat);

  // Handlebars
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), blackMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.05, 1.35);
  model.add(bar);
  for (const sx of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.28, 6), blackMat);
    grip.rotation.z = Math.PI / 2;
    grip.position.set(sx * 0.5, 1.05, 1.35);
    model.add(grip);
  }

  // Rider (low-poly): torso, head, arms reaching the bars
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.6), mat(riderColor, 0.8));
  torso.position.set(0, 1.35, -0.1);
  torso.rotation.x = -0.3;
  model.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), mat(0xe8b58a, 0.8));
  head.position.set(0, 1.95, 0.05);
  model.add(head);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.95), mat(riderColor, 0.8));
    arm.position.set(sx * 0.32, 1.45, 0.6);
    arm.rotation.x = 0.7;
    model.add(arm);
  }

  // Rear platform for the gun mount
  const platform = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.2, 0.9), blackMat);
  platform.position.set(0, 0.62, -1.9);
  model.add(platform);

  // --- Rear-mounted machine-gun turret (child of ROOT so banking doesn't
  //     twist the aim). Rest orientation: barrel points astern (local -Z). ---
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0, 0.95, -2.0);
  root.add(gunPivot);

  const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.5, 8), gunMat);
  mount.position.y = -0.15;
  gunPivot.add(mount);
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.7), gunMat);
  receiver.position.set(0, 0.1, -0.2);
  gunPivot.add(receiver);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.4, 8), gunMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.12, -0.9);
  gunPivot.add(barrel);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 12), gunMat);
  drum.rotation.x = Math.PI / 2;
  drum.position.set(0, 0.0, -0.1);
  gunPivot.add(drum);

  root.userData.model = model;
  root.userData.gunPivot = gunPivot;
  root.userData.muzzleLocal = new THREE.Vector3(0, 0.12, -1.6); // barrel tip
  root.userData.sprayLocal = new THREE.Vector3(0, -0.1, -2.3);
  root.userData.dims = { ...CONFIG.jetski.half };
  root.userData.topAnchor = new THREE.Vector3(0, 2.4, 0);
  return root;
}

export class Jetski {
  constructor({ physics, scene, position }) {
    this.id = _idCounter++;
    this.physics = physics;
    this.isPlayer = true;
    this.isJetski = true;
    this.faction = 'player';
    this.name = 'Sea Serpent';

    this.mesh = buildJetskiMesh();
    scene.add(this.mesh);
    this.model = this.mesh.userData.model;
    this.gunPivot = this.mesh.userData.gunPivot;
    this.muzzleLocal = this.mesh.userData.muzzleLocal;
    this.sprayLocal = this.mesh.userData.sprayLocal;
    this.dims = this.mesh.userData.dims;

    this.maxHealth = CONFIG.jetski.maxHealth;
    this.health = this.maxHealth;
    this.alive = true;
    this.sinking = false;
    this.sinkT = 0;
    this.removed = false;

    this.throttle = 0; // 0..1 forward
    this.throttleInput = 0; // -1..1 (W/S)
    this.rudder = 0;
    this.rudderInput = 0;
    this.sail = 0; // mirrors throttle for the HUD
    this.sailEff = 1; // never "in irons"
    this.submergedFrac = 0;
    this.wantFire = false;

    this.aimDir = new THREE.Vector3(0, 0, 1); // horizontal, for turret yaw
    this.aimDir3D = new THREE.Vector3(0, 0, 1); // full, for bullets

    this.cameraRig = CONFIG.jetski.cameraRig;

    this.body = physics.createBoxBody({ half: CONFIG.jetski.half, mass: CONFIG.jetski.mass, position });
    this.body.setDamping(CONFIG.jetski.waterLinearDamp, CONFIG.jetski.waterAngularDamp);

    this._wp = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._vAtP = [0, 0, 0];
    this.floatPoints = CONFIG.jetski.floatPoints.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
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
  canFire() {
    return this.alive && !this.sinking;
  }

  damage(amount) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.alive = false;
      this.sinking = true;
      this.sinkT = 0;
      this.body.setDamping(0.4, 0.6);
    }
  }

  getMuzzleWorld(out) {
    this.gunPivot.updateWorldMatrix(true, false);
    return out.copy(this.muzzleLocal).applyMatrix4(this.gunPivot.matrixWorld);
  }

  aimGun() {
    this._tmp.copy(this.aimDir);
    this._q.copy(this.mesh.quaternion).invert();
    this._tmp.applyQuaternion(this._q); // aim in hull-local space
    this.gunPivot.rotation.y = Math.atan2(-this._tmp.x, -this._tmp.z);
  }

  update(dt, env) {
    this.physics.syncMesh(this.body, this.mesh);

    if (this.sinking) {
      this.updateSinking(dt, env);
      return;
    }

    const J = CONFIG.jetski;

    // Throttle (W ramps up, release coasts down). S = reverse.
    const target = this.throttleInput > 0 ? 1 : 0;
    this.throttle = damp(this.throttle, target, J.throttleRate, dt);
    this.sail = this.throttle;

    // Rudder (A/D) with auto-centre
    if (this.rudderInput !== 0) {
      this.rudder = clamp(this.rudder + this.rudderInput * J.rudderRate * dt, -1, 1);
    } else {
      this.rudder = damp(this.rudder, 0, J.rudderCenterRate, dt);
    }

    this.applyBuoyancy(dt, env, 1);

    // Engine thrust along heading (+ reverse on S)
    const fwd = this.forward();
    const hlen = Math.hypot(fwd.x, fwd.z) || 1;
    const hx = fwd.x / hlen;
    const hz = fwd.z / hlen;
    let drive = this.throttle * J.enginePower;
    if (this.throttleInput < 0) drive = -J.reversePower;
    this.physics.applyCentralForce(this.body, hx * drive, 0, hz * drive);

    // Planing lift: rides higher the faster she goes (only while touching water,
    // so she can still leap off a crest). Capped so she never truly flies.
    if (this.submergedFrac > 0) {
      const lv = this.body.getLinearVelocity();
      const fwdSpeed = Math.max(0, lv.x() * hx + lv.z() * hz);
      const lift = Math.min(J.planingLift * fwdSpeed, CONFIG.jetski.mass * 8);
      this.physics.applyCentralForce(this.body, 0, lift, 0);
    }

    // Steering — bites even at low speed (thrust steering)
    const resp = clamp(this.speed() / J.steerSpeedRef, J.steerMinResponse, 1);
    this.physics.applyTorque(this.body, 0, -this.rudder * J.turnTorque * resp, 0);

    this.applyRighting();

    // Cosmetic lean + nose-up
    const spd = this.speed();
    this.model.rotation.z = -this.rudder * J.bankFactor * clamp(spd / 8, 0, 1);
    this.model.rotation.x = -this.throttle * J.pitchFactor;

    // Rooster-tail spray at speed
    if (spd > J.sprayThreshold && this.submergedFrac > 0 && env.particles) {
      this._wp.copy(this.sprayLocal).applyMatrix4(this.mesh.matrixWorld);
      env.particles.emit('splash', this._wp, 2);
    }

    this.aimGun();
    this.mesh.updateMatrixWorld(); // refresh turret/muzzle for this frame's firing
  }

  applyBuoyancy(dt, env, scale) {
    const J = CONFIG.jetski;
    const body = this.body;
    const t = env.time;
    const m = this.mesh.matrixWorld;
    const perPoint = J.buoyancyPerPoint * scale;
    const o = body.getWorldTransform().getOrigin();
    const ox = o.x();
    const oy = o.y();
    const oz = o.z();
    let submerged = 0;
    for (let i = 0; i < this.floatPoints.length; i++) {
      this._wp.copy(this.floatPoints[i]).applyMatrix4(m);
      const depth = getWaveHeight(this._wp.x, this._wp.z, t) - this._wp.y;
      if (depth <= 0) continue;
      submerged++;
      const sub = Math.min(depth, J.submergeForFull);
      this.physics.getVelocityAtPoint(body, this._wp.x, this._wp.y, this._wp.z, this._vAtP);
      let force = perPoint * sub - this._vAtP[1] * perPoint * 0.18;
      if (force < 0) force = 0;
      this.physics.applyForce(body, 0, force, 0, this._wp.x - ox, this._wp.y - oy, this._wp.z - oz);
    }
    this.submergedFrac = submerged / this.floatPoints.length;
  }

  applyRighting() {
    const up = this._up.set(0, 1, 0).applyQuaternion(this.mesh.quaternion);
    const k = CONFIG.jetski.rightingTorque;
    const av = this.body.getAngularVelocity();
    this.physics.applyTorque(this.body, -up.z * k - av.x() * k * 0.1, 0, up.x * k - av.z() * k * 0.1);
  }

  updateSinking(dt, env) {
    this.sinkT += dt;
    const fade = clamp(1 - this.sinkT / 4, 0, 1) * 0.5;
    if (fade > 0.01) this.applyBuoyancy(dt, env, fade);
    this.physics.applyTorque(this.body, 400, 0, 900);
    if (env.particles && Math.random() < 0.6) {
      this._wp.set((Math.random() - 0.5) * 1.5, 1, (Math.random() - 0.5) * 3).applyMatrix4(this.mesh.matrixWorld);
      env.particles.emit('smoke', this._wp, 2);
      if (Math.random() < 0.4) env.particles.emit('fire', this._wp, 1);
    }
    if (this.mesh.position.y < -10) this.removed = true;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.physics.removeBody(this.body);
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose());
      }
    });
  }
}
