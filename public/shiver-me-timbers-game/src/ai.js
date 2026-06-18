// Enemy galleon brain — a small state machine (Wander → Chase → Broadside →
// Flee) that drives the SAME Ship controls the player uses (sail trim, rudder,
// fire). It steers toward a desired heading and looses a broadside when the
// quarry is abeam, in range, and the guns are loaded.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, wrapAngle, randRange, degToRad } from './util.js';

const ARC = degToRad(CONFIG.ai.broadsideArcDeg);

export class AIController {
  constructor(ship) {
    this.ship = ship;
    this.state = 'WANDER';
    this.wanderAngle = randRange(0, Math.PI * 2);
    this.wanderTimer = 0;
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._self = new THREE.Vector3();
    this._tgt = new THREE.Vector3();
  }

  update(dt, env, target, cannons) {
    const ship = this.ship;
    if (!ship.alive) return;

    ship.worldPos(this._self);
    let dist = Infinity;
    let bearing = 0;
    const hasTarget = target && target.alive;
    if (hasTarget) {
      target.worldPos(this._tgt);
      const dx = this._tgt.x - this._self.x;
      const dz = this._tgt.z - this._self.z;
      dist = Math.hypot(dx, dz);
      bearing = Math.atan2(dz, dx);
    }

    // Transitions (priority: flee > broadside > chase > wander)
    if (ship.health <= CONFIG.ai.fleeHealth && hasTarget) this.state = 'FLEE';
    else if (hasTarget && dist < CONFIG.ai.fireRange) this.state = 'BROADSIDE';
    else if (hasTarget && dist < CONFIG.ai.aggroRadius) this.state = 'CHASE';
    else this.state = 'WANDER';

    const fwd = ship.forward(this._fwd);
    const heading = Math.atan2(fwd.z, fwd.x);
    const right = ship.right(this._right);
    const rightAngle = Math.atan2(right.z, right.x);

    let desired = heading;
    let targetSail = 0.6;

    switch (this.state) {
      case 'WANDER': {
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0) {
          this.wanderAngle += randRange(-1, 1) * 0.9;
          this.wanderTimer = randRange(3, 6.5);
        }
        desired = this.wanderAngle;
        targetSail = 0.5;
        break;
      }
      case 'CHASE': {
        desired = bearing;
        targetSail = 1.0;
        break;
      }
      case 'BROADSIDE': {
        // Present whichever beam the quarry is nearer; circle to keep it abeam.
        const dStar = wrapAngle(bearing - rightAngle);
        const onStarboard = Math.abs(dStar) < Math.PI / 2;
        const side = onStarboard ? 'starboard' : 'port';
        desired = bearing + (onStarboard ? Math.PI / 2 : -Math.PI / 2);
        targetSail = dist < CONFIG.ai.fireRangeMin * 2.4 ? 0.5 : 0.85;

        const beamDiff = onStarboard
          ? dStar
          : wrapAngle(bearing - (rightAngle + Math.PI));
        if (
          Math.abs(beamDiff) < ARC &&
          dist > CONFIG.ai.fireRangeMin &&
          dist < CONFIG.ai.fireRange &&
          ship.canFire(side)
        ) {
          cannons.fireBroadside(ship, side, env);
        }
        break;
      }
      case 'FLEE': {
        desired = Math.atan2(this._self.z - this._tgt.z, this._self.x - this._tgt.x);
        targetSail = 1.0;
        break;
      }
    }

    // Steer toward desired heading.
    const err = wrapAngle(desired - heading);
    ship.rudderInput = clamp(err * CONFIG.ai.steerGain, -1, 1);

    // Drive sail trim toward the target with a small deadband.
    const ds = targetSail - ship.sail;
    ship.throttleInput = Math.abs(ds) > 0.04 ? Math.sign(ds) : 0;
  }
}
