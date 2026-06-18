// The ocean: a camera-following plane displaced on the GPU by the same Gerstner
// waves the CPU physics samples (see waves.js). The fragment shader does deep
// colour, fresnel sky reflection, sun glint, and crest foam — no reflection
// passes, so it stays cheap enough for the 45fps target.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { WAVE_CONST } from './waves.js';

export function createOcean(scene, sunDirection, sunColor = 0xfff1cf) {
  const N = WAVE_CONST.length;

  const uniforms = {
    uTime: { value: 0 },
    uDir: { value: WAVE_CONST.map((w) => new THREE.Vector2(w.dirX, w.dirZ)) },
    uK: { value: WAVE_CONST.map((w) => w.k) },
    uOmega: { value: WAVE_CONST.map((w) => w.omega) },
    uAmp: { value: WAVE_CONST.map((w) => w.amp) },
    uQ: { value: WAVE_CONST.map((w) => w.q) },
    uDeep: { value: new THREE.Color(CONFIG.ocean.deepColor) },
    uShallow: { value: new THREE.Color(CONFIG.ocean.shallowColor) },
    uFoam: { value: new THREE.Color(CONFIG.ocean.foamColor) },
    uSky: { value: new THREE.Color(CONFIG.ocean.skyTint) },
    uSunColor: { value: new THREE.Color(sunColor) },
    uSunDir: { value: sunDirection.clone() },
    uShininess: { value: CONFIG.ocean.sunShininess },
    uFogColor: { value: new THREE.Color(CONFIG.render.fog.color) },
    uFogNear: { value: CONFIG.render.fog.near },
    uFogFar: { value: CONFIG.render.fog.far },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: false, // we fog manually in the shader for a custom horizon blend
    vertexShader: /* glsl */ `
      #define NUM_WAVES ${N}
      uniform float uTime;
      uniform vec2 uDir[NUM_WAVES];
      uniform float uK[NUM_WAVES];
      uniform float uOmega[NUM_WAVES];
      uniform float uAmp[NUM_WAVES];
      uniform float uQ[NUM_WAVES];
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vDispY;
      varying float vCrest;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0); // plane lies in XZ, y~0
        float x = wp.x;
        float z = wp.z;
        vec3 disp = vec3(0.0);
        vec3 nrm = vec3(0.0, 1.0, 0.0);
        for (int i = 0; i < NUM_WAVES; i++) {
          float theta = uK[i] * (uDir[i].x * x + uDir[i].y * z) - uOmega[i] * uTime;
          float c = cos(theta);
          float s = sin(theta);
          disp.x += uQ[i] * uAmp[i] * uDir[i].x * c;
          disp.z += uQ[i] * uAmp[i] * uDir[i].y * c;
          disp.y += uAmp[i] * s;
          float wa = uK[i] * uAmp[i];
          nrm.x -= uDir[i].x * wa * c;
          nrm.y -= uQ[i] * wa * s;
          nrm.z -= uDir[i].y * wa * c;
        }
        wp.xyz += disp;
        vWorld = wp.xyz;
        vNormal = normalize(nrm);
        vDispY = disp.y;
        vCrest = smoothstep(0.3, 1.15, disp.y);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uDeep, uShallow, uFoam, uSky, uSunColor, uSunDir, uFogColor;
      uniform float uShininess, uFogNear, uFogFar;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vDispY;
      varying float vCrest;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
        fres = clamp(0.02 + 0.98 * fres, 0.0, 1.0);

        float upness = clamp(N.y, 0.0, 1.0);
        vec3 water = mix(uDeep, uShallow, smoothstep(-1.2, 1.5, vDispY) * 0.55 + upness * 0.45);
        vec3 col = mix(water, uSky, fres * 0.8);

        // Sun specular glint
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), uShininess);
        col += uSunColor * spec * 1.7;

        // Foam at crests, broken up with value noise
        float fn = noise(vWorld.xz * 0.35 + vDispY) * 0.6 + 0.45;
        float foam = clamp(vCrest * fn * 1.5, 0.0, 1.0);
        col = mix(col, uFoam, foam);

        // Distance fog blends the patch edge into the sky
        float dist = length(cameraPosition - vWorld);
        col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const geo = new THREE.PlaneGeometry(
    CONFIG.ocean.size,
    CONFIG.ocean.size,
    CONFIG.ocean.segments,
    CONFIG.ocean.segments
  );
  geo.rotateX(-Math.PI / 2); // lie flat in XZ, normal +Y

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false; // it's always under us
  scene.add(mesh);

  const cell = CONFIG.ocean.size / CONFIG.ocean.segments;

  return {
    mesh,
    material,
    update(time, cameraPos) {
      uniforms.uTime.value = time;
      // Follow the camera, snapped to a grid cell so the wave pattern stays
      // locked to world space (no "swimming") while the patch travels with us.
      mesh.position.x = Math.round(cameraPos.x / cell) * cell;
      mesh.position.z = Math.round(cameraPos.z / cell) * cell;
    },
  };
}
