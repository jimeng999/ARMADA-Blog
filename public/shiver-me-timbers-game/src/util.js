// Small math helpers shared across the whole module. No dependencies.

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a, b, t) => a + (b - a) * t;

export const invLerp = (a, b, v) => (v - a) / (b - a);

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Frame-rate independent exponential approach of `current` toward `target`.
// lambda is "responsiveness" (larger = snappier).
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const degToRad = (d) => (d * Math.PI) / 180;
export const radToDeg = (r) => (r * 180) / Math.PI;

export const randRange = (a, b) => a + Math.random() * (b - a);
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);

// Wrap an angle to (-PI, PI].
export function wrapAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

// Shortest signed angular difference from `from` to `to` (radians).
export const angleDelta = (from, to) => wrapAngle(to - from);
