// Gerstner wave field — the single source of truth for the ocean surface.
//
// The GLSL ocean shader (ocean.js) and the CPU buoyancy sampler (used by the
// ship physics) are both built from WAVE_CONST below, so the hull floats on
// exactly the water that is drawn. This is the answer to the PBI's "sync the
// wave height from the GPU shader to the CPU physics engine": rather than read
// pixels back from the GPU, we evaluate the identical analytic function on
// both sides.

import { WAVES } from './config.js';

const G = 9.8;

// Per-wave constants: wavenumber k, angular frequency omega (deep-water
// dispersion, then scaled by the authored speed), amplitude, steepness.
export const WAVE_CONST = WAVES.map((w) => {
  const k = (2 * Math.PI) / w.wavelength;
  const omega = Math.sqrt(G * k) * w.speed;
  return {
    dirX: w.dir[0],
    dirZ: w.dir[1],
    k,
    omega,
    amp: w.amplitude,
    q: w.steepness,
  };
});

// Vertical surface height at world (x, z) and time t. This samples the height
// term at the base position — the standard, cheap approximation used for
// buoyancy (it ignores the small horizontal Gerstner pinch, which is
// negligible for floating bodies).
export function getWaveHeight(x, z, t) {
  let y = 0;
  for (let i = 0; i < WAVE_CONST.length; i++) {
    const w = WAVE_CONST[i];
    const theta = w.k * (w.dirX * x + w.dirZ * z) - w.omega * t;
    y += w.amp * Math.sin(theta);
  }
  return y;
}

// Full Gerstner displacement + analytic surface normal at base (x, z).
// Returns the SAME `out` object each call when reused. Used for foam-aware
// spawn placement and any effect that wants the true surface point/normal.
const _info = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };
export function getWaveInfo(x, z, t, out = _info) {
  let dispX = 0;
  let dispY = 0;
  let dispZ = 0;
  let nx = 0;
  let ny = 1;
  let nz = 0;
  for (let i = 0; i < WAVE_CONST.length; i++) {
    const w = WAVE_CONST[i];
    const theta = w.k * (w.dirX * x + w.dirZ * z) - w.omega * t;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const wa = w.k * w.amp;
    dispX += w.q * w.amp * w.dirX * c;
    dispZ += w.q * w.amp * w.dirZ * c;
    dispY += w.amp * s;
    nx -= w.dirX * wa * c;
    ny -= w.q * wa * s;
    nz -= w.dirZ * wa * c;
  }
  out.x = x + dispX;
  out.y = dispY;
  out.z = z + dispZ;
  const inv = 1 / Math.hypot(nx, ny, nz);
  out.nx = nx * inv;
  out.ny = ny * inv;
  out.nz = nz * inv;
  return out;
}

// Iteratively solve for the surface height *at* horizontal (x, z) accounting
// for the Gerstner horizontal pinch. More accurate than getWaveHeight for
// splash placement; a couple of fixed-point steps are plenty.
export function getSurfaceHeightAccurate(x, z, t) {
  let sx = x;
  let sz = z;
  for (let iter = 0; iter < 3; iter++) {
    let dispX = 0;
    let dispZ = 0;
    for (let i = 0; i < WAVE_CONST.length; i++) {
      const w = WAVE_CONST[i];
      const theta = w.k * (w.dirX * sx + w.dirZ * sz) - w.omega * t;
      const c = Math.cos(theta);
      dispX += w.q * w.amp * w.dirX * c;
      dispZ += w.q * w.amp * w.dirZ * c;
    }
    sx = x - dispX;
    sz = z - dispZ;
  }
  return getWaveHeight(sx, sz, t);
}
