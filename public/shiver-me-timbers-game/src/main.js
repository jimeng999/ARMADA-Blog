// Shiver Me Timbers — bootstrap & game loop. Wires rendering (sky + Gerstner
// ocean), Ammo.js physics, sailing ships, broadside combat, particles, AI,
// audio and HUD into one update loop with start / win / lose / restart flow.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, degToRad } from './util.js';
import { initAmmo, PhysicsWorld } from './physics.js';
import { createSky } from './sky.js';
import { createOcean } from './ocean.js';
import { Ship } from './ship.js';
import { Jetski } from './jetski.js';
import { Wind } from './wind.js';
import { ParticleSystem } from './particles.js';
import { CannonSystem } from './cannons.js';
import { BulletSystem } from './guns.js';
import { SpringArmCamera } from './camera.js';
import { Input } from './input.js';
import { AIController } from './ai.js';
import { AudioEngine } from './audio.js';
import { HUD } from './hud.js';

const ENEMY_NAMES = ['Sea Wraith', 'Bloody Mary', 'Iron Gull', 'Storm Crow'];
const FOV_RAD = degToRad(CONFIG.render.fov);

const G = {
  mode: 'boot', // boot -> menu -> playing -> ended
  time: 0,
  frames: 0,
  fps: 60,
  pendingEnd: null,
  endTimer: 0,
  player: null,
  enemyEntries: [],
  ships: [],
};

// --- Renderer / scene / camera ---------------------------------------------
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // keep raw shaders & lit materials consistent
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.render.background);
scene.fog = new THREE.Fog(CONFIG.render.fog.color, CONFIG.render.fog.near, CONFIG.render.fog.far);

const camera = new THREE.PerspectiveCamera(CONFIG.render.fov, window.innerWidth / window.innerHeight, CONFIG.render.near, CONFIG.render.far);
camera.position.set(0, 18, -40);

const sky = createSky(scene);
const ocean = createOcean(scene, sky.sunDirection, sky.sunColor);

const hud = new HUD();
const input = new Input(renderer.domElement);
const audio = new AudioEngine();
const wind = new Wind();
const springCam = new SpringArmCamera(camera);

// Systems that need Ammo are created in init().
let physics = null;
let particles = null;
let cannons = null;
let bullets = null;

// Shared per-frame env handed to subsystems.
const env = {
  time: 0,
  wind,
  physics: null,
  particles: null,
  cannons: null,
  audio,
  onHit: null,
};

// --- World construction -----------------------------------------------------
function buildWorld() {
  // The player rides a jet ski with a rear-mounted machine gun.
  const player = new Jetski({ physics, scene, position: { x: 0, y: 2, z: 0 } });

  const enemyEntries = [];
  for (let i = 0; i < CONFIG.ai.count; i++) {
    const ang = (i / CONFIG.ai.count) * Math.PI * 2 + Math.random() * 0.8;
    const r = CONFIG.ai.spawnRadius * (0.85 + Math.random() * 0.5);
    const ship = new Ship({
      physics,
      scene,
      position: { x: Math.cos(ang) * r, y: 1.5, z: Math.sin(ang) * r },
      faction: 'enemy',
      galleonOpts: { sailColor: 0xd8c4a4, accent: 0x6b1f18, hullColor: 0x2c1b0f },
    });
    ship.name = ENEMY_NAMES[i % ENEMY_NAMES.length];
    enemyEntries.push({ ship, ai: new AIController(ship) });
  }

  G.player = player;
  G.enemyEntries = enemyEntries;
  refreshShips();
  hud.configureForPlayer(player);
}

function refreshShips() {
  G.ships = [G.player, ...G.enemyEntries.map((e) => e.ship)];
}

function disposeWorld() {
  cannons.clear();
  if (bullets) bullets.clear();
  if (G.player) G.player.dispose(scene);
  for (const e of G.enemyEntries) {
    e.ship.dispose(scene);
    hud.removePlate(e.ship.id);
  }
  G.player = null;
  G.enemyEntries = [];
  G.ships = [];
}

function restart() {
  disposeWorld();
  buildWorld();
  G.pendingEnd = null;
  G.endTimer = 0;
  G.mode = 'playing';
  hud.hideScreen();
  hud.setLive(true);
  input.enabled = true;
  input.requestLock();
}

// --- Death / win-lose bookkeeping ------------------------------------------
function handleDeaths() {
  for (const ship of G.ships) {
    if (ship.sinking && !ship._deathHandled) {
      ship._deathHandled = true;
      // dramatic finale
      const p = ship.worldPos(new THREE.Vector3());
      p.y += 2;
      particles.emit('fire', p, 26);
      particles.emit('smoke', p, 18);
      particles.emit('splinter', p, 24);
      if (audio.ready) audio.hit(p);

      if (ship === G.player) {
        hud.flashBanner('Yer hull is breached — abandon ship!', 3);
        G.pendingEnd = 'defeat';
        G.endTimer = 3.2;
      } else {
        hud.flashBanner(`${ship.name} sent to the depths! ☠`, 2.2);
        const aliveEnemies = G.enemyEntries.filter((e) => e.ship.alive).length;
        if (aliveEnemies === 0 && G.pendingEnd !== 'victory') {
          G.pendingEnd = 'victory';
          G.endTimer = 3.5;
          hud.flashBanner('The last scallywag sinks — the seas are yours!', 3.2);
        }
      }
    }
  }

  // Remove fully-sunk enemies (keep the player around so the camera can watch
  // her go down until the end screen).
  let changed = false;
  for (let i = G.enemyEntries.length - 1; i >= 0; i--) {
    const e = G.enemyEntries[i];
    if (e.ship.removed) {
      e.ship.dispose(scene);
      hud.removePlate(e.ship.id);
      G.enemyEntries.splice(i, 1);
      changed = true;
    }
  }
  if (changed) refreshShips();
}

