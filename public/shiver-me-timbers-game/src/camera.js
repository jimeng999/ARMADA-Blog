// Third-person spring-arm camera. Yaw/pitch are world-absolute so the player
// can freely pan all the way around the ship to aim broadsides, while the rig
// springs (smoothly lerps) toward the ideal position behind/above the hull.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp } from './util.js';

export class SpringArmCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI; // start astern of a +Z-facing ship
    this.pitch = THREE.MathUtils.degToRad(20);
    this._target = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._curLook = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._initialized = false;
  }

  addMouse(dx, dy) {
    this.yaw -= dx * CONFIG.camera.sensitivity;
    this.pitch = clamp(
      this.pitch + dy * CONFIG.camera.sensitivity,
      CONFIG.camera.minPitch,
      CONFIG.camera.maxPitch
    );
  }

  update(dt, ship) {
    const rig = ship.cameraRig || CONFIG.camera;
    ship.worldPos(this._target);
    this._target.y += rig.aimHeight ?? CONFIG.camera.aimHeight;

    const d = rig.distance ?? CONFIG.camera.distance;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    this._desired.set(
      this._target.x + Math.sin(this.yaw) * cp * d,
      this._target.y + sp * d + 2,
      this._target.z + Math.cos(this.yaw) * cp * d
    );
    if (this._desired.y < 2.5) this._desired.y = 2.5; // never dunk the camera

    if (!this._initialized) {
      this.camera.position.copy(this._desired);
      this._curLook.copy(this._target);
      this._initialized = true;
    } else {
      const lp = CONFIG.camera.posLambda;
      this.camera.position.x = damp(this.camera.position.x, this._desired.x, lp, dt);
      this.camera.position.y = damp(this.camera.position.y, this._desired.y, lp, dt);
      this.camera.position.z = damp(this.camera.position.z, this._desired.z, lp, dt);
      const ll = CONFIG.camera.lookLambda;
      this._curLook.x = damp(this._curLook.x, this._target.x, ll, dt);
      this._curLook.y = damp(this._curLook.y, this._target.y, ll, dt);
      this._curLook.z = damp(this._curLook.z, this._target.z, ll, dt);
    }
    this.camera.lookAt(this._curLook);
  }

  // Horizontal aim direction (camera forward projected onto the sea plane).
  aimDir(out) {
    this.camera.getWorldDirection(this._dir);
    out.set(this._dir.x, 0, this._dir.z);
    if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
    else out.normalize();
    return out;
  }
}
