// Polled keyboard + pointer-lock mouse input. Held keys live in `keys`;
// one-shot intents (fire, restart) are latched as booleans the game loop reads
// and clears each frame. Mouse motion accumulates while the pointer is locked.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.enabled = false;

    // Held + one-shot intents
    this.firing = false; // left mouse held (machine gun)
    this.wantFire = false; // click — one-shot (broadside, if used)
    this.wantPort = false; // Q
    this.wantStarboard = false; // E
    this.wantRestart = false; // R

    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyQ') this.wantPort = true;
      if (e.code === 'KeyE') this.wantStarboard = true;
      if (e.code === 'KeyR') this.wantRestart = true;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) {
        this.canvas.requestPointerLock?.();
        return; // the lock-acquiring click does not fire
      }
      if (e.button === 0) {
        this.wantFire = true; // one-shot (broadsides, if a Ship is the player)
        this.firing = true; // held (machine gun)
      } else if (e.button === 2) {
        this.wantStarboard = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.firing = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
    });

    // If focus is lost, drop held keys/trigger so nothing runs away.
    window.addEventListener('blur', () => {
      this.keys = Object.create(null);
      this.firing = false;
    });
  }

  // True while the machine-gun trigger is held (mouse) or Space is down.
  isFiring() {
    return this.firing || !!this.keys['Space'];
  }

  requestLock() {
    this.canvas.requestPointerLock?.();
  }

  // Throttle from W/S as a -1..1 command (W raises sails, S furls).
  throttleAxis() {
    return (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
  }
  // Rudder from A/D: A = port (left), D = starboard (right).
  rudderAxis() {
    return (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
  }

  consumeMouse() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  // Read and clear the one-shot fire intents.
  consumeIntents() {
    const out = {
      fire: this.wantFire,
      port: this.wantPort,
      starboard: this.wantStarboard,
      restart: this.wantRestart,
    };
    this.wantFire = this.wantPort = this.wantStarboard = this.wantRestart = false;
    return out;
  }
}