env.onHit = (ship, ownerId) => {
  // Brief feedback when the player lands a hit.
  if (ownerId === (G.player && G.player.id) && ship !== G.player && audio.ready) {
    // (sound already played by cannons on impact)
  }
};

// --- Main loop --------------------------------------------------------------
let last = performance.now() / 1000;

function frame() {
  requestAnimationFrame(frame);
  G.frames++;
  const now = performance.now() / 1000;
  const dt = clamp(now - last, 0, 0.05);
  last = now;
  G.time += dt;
  env.time = G.time;
  G.fps += ((dt > 0 ? 1 / dt : 60) - G.fps) * 0.1;

  wind.update(dt);

  if (G.mode === 'playing') {
    stepPlaying(dt);
  } else if (G.mode === 'menu' || G.mode === 'ended') {
    stepIdle(dt);
  }

  // Physics + visuals shared by all modes (so the sea always lives).
  for (const s of G.ships) s.update(dt, env);
  if (cannons) cannons.update(dt, env, G.ships);
  if (bullets) {
    bullets.update(dt, env, G.ships);
    if (G.mode === 'playing' && G.player && G.player.alive && G.player.wantFire) {
      bullets.fire(G.player, env, G.ships);
    }
  }
  if (physics) physics.step(dt);
  if (particles) particles.update(dt);
  handleDeaths();

  if (G.player) springCam.update(dt, G.player);
  sky.update(camera.position);
  ocean.update(G.time, camera.position);

  audio.setWind(wind.strength, G.player ? G.player.speed() : 0);
  audio.updateListener(camera);

  if (G.mode !== 'boot') {
    hud.update(dt, {
      player: G.player,
      wind,
      enemies: G.enemyEntries,
      camera,
      width: window.innerWidth,
      height: window.innerHeight,
      fps: G.fps,
    });
  }

  // End-screen transition once the death drama has played out.
  if (G.pendingEnd && G.mode === 'playing') {
    G.endTimer -= dt;
    if (G.endTimer <= 0) {
      G.mode = 'ended';
      hud.setLive(false);
      hud.showEndScreen(G.pendingEnd === 'victory');
      input.enabled = false;
      if (document.exitPointerLock) document.exitPointerLock();
    }
  }

  renderer.render(scene, camera);
}

function stepPlaying(dt) {
  const { dx, dy } = input.consumeMouse();
  springCam.addMouse(dx, dy);

  const player = G.player;
  if (player && player.alive) {
    player.throttleInput = input.throttleAxis();
    player.rudderInput = input.rudderAxis();
    springCam.aimDir(player.aimDir); // horizontal — turret yaw
    camera.getWorldDirection(player.aimDir3D); // full 3D — bullet trajectory
    player.wantFire = input.isFiring();
    const intents = input.consumeIntents();
    if (intents.restart) {
      restart();
      return;
    }
  } else {
    input.consumeIntents();
    if (player) player.wantFire = false;
  }
  hud.setFireSide(null);

  for (const e of G.enemyEntries) e.ai.update(dt, env, player, cannons);
}

function stepIdle(dt) {
  // Slow cinematic orbit behind the menu / end screen.
  springCam.yaw += dt * 0.12;
  const intents = input.consumeIntents();
  input.consumeMouse();
  if (G.mode === 'ended' && intents.restart) restart();
}

// --- Resize -----------------------------------------------------------------
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio));
  if (particles) particles.setViewport(h * renderer.getPixelRatio(), FOV_RAD);
}
window.addEventListener('resize', onResize);

// --- Boot -------------------------------------------------------------------
async function init() {
  const btn = document.getElementById('start-btn');
  btn.disabled = true;
  hud.setBootMsg('Summoning the kraken (loading physics)…');

  let Ammo;
  try {
    Ammo = await initAmmo();
  } catch (err) {
    hud.setBootMsg('⚠ Could not load Ammo.js — serve over http:// (e.g. `node serve.mjs`).');
    console.error(err);
    return;
  }

  physics = new PhysicsWorld(Ammo, CONFIG.world.gravity);
  particles = new ParticleSystem(scene);
  particles.setViewport(window.innerHeight * renderer.getPixelRatio(), FOV_RAD);
  cannons = new CannonSystem(physics, scene, particles);
  bullets = new BulletSystem(physics, scene, particles);
  env.physics = physics;
  env.particles = particles;
  env.cannons = cannons;
  window.__SMT_SYS = { cannons, bullets, particles, physics }; // smoke-test hook

  buildWorld();
  G.mode = 'menu';

  btn.disabled = false;
  hud.setBootMsg('Ready. Hoist the colours, Captain!');

  btn.addEventListener('click', async () => {
    if (G.mode === 'menu') {
      await audio.init();
      G.mode = 'playing';
      hud.hideScreen();
      hud.setLive(true);
      input.enabled = true;
      input.requestLock();
    } else if (G.mode === 'ended') {
      await audio.init();
      restart();
    }
  });

  frame();
}

// Debug hook for the smoke test / console tinkering.
window.__SMT = G;

init();
