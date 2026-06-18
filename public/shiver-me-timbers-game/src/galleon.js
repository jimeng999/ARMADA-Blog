// Procedural low-poly galleon. Built entirely from Three.js primitives so the
// drop needs zero external assets. A glTF loader hook lives in ship.js for
// swapping in real models later. Convention: bow at +Z, up at +Y, starboard +X.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const HULL_LEN = 19;
const HULL_BEAM = 6.2;
const HULL_HEIGHT = 4.2;

function woodMat(color, rough = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.04, flatShading: true });
}

// Skull-and-crossbones texture drawn on a canvas (used on the mainsail / flag).
function makeJollyRoger(bg = '#0b0b0d', fg = '#f4efe2') {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = bg;
  x.fillRect(0, 0, 256, 256);
  x.strokeStyle = fg;
  x.fillStyle = fg;
  x.lineWidth = 18;
  x.lineCap = 'round';
  // crossbones
  x.beginPath(); x.moveTo(60, 60); x.lineTo(196, 196); x.stroke();
  x.beginPath(); x.moveTo(196, 60); x.lineTo(60, 196); x.stroke();
  for (const [cx, cy] of [[60, 60], [196, 60], [60, 196], [196, 196]]) {
    x.beginPath(); x.arc(cx, cy, 16, 0, Math.PI * 2); x.fill();
  }
  // skull
  x.beginPath(); x.arc(128, 116, 50, 0, Math.PI * 2); x.fill();
  x.fillRect(98, 150, 60, 34);
  x.fillStyle = bg;
  x.beginPath(); x.arc(110, 112, 14, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.arc(146, 112, 14, 0, Math.PI * 2); x.fill();
  x.fillRect(122, 132, 12, 20);
  for (let i = 0; i < 4; i++) x.fillRect(104 + i * 14, 168, 8, 16); // teeth
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Deform a box into a tapered, upswept V-hull (reasoned entirely in local/world
// axes: x=beam, y=vertical, z=length, +z=bow).
function buildHull(material) {
  const g = new THREE.BoxGeometry(HULL_BEAM, HULL_HEIGHT, HULL_LEN, 3, 3, 12);
  const pos = g.attributes.position;
  const HZ = HULL_LEN / 2;
  const HY = HULL_HEIGHT / 2;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const zf = v.z / HZ; // -1 stern .. +1 bow
    const yf = (v.y + HY) / HULL_HEIGHT; // 0 keel .. 1 deck
    let taper = 1;
    if (zf > 0) taper = 1 - 0.8 * Math.pow(zf, 1.6); // sharp bow
    else taper = 1 - 0.28 * Math.pow(-zf, 1.8); // tucked stern
    const vee = 0.32 + 0.68 * yf; // narrower toward the keel
    v.x *= taper * vee;
    if (yf > 0.6) v.y += Math.pow(Math.abs(zf), 2.0) * 1.5 * ((yf - 0.6) / 0.4); // upswept rails
    if (yf < 0.4) v.y += Math.pow(Math.abs(zf), 2.3) * 1.1; // rocker so ends lift
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const hull = new THREE.Mesh(g, material);
  return hull;
}

function buildSail(width, height, sailMat) {
  const g = new THREE.PlaneGeometry(width, height, 6, 4);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // billow toward +Z (as if filled by a following wind)
    const bx = 1 - Math.pow((v.x / (width / 2)) || 0, 2);
    const by = 1 - Math.pow((v.y / (height / 2)) || 0, 2);
    v.z += bx * by * width * 0.16;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, sailMat);
  m.userData.isSail = true;
  return m;
}

export function createGalleon(opts = {}) {
  const {
    hullColor = 0x3a2616,
    deckColor = 0x6b4a2a,
    trimColor = 0x241608,
    sailColor = 0xeae0c8,
    accent = 0x8c2b22,
    emblem = true,
    flag = true,
  } = opts;

  const group = new THREE.Group();
  const hullMat = woodMat(hullColor);
  const deckMat = woodMat(deckColor, 0.9);
  const trimMat = woodMat(trimColor);
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.6, flatShading: true });
  const sailMat = new THREE.MeshStandardMaterial({ color: sailColor, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, flatShading: false });

  // --- Hull + deck ---
  const hull = buildHull(hullMat);
  group.add(hull);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(HULL_BEAM * 0.74, 0.5, HULL_LEN * 0.82), deckMat);
  deck.position.y = 1.75;
  group.add(deck);

  // Bulwark rails along the deck edges
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.9, HULL_LEN * 0.8), trimMat);
    rail.position.set(sx * HULL_BEAM * 0.4, 2.1, 0);
    group.add(rail);
  }

  // Stern castle (raised aft structure) + bow forecastle
  const stern = new THREE.Mesh(new THREE.BoxGeometry(HULL_BEAM * 0.62, 2.6, 4.0), deckMat);
  stern.position.set(0, 3.0, -6.6);
  group.add(stern);
  const sternTrim = new THREE.Mesh(new THREE.BoxGeometry(HULL_BEAM * 0.66, 0.4, 4.2), trimMat);
  sternTrim.position.set(0, 4.3, -6.6);
  group.add(sternTrim);
  const fore = new THREE.Mesh(new THREE.BoxGeometry(HULL_BEAM * 0.5, 1.6, 2.6), deckMat);
  fore.position.set(0, 2.7, 6.7);
  group.add(fore);

  // Captain's lantern on the stern (a warm point light + bulb)
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffc964, emissive: 0xff9a2e, emissiveIntensity: 1.4, roughness: 0.4 }));
  lantern.position.set(0, 4.9, -8.4);
  group.add(lantern);

  // Rudder (visual) at the stern keel
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.4, 1.2), trimMat);
  rudder.position.set(0, -0.6, -9.4);
  group.add(rudder);

  // --- Masts, yards, sails ---
  const masts = [
    { z: 5.4, h: 14, sail: [5.2, 5.0], top: 4.5 }, // foremast
    { z: 0.2, h: 18, sail: [6.4, 6.4], top: 6.0 }, // mainmast (tallest)
    { z: -5.0, h: 12.5, sail: [4.4, 4.2], top: 4.0 }, // mizzen
  ];
  const sails = [];
  masts.forEach((m, idx) => {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, m.h, 7), trimMat);
    mast.position.set(0, 1.8 + m.h / 2, m.z);
    group.add(mast);

    // upper + lower yards with sails
    const yardYs = [m.top, m.top + m.sail[1] + 0.6];
    yardYs.forEach((yy, s) => {
      if (s === 1 && idx === 2) return; // mizzen keeps a single sail
      const yardW = m.sail[0] * (s === 1 ? 0.8 : 1);
      const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, yardW + 1, 6), trimMat);
      yard.rotation.z = Math.PI / 2;
      yard.position.set(0, 1.8 + yy + m.sail[1] / 2, m.z);
      group.add(yard);

      const sail = buildSail(yardW, m.sail[1] * (s === 1 ? 0.8 : 1), idx === 1 && s === 0 && emblem ? sailMat.clone() : sailMat);
      sail.position.set(0, 1.8 + yy, m.z);
      if (idx === 1 && s === 0 && emblem) {
        sail.material = new THREE.MeshStandardMaterial({ map: makeJollyRoger('#e9dfc6', '#1b1410'), roughness: 0.95, side: THREE.DoubleSide });
      }
      group.add(sail);
      sails.push(sail);
    });
  });

  // Bowsprit
  const bowsprit = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 6, 6), trimMat);
  bowsprit.rotation.x = Math.PI / 2.5;
  bowsprit.position.set(0, 3.0, 10.5);
  group.add(bowsprit);

  // --- Cannons + recorded muzzle anchors ---
  const muzzles = { port: [], starboard: [] };
  const { perSide, rowZHalf, portX, portY } = CONFIG.cannon;
  for (let s = 0; s < 2; s++) {
    const sx = s === 0 ? 1 : -1; // starboard first
    const list = s === 0 ? muzzles.starboard : muzzles.port;
    for (let i = 0; i < perSide; i++) {
      const z = THREE.MathUtils.lerp(-rowZHalf, rowZHalf, perSide === 1 ? 0.5 : i / (perSide - 1));
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 1.4, 7), ironMat);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(sx * (portX - 0.2), portY + 1.6, z);
      group.add(barrel);
      // muzzle anchor sits just outboard of the hull
      list.push(new THREE.Vector3(sx * portX, portY + 1.6, z));
    }
  }

  // --- Flag (animated in ship.update) ---
  let flagMesh = null;
  if (flag) {
    const fmat = new THREE.MeshStandardMaterial({ map: makeJollyRoger(), roughness: 0.9, side: THREE.DoubleSide });
    flagMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6, 8, 4), fmat);
    flagMesh.position.set(0, 1.8 + 18 + 1.4, 0.2); // atop the mainmast
    flagMesh.userData.baseX = flagMesh.position.x;
    group.add(flagMesh);
  }

  // Accent stripe near the waterline gun deck
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(HULL_BEAM * 0.86, 0.5, HULL_LEN * 0.9), woodMat(accent, 0.7));
  stripe.position.set(0, 1.1, 0);
  group.add(stripe);

  group.userData.muzzles = muzzles;
  group.userData.sails = sails;
  group.userData.flag = flagMesh;
  group.userData.dims = { ...CONFIG.ship.half };
  group.userData.topAnchor = new THREE.Vector3(0, 1.8 + 18 + 3.0, 0);

  return group;
}
