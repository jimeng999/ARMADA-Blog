// GPU-points particle system with a fixed object pool (no per-frame GC). Two
// THREE.Points draw groups — one normal-blended (smoke, water, splinters) and
// one additive (fire, muzzle flash). Soft round sprites are generated in the
// fragment shader, and each particle carries its own colour, alpha and size.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, randRange } from './util.js';

// type -> behaviour. up = initial upward speed range; spread = lateral scatter;
// gravity (+ rises), drag (exp damping), growth (size gain over life),
// dirPush = speed added along an optional direction hint.
const TYPES = {
  splash: { add: false, gravity: -20, drag: 0.5, size: [0.7, 1.9], growth: 1.4, life: [0.5, 1.05], up: [7, 14], spread: 5, dirPush: 0, color: [0xcfeaf5, 0xffffff] },
  splinter: { add: false, gravity: -22, drag: 0.12, size: [0.3, 0.9], growth: 0, life: [0.7, 1.4], up: [4, 11], spread: 10, dirPush: 0, color: [0x6b4a2a, 0x32200f] },
  smoke: { add: false, gravity: 2.2, drag: 1.5, size: [2.0, 4.0], growth: 5.5, life: [1.4, 2.7], up: [1, 3], spread: 2, dirPush: 0, color: [0x9a9a9a, 0x454545] },
  fire: { add: true, gravity: 5.5, drag: 1.2, size: [1.2, 3.0], growth: 1.4, life: [0.3, 0.7], up: [2, 5], spread: 2.5, dirPush: 0, color: [0xffe06a, 0xff5a1e] },
  flash: { add: true, gravity: 0, drag: 3.5, size: [3.0, 6.0], growth: 0, life: [0.06, 0.16], up: [0, 0], spread: 1, dirPush: 0, color: [0xfff4c8, 0xffcf6a] },
  muzzle: { add: false, gravity: 1.6, drag: 1.8, size: [1.6, 3.6], growth: 4.5, life: [0.6, 1.25], up: [1, 3], spread: 2, dirPush: 9, color: [0x9c9c9c, 0xd8d8d8] },
};

// Precompute linear-space colour endpoints once.
for (const k in TYPES) {
  const t = TYPES[k];
  t._c0 = new THREE.Color(t.color[0]);
  t._c1 = new THREE.Color(t.color[1]);
}

export class ParticleSystem {
  constructor(scene) {
    this.max = CONFIG.particles.max;
    this.pool = new Array(this.max);
    for (let i = 0; i < this.max; i++) {
      this.pool[i] = {
        alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 0, growth: 0, gravity: 0, drag: 0,
        r: 1, g: 1, b: 1, add: false,
      };
    }
    this.cursor = 0;
    this.normal = this._makeGroup(scene, false);
    this.additive = this._makeGroup(scene, true);
  }

  _makeGroup(scene, additive) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(this.max * 3);
    const colors = new Float32Array(this.max * 4);
    const sizes = new Float32Array(this.max);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        attribute float aSize;
        varying vec4 vColor;
        uniform float uScale;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (uScale / max(-mv.z, 0.1));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float a = smoothstep(0.5, 0.12, d) * vColor.a;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor.rgb, a);
        }
      `,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);
    return { geo, mat, positions, colors, sizes };
  }

  // Set the point-size scale = viewportHeight / (2 * tan(fov/2)) so `aSize` is
  // an approximate world-space radius. Call on init and resize.
  setViewport(height, fovRad) {
    const scale = height / (2 * Math.tan(fovRad / 2));
    this.normal.mat.uniforms.uScale.value = scale;
    this.additive.mat.uniforms.uScale.value = scale;
  }

  emit(type, pos, count = 1, dir = null) {
    const cfg = TYPES[type];
    if (!cfg) return;
    for (let n = 0; n < count; n++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
      p.alive = true;
      p.x = pos.x;
      p.y = pos.y;
      p.z = pos.z;
      p.vx = (Math.random() - 0.5) * cfg.spread;
      p.vz = (Math.random() - 0.5) * cfg.spread;
      p.vy = randRange(cfg.up[0], cfg.up[1]);
      if (dir && cfg.dirPush) {
        p.vx += dir.x * cfg.dirPush;
        p.vy += dir.y * cfg.dirPush * 0.5;
        p.vz += dir.z * cfg.dirPush;
      }
      p.maxLife = randRange(cfg.life[0], cfg.life[1]);
      p.life = p.maxLife;
      p.size = randRange(cfg.size[0], cfg.size[1]);
      p.growth = cfg.growth;
      p.gravity = cfg.gravity;
      p.drag = cfg.drag;
      p.add = cfg.add;
      const m = Math.random();
      p.r = cfg._c0.r + (cfg._c1.r - cfg._c0.r) * m;
      p.g = cfg._c0.g + (cfg._c1.g - cfg._c0.g) * m;
      p.b = cfg._c0.b + (cfg._c1.b - cfg._c0.b) * m;
    }
  }

  update(dt) {
    const N = this.normal;
    const A = this.additive;
    let nN = 0;
    let nA = 0;
    for (let i = 0; i < this.max; i++) {
      const p = this.pool[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      const dragF = Math.exp(-p.drag * dt);
      p.vx *= dragF;
      p.vz *= dragF;
      p.vy = p.vy * dragF + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      const lifeT = p.life / p.maxLife; // 1 -> 0
      const size = p.size + p.growth * (1 - lifeT);
      const alpha = clamp(lifeT * 1.3, 0, 1) * (p.add ? 1.0 : 0.92);

      const grp = p.add ? A : N;
      const idx = p.add ? nA++ : nN++;
      grp.positions[idx * 3] = p.x;
      grp.positions[idx * 3 + 1] = p.y;
      grp.positions[idx * 3 + 2] = p.z;
      grp.colors[idx * 4] = p.r;
      grp.colors[idx * 4 + 1] = p.g;
      grp.colors[idx * 4 + 2] = p.b;
      grp.colors[idx * 4 + 3] = alpha;
      grp.sizes[idx] = size;
    }
    this._flush(N, nN);
    this._flush(A, nA);
  }

  _flush(grp, n) {
    grp.geo.setDrawRange(0, n);
    grp.geo.attributes.position.needsUpdate = true;
    grp.geo.attributes.aColor.needsUpdate = true;
    grp.geo.attributes.aSize.needsUpdate = true;
  }
}
