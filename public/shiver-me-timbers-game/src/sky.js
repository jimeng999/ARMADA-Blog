// Gradient sky dome + lighting rig (directional "sun", hemisphere, ambient).
// The dome follows the camera so the horizon is always around the player,
// reinforcing the endless-ocean feel together with distance fog.
import * as THREE from 'three';
import { CONFIG } from './config.js';

export function createSky(scene) {
  // Sun direction = unit vector pointing FROM the world toward the sun.
  const elevation = THREE.MathUtils.degToRad(27);
  const azimuth = THREE.MathUtils.degToRad(122);
  const sunDirection = new THREE.Vector3(
    Math.cos(elevation) * Math.cos(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.sin(azimuth)
  ).normalize();

  const sunColor = 0xfff1cf;

  const uniforms = {
    uSunDir: { value: sunDirection.clone() },
    uTop: { value: new THREE.Color(0x2e6fa3) },
    uHorizon: { value: new THREE.Color(0xccdfe9) }, // matches scene fog for a seamless seam
    uBottom: { value: new THREE.Color(0x8fa9b8) },
    uSunColor: { value: new THREE.Color(sunColor) },
  };

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uTop, uHorizon, uBottom, uSunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
        col = mix(col, uBottom, smoothstep(0.02, -0.3, h));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * pow(s, 900.0) * 1.3;  // crisp sun disk
        col += uSunColor * pow(s, 11.0) * 0.22;  // soft halo
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(CONFIG.render.far * 0.48, 32, 16),
    skyMat
  );
  dome.renderOrder = -1;
  scene.add(dome);

  // Lighting
  const sun = new THREE.DirectionalLight(sunColor, 2.0);
  sun.position.copy(sunDirection).multiplyScalar(400);
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x2a4654, 0.65);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0x3c5666, 0.45);
  scene.add(ambient);

  return {
    dome,
    sun,
    sunDirection,
    sunColor,
    update(cameraPos) {
      dome.position.copy(cameraPos);
      sun.position.copy(cameraPos).addScaledVector(sunDirection, 400);
      sun.target.position.copy(cameraPos);
      sun.target.updateMatrixWorld();
    },
  };
}
