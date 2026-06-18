// Central tuning for the whole simulation. One place to balance the game.
import { degToRad } from './util.js';

export const CONFIG = {
  render: {
    fov: 60,
    near: 0.5,
    far: 5000,
    maxPixelRatio: 2, // cap DPR so retina screens still hit 45fps+
    fog: { color: 0xccdfe9, near: 300, far: 640 },
    background: 0xccdfe9,
  },

  world: {
    gravity: -9.8,
    seaLevel: 0,
  },

  ocean: {
    size: 1280, // size of the camera-following ocean patch (world units)
    segments: 256, // grid subdivisions; vertex shader displaces these
    deepColor: 0x0a2c47,
    shallowColor: 0x1c7fa3,
    foamColor: 0xf3fbff,
    skyTint: 0x9fc3df, // colour reflected at grazing angles (fresnel)
    sunShininess: 220,
    // Gerstner waves — SHARED by the GLSL ocean shader and the CPU buoyancy
    // sampler so the physics floats on exactly the water you see.
    // dirDeg: travel direction (0=+X, 90=+Z). steepness 0..1 = crest peakiness.
    waves: [
      { dirDeg: 35, wavelength: 72, amplitude: 1.55, steepness: 0.55, speed: 0.85 },
      { dirDeg: 68, wavelength: 36, amplitude: 0.82, steepness: 0.5, speed: 1.05 },
      { dirDeg: 115, wavelength: 19, amplitude: 0.4, steepness: 0.5, speed: 1.25 },
      { dirDeg: 8, wavelength: 11, amplitude: 0.22, steepness: 0.45, speed: 1.55 },
    ],
  },

  wind: {
    initialDeg: 60, // direction the wind blows TOWARD (world degrees)
    strength: 1.0, // multiplier (see min/max)
    minStrength: 0.5,
    maxStrength: 1.35,
    dirDriftRate: 0.12, // radians/sec maximum drift of direction
    strengthDriftRate: 0.06,
  },

  ship: {
    mass: 1200,
    // Hull collision half-extents: x=beam/2, y=height/2, z=length/2. Bow at +Z.
    half: { x: 3.1, y: 2.4, z: 9.5 },
    centerOfMassY: -1.0, // lower CoM => more self-righting stability
    // Local-space buoyancy probes near the keel (the "float points").
    floatPoints: [
      [0, -1.7, 8.6],
      [0, -1.7, -8.6],
      [2.6, -1.7, 3.4],
      [-2.6, -1.7, 3.4],
      [2.6, -1.7, -3.4],
      [-2.6, -1.7, -3.4],
    ],
    buoyancyPerPoint: 5200, // upward N per metre of submersion per probe
    submergeForFull: 2.2, // submersion depth (m) that yields full buoyancy
    waterLinearDamp: 0.6,
    waterAngularDamp: 0.86,
    rightingTorque: 16000, // arcade self-righting so it bobs but won't capsize
    // Sailing
    maxThrust: 15500, // forward N at full sail, ideal angle, full wind
    sailTrimRate: 0.55, // sail raise/lower units per second (W/S)
    turnTorque: 11000, // yaw torque at full rudder & full responsiveness
    rudderRate: 2.4, // rudder swing per second (A/D)
    rudderCenterRate: 1.7, // auto-centre when no steering input
    steerMinResponse: 0.16, // steering authority at zero speed (sluggish)
    steerSpeedRef: 13, // speed (m/s) for full steering responsiveness
    maxHealth: 100,
  },

  cannon: {
    perSide: 5,
    rowZHalf: 6.2, // cannons spread +rowZHalf..-rowZHalf along the hull
    portY: -0.1, // local height of the gun ports
    portX: 3.05, // local beam offset of the muzzles
    rollDelay: 0.085, // seconds between sequential guns (rolling broadside)
    reload: 2.7, // seconds before a broadside side can fire again
    muzzleSpeed: 78, // m/s
    elevationDeg: 7,
    spreadDeg: 2.2,
    ballRadius: 0.42,
    ballMass: 8,
    ballDrag: 0.015, // air drag coefficient
    windInfluence: 5.5, // how strongly wind nudges a ball in flight
    damage: 9,
    life: 8, // seconds before a ball despawns
    recoilImpulse: 1500,
  },

  // The player's anachronistic ride: a fast, nimble, planing jet ski.
  jetski: {
    mass: 240,
    half: { x: 0.95, y: 0.7, z: 2.4 }, // small hull => hard for galleons to hit
    floatPoints: [
      [0, -0.5, 1.9],
      [0, -0.5, -1.7],
      [0.7, -0.5, 0.1],
      [-0.7, -0.5, 0.1],
    ],
    buoyancyPerPoint: 3200,
    submergeForFull: 0.9,
    waterLinearDamp: 0.7,
    waterAngularDamp: 0.9,
    rightingTorque: 2600,
    enginePower: 6800, // forward N at full throttle
    reversePower: 2600,
    throttleRate: 2.4, // how fast throttle tracks W/S
    turnTorque: 1900,
    rudderRate: 4.2,
    rudderCenterRate: 3.2,
    steerMinResponse: 0.5, // thrust-steers even at low speed
    steerSpeedRef: 9,
    planingLift: 230, // extra upward N per m/s of forward speed (rides high & fast)
    bankFactor: 0.6, // visual lean into turns (radians at full)
    pitchFactor: 0.12, // nose-up under acceleration
    sprayThreshold: 5, // speed (m/s) above which the rooster tail kicks up
    maxHealth: 60, // squishier than a galleon — stay nimble
    cameraRig: { distance: 16, height: 6.2, aimHeight: 2.0 },
  },

  machineGun: {
    fireRate: 13, // rounds per second
    speed: 155, // m/s
    drop: 7, // mild gravity on rounds (m/s^2)
    spreadDeg: 1.7,
    damage: 2.4,
    life: 2.4,
    range: 340,
    tracerSize: 0.85,
    recoil: 60, // tiny per-round kick
    sfxEvery: 2, // play a report every Nth round (rate control)
  },

  camera: {
    distance: 36,
    height: 15,
    minPitch: degToRad(-10),
    maxPitch: degToRad(74),
    sensitivity: 0.0022,
    posLambda: 5.5, // spring-arm position smoothing
    lookLambda: 9,
    aimHeight: 4.5, // look at a point this far above the ship origin
  },

  ai: {
    count: 6,
    aggroRadius: 250,
    fireRange: 165,
    fireRangeMin: 30,
    broadsideArcDeg: 38, // target must be this near abeam to loose a broadside
    fleeHealth: 24,
    accuracyJitterDeg: 7,
    spawnRadius: 240,
    steerGain: 1.6,
    wanderTurnRate: 0.25,
  },

  particles: {
    max: 5000,
  },

  audio: {
    master: 0.85,
    music: 0.32,
    sfx: 0.9,
  },
};

// Precomputed unit travel directions for the waves (used to build the shader
// uniforms and the CPU sampler from one definition).
export const WAVES = CONFIG.ocean.waves.map((w) => {
  const a = degToRad(w.dirDeg);
  return {
    dir: [Math.cos(a), Math.sin(a)],
    wavelength: w.wavelength,
    amplitude: w.amplitude,
    steepness: w.steepness,
    speed: w.speed,
  };
});

export const NUM_WAVES = WAVES.length;
