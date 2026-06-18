// Ammo.js (WebAssembly) world wrapper + reusable helpers. Keeps all the btXxx
// allocation churn in one place and provides scratch objects so the per-frame
// hot path (buoyancy forces, mesh sync) allocates nothing on the WASM heap.
import * as THREE from 'three';

let AmmoLib = null;

export async function initAmmo() {
  if (typeof window.Ammo !== 'function') {
    throw new Error('Ammo factory missing — lib/ammo/ammo.wasm.js did not load.');
  }
  AmmoLib = await window.Ammo({ locateFile: (p) => `./lib/ammo/${p}` });
  return AmmoLib;
}

export class PhysicsWorld {
  constructor(Ammo, gravityY) {
    this.Ammo = Ammo;
    const config = new Ammo.btDefaultCollisionConfiguration();
    this.dispatcher = new Ammo.btCollisionDispatcher(config);
    const broadphase = new Ammo.btDbvtBroadphase();
    const solver = new Ammo.btSequentialImpulseConstraintSolver();
    this.world = new Ammo.btDiscreteDynamicsWorld(this.dispatcher, broadphase, solver, config);

    const g = new Ammo.btVector3(0, gravityY, 0);
    this.world.setGravity(g);
    Ammo.destroy(g);

    // Scratch — reused every frame, never freed.
    this._t = new Ammo.btTransform();
    this._fa = new Ammo.btVector3();
    this._fb = new Ammo.btVector3();
  }

  step(dt) {
    // Clamp the frame delta and run fixed 120Hz substeps for a stable hull.
    this.world.stepSimulation(Math.min(dt, 0.05), 8, 1 / 120);
  }

  createBoxBody({ half, mass, position }) {
    const A = this.Ammo;
    const he = new A.btVector3(half.x, half.y, half.z);
    const shape = new A.btBoxShape(he);
    A.destroy(he);
    shape.setMargin(0.04);
    return this._finishBody(shape, mass, position, null);
  }

  createSphereBody({ radius, mass, position, velocity }) {
    const shape = new this.Ammo.btSphereShape(radius);
    shape.setMargin(0.02);
    return this._finishBody(shape, mass, position, velocity);
  }

  _finishBody(shape, mass, position, velocity) {
    const A = this.Ammo;
    const t = new A.btTransform();
    t.setIdentity();
    const o = new A.btVector3(position.x, position.y, position.z);
    t.setOrigin(o);
    const ms = new A.btDefaultMotionState(t);
    const inertia = new A.btVector3(0, 0, 0);
    if (mass > 0) shape.calculateLocalInertia(mass, inertia);
    const info = new A.btRigidBodyConstructionInfo(mass, ms, shape, inertia);
    const body = new A.btRigidBody(info);
    body.setActivationState(4); // DISABLE_DEACTIVATION — ships/balls never sleep
    if (velocity) {
      const v = new A.btVector3(velocity.x, velocity.y, velocity.z);
      body.setLinearVelocity(v);
      A.destroy(v);
    }
    this.world.addRigidBody(body);
    A.destroy(o);
    A.destroy(inertia);
    A.destroy(info);
    A.destroy(t);
    return body;
  }

  removeBody(body) {
    const A = this.Ammo;
    const ms = body.getMotionState();
    const shape = body.getCollisionShape();
    this.world.removeRigidBody(body);
    A.destroy(body);
    if (ms) A.destroy(ms);
    if (shape) A.destroy(shape);
  }

  // Copy a rigid body's world transform onto a Three.js object.
  syncMesh(body, mesh) {
    body.getMotionState().getWorldTransform(this._t);
    const o = this._t.getOrigin();
    const r = this._t.getRotation();
    mesh.position.set(o.x(), o.y(), o.z());
    mesh.quaternion.set(r.x(), r.y(), r.z(), r.w());
    mesh.updateMatrixWorld();
  }

  bodyPosition(body, out) {
    body.getMotionState().getWorldTransform(this._t);
    const o = this._t.getOrigin();
    out.set(o.x(), o.y(), o.z());
    return out;
  }

  applyCentralForce(body, x, y, z) {
    this._fa.setValue(x, y, z);
    body.applyCentralForce(this._fa);
  }

  applyForce(body, fx, fy, fz, rx, ry, rz) {
    this._fa.setValue(fx, fy, fz);
    this._fb.setValue(rx, ry, rz);
    body.applyForce(this._fa, this._fb);
  }

  applyTorque(body, x, y, z) {
    this._fa.setValue(x, y, z);
    body.applyTorque(this._fa);
  }

  applyCentralImpulse(body, x, y, z) {
    this._fa.setValue(x, y, z);
    body.applyCentralImpulse(this._fa);
  }

  // Velocity of the material point at world (px,py,pz): v = vLinear + ω × r.
  getVelocityAtPoint(body, px, py, pz, out) {
    const lv = body.getLinearVelocity();
    const av = body.getAngularVelocity();
    const t = body.getWorldTransform();
    const o = t.getOrigin();
    const rx = px - o.x();
    const ry = py - o.y();
    const rz = pz - o.z();
    const ax = av.x();
    const ay = av.y();
    const az = av.z();
    out[0] = lv.x() + (ay * rz - az * ry);
    out[1] = lv.y() + (az * rx - ax * rz);
    out[2] = lv.z() + (ax * ry - ay * rx);
    return out;
  }
}
