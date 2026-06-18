// HUD layer: drives the DOM overlay declared in index.html — wind compass,
// helm telemetry, health, enemy tally, FPS, transient banners, the start/over
// screen, and floating enemy nameplates projected from world space.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.hud = $('hud');
    this.screen = $('screen');
    this.compass = $('compass');
    this.cctx = this.compass.getContext('2d');

    this.speedVal = $('speed-val');
    this.sailVal = $('sail-val');
    this.sailFill = $('sail-fill');
    this.rudderVal = $('rudder-val');
    this.rudderFill = $('rudder-fill');
    this.irons = $('irons');
    this.windKn = $('wind-kn');
    this.enemyCount = $('enemy-count');
    this.hpFill = $('hp-bar').querySelector('i');
    this.sailLabel = $('sail-label');
    this.playerName = $('player-name');
    this.fps = $('fps');
    this.banner = $('banner');
    this.fireSide = $('fire-side');
    this.nameplates = $('nameplates');

    this._plates = new Map();
    this._bannerTimer = 0;
    this._ndc = new THREE.Vector3();
    this._anchor = new THREE.Vector3();
  }

  setLive(on) {
    this.hud.classList.toggle('live', on);
  }

  // Relabel the helm panel + name to suit the player's vehicle.
  configureForPlayer(player) {
    const jet = !!player.isJetski;
    this.sailLabel.textContent = jet ? 'Throttle' : 'Sails';
    this.playerName.textContent = (jet ? '🌊 ' : '⚓ ') + player.name.toUpperCase();
  }

  hideScreen() {
    this.screen.classList.add('hidden');
  }

  showEndScreen(victory) {
    this.screen.classList.remove('hidden');
    this.screen.classList.toggle('over', !victory);
    $('screen-sub').textContent = victory
      ? 'The seas are yours, Captain. Every scallywag sleeps with the fishes.'
      : 'Yer ship is splinters and ye sleep with Davy Jones. Hoist again?';
    this.screen.querySelector('h1').textContent = victory ? 'Victory at Sea' : 'Davy Jones’ Locker';
    $('start-btn').textContent = victory ? '⚓ Sail Again' : '☠ Try Again';
  }

  flashBanner(text, duration = 2.2) {
    this.banner.textContent = text;
    this.banner.classList.add('show');
    this._bannerTimer = duration;
  }

  setBootMsg(text) {
    $('boot-msg').textContent = text;
  }

  update(dt, ctx) {
    const { player, wind, enemies, camera, width, height, fps } = ctx;

    // FPS
    this.fps.textContent = `${Math.round(fps)} fps`;
    this.fps.style.color = fps >= 45 ? 'rgba(160,224,150,0.85)' : fps >= 30 ? '#f0c560' : '#e8694f';

    // Telemetry
    if (player && player.alive) {
      const knots = player.speed() * 1.94384;
      this.speedVal.textContent = `${knots.toFixed(1)} kn`;
      this.sailVal.textContent = `${Math.round(player.sail * 100)}%`;
      this.sailFill.style.width = `${player.sail * 100}%`;

      const r = player.rudder;
      if (Math.abs(r) < 0.05) {
        this.rudderVal.textContent = 'amidships';
        this.rudderFill.style.left = '50%';
        this.rudderFill.style.width = '0%';
      } else if (r > 0) {
        this.rudderVal.textContent = `starb'd ${Math.round(r * 100)}%`;
        this.rudderFill.style.left = '50%';
        this.rudderFill.style.width = `${r * 50}%`;
      } else {
        const w = -r * 50;
        this.rudderVal.textContent = `port ${Math.round(-r * 100)}%`;
        this.rudderFill.style.left = `${50 - w}%`;
        this.rudderFill.style.width = `${w}%`;
      }

      const inIrons = player.sail > 0.12 && player.sailEff < 0.16;
      this.irons.classList.toggle('on', inIrons);

      const ratio = player.health / player.maxHealth;
      this.hpFill.style.width = `${ratio * 100}%`;
      this.hpFill.style.background =
        ratio > 0.5
          ? 'linear-gradient(90deg,#6fb43a,#a6e05a)'
          : ratio > 0.25
            ? 'linear-gradient(90deg,#d6a93a,#f0d24a)'
            : 'linear-gradient(90deg,#b3271b,#e8694f)';
    }

    // Wind compass + readout
    this._drawCompass(player, wind);
    this.windKn.textContent = `${(wind.strength * 18).toFixed(0)} kn`;

    // Enemy tally
    const aliveEnemies = enemies.filter((e) => e.ship.alive).length;
    this.enemyCount.textContent = aliveEnemies;

    // Banner fade
    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) this.banner.classList.remove('show');
    }

    // Enemy nameplates
    this._updatePlates(enemies, camera, width, height);
  }

  setFireSide(side) {
    this.fireSide.textContent = side ? (side === 'starboard' ? 'STARBOARD ▶' : '◀ PORT') : '';
    this.fireSide.style.left = side === 'starboard' ? '57%' : side === 'port' ? '43%' : '50%';
  }

  _drawCompass(player, wind) {
    const c = this.cctx;
    const S = this.compass.width; // 248
    const cx = S / 2;
    const cy = S / 2;
    const R = S / 2 - 18;
    c.clearRect(0, 0, S, S);

    // dial
    c.lineWidth = 6;
    c.strokeStyle = 'rgba(224,173,77,0.55)';
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.stroke();
    // ticks
    c.strokeStyle = 'rgba(241,226,191,0.35)';
    c.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r1 = R - 6;
      const r2 = R - (i % 3 === 0 ? 20 : 12);
      c.beginPath();
      c.moveTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
      c.lineTo(cx + Math.sin(a) * r2, cy - Math.cos(a) * r2);
      c.stroke();
    }

    const heading = player && player.alive ? Math.atan2(player.forward().z, player.forward().x) : 0;

    // ship marker (bow points up)
    c.fillStyle = '#f1e2bf';
    c.beginPath();
    c.moveTo(cx, cy - 22);
    c.lineTo(cx - 11, cy + 16);
    c.lineTo(cx, cy + 9);
    c.lineTo(cx + 11, cy + 16);
    c.closePath();
    c.fill();

    // wind arrow, relative to the bow (which is "up")
    const rel = wind.angle - heading;
    const ax = Math.sin(rel);
    const ay = -Math.cos(rel);
    const tipX = cx + ax * (R - 10);
    const tipY = cy + ay * (R - 10);
    const baseX = cx - ax * (R - 30);
    const baseY = cy - ay * (R - 30);
    c.strokeStyle = '#f6cf6e';
    c.lineWidth = 7;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(baseX, baseY);
    c.lineTo(tipX, tipY);
    c.stroke();
    // arrowhead
    const ah = 16;
    const perp = rel;
    c.fillStyle = '#f6cf6e';
    c.beginPath();
    c.moveTo(tipX, tipY);
    c.lineTo(tipX - ax * ah - ay * ah * 0.6, tipY - ay * ah + ax * ah * 0.6);
    c.lineTo(tipX - ax * ah + ay * ah * 0.6, tipY - ay * ah - ax * ah * 0.6);
    c.closePath();
    c.fill();
    void perp;
  }

  _updatePlates(enemies, camera, width, height) {
    const seen = new Set();
    for (const e of enemies) {
      const ship = e.ship;
      if (!ship.alive) continue;
      this._anchor.copy(ship.mesh.userData.topAnchor).applyMatrix4(ship.mesh.matrixWorld);
      this._ndc.copy(this._anchor).project(camera);
      if (this._ndc.z > 1 || this._ndc.x < -1.2 || this._ndc.x > 1.2 || this._ndc.y < -1.2 || this._ndc.y > 1.2) {
        continue; // off-screen / behind camera
      }
      seen.add(ship.id);
      let plate = this._plates.get(ship.id);
      if (!plate) {
        const root = document.createElement('div');
        root.className = 'nameplate';
        root.innerHTML = `<div class="np-name">${ship.name}</div><div class="np-bar"><i></i></div>`;
        this.nameplates.appendChild(root);
        plate = { root, fill: root.querySelector('i') };
        this._plates.set(ship.id, plate);
      }
      const sx = (this._ndc.x * 0.5 + 0.5) * width;
      const sy = (-this._ndc.y * 0.5 + 0.5) * height;
      plate.root.style.left = `${sx}px`;
      plate.root.style.top = `${sy}px`;
      plate.fill.style.width = `${(ship.health / ship.maxHealth) * 100}%`;
    }
    // remove stale plates
    for (const [id, plate] of this._plates) {
      if (!seen.has(id)) {
        plate.root.remove();
        this._plates.delete(id);
      }
    }
  }

  removePlate(id) {
    const plate = this._plates.get(id);
    if (plate) {
      plate.root.remove();
      this._plates.delete(id);
    }
  }
}
