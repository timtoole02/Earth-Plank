/**
 * plank.js - Procedural high-detail tangent plank, distance milestones, and rails
 */
import * as THREE from 'three';
import { PLANK_WIDTH, PLANK_HALF_LENGTH } from './physics.js';

// Along-deck length covered by one repeat of the deck textures (metres).
const DECK_REPEAT = 15;

/**
 * Procedural PBR steel deck: diamond tread plates, welded seams, bolts,
 * worn safety paint, grime and foot-polished walking lanes. Produces a colour
 * map, a tangent-space normal map and a packed roughness (G) / metalness (B) map.
 */
function createDeckTextures() {
  const W = 2048, H = 1024; // u spans the 30 m width, v spans DECK_REPEAT metres
  const pxPerM = W / PLANK_WIDTH;
  const height = new Float32Array(W * H);
  const color = new Uint8ClampedArray(W * H * 4);
  const orm = new Uint8ClampedArray(W * H * 4);

  // Tileable value noise.
  const hash = (x, y) => { let n = Math.imul(x, 374761393) + Math.imul(y, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const noise = (x, y, px, py) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const w = (a, p) => ((a % p) + p) % p;
    const a = hash(w(xi, px), w(yi, py)), b = hash(w(xi + 1, px), w(yi, py));
    const c = hash(w(xi, px), w(yi + 1, py)), d = hash(w(xi + 1, px), w(yi + 1, py));
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, base) => {
    let sum = 0, amp = 0.5, f = 1;
    for (let o = 0; o < 5; o++) { sum += amp * noise(x * base * f, y * base * f, base * f * 2, base * f); amp *= 0.5; f *= 2; }
    return sum;
  };

  const plateW = PLANK_WIDTH / 8, plateL = DECK_REPEAT / 6;
  const pitch = 0.11; // tread pattern spacing (m)
  for (let y = 0; y < H; y++) {
    const my = y / pxPerM; // metres along
    for (let x = 0; x < W; x++) {
      const mx = x / pxPerM; // metres across
      const i = y * W + x;
      const u = x / W, v = y / H;
      // Plate seams and per-plate variation.
      const plateX = Math.floor(mx / plateW), plateY = Math.floor(my / plateL);
      const sx = mx - plateX * plateW, sy = my - plateY * plateL;
      const seam = Math.min(sx, plateW - sx, sy, plateL - sy);
      const plateTint = hash(plateX, plateY + 17) * 0.08 - 0.04;
      // Diamond tread: alternating elongated bumps.
      const cx = Math.floor(sx / pitch), cy = Math.floor(sy / pitch);
      let lx = sx / pitch - cx - 0.5, ly = sy / pitch - cy - 0.5;
      const flip = (cx + cy) & 1 ? 1 : -1;
      const rx = (lx + flip * ly) * 0.7071, ry = (ly - flip * lx) * 0.7071;
      const e = (rx * rx) / 0.1225 + (ry * ry) / 0.0081;
      let h = e < 1 ? (1 - e) * 0.6 : 0;
      // Seam groove and bevel.
      if (seam < 0.012) h -= 0.8; else if (seam < 0.03) h -= (0.03 - seam) / 0.018 * 0.35;
      // Bolts along plate edges.
      const bx = Math.round(sx / 0.625) * 0.625, by = sy < plateL / 2 ? 0.06 : plateL - 0.06;
      const bd = Math.hypot(sx - bx, sy - by);
      if (bd < 0.028 && bx > 0.05 && bx < plateW - 0.05) h = 1.1 - bd * 12;
      const grime = fbm(u, v, 6);
      const fine = noise(mx * 40, my * 40, Math.round(PLANK_WIDTH * 40), DECK_REPEAT * 40);
      h += (fine - 0.5) * 0.15;
      height[i] = h;

      // Walking lanes: foot polish around a third of the way in from each rail.
      const lane = Math.exp(-Math.pow((Math.abs(mx - PLANK_WIDTH / 2) - 6) / 3.2, 2));
      const polish = lane * (0.6 + 0.4 * noise(mx * 3, my * 0.4, 90, 6));
      let r = 0.47 + plateTint + (grime - 0.5) * 0.28 + (fine - 0.5) * 0.05 + polish * 0.08;
      let g = r * 1.01, b = r * 1.03;
      let rough = 0.58 + (grime - 0.5) * 0.5 - polish * 0.18 + (h < -0.3 ? 0.25 : 0);
      let metal = 0.6;
      // Rust bloom in the seams.
      const rust = seam < 0.05 ? Math.max(0, fbm(u * 3, v * 3, 8) - 0.52) * 3 : 0;
      if (rust > 0) { r += rust * 0.12; g -= rust * 0.04; b -= rust * 0.1; rough += rust * 0.3; metal -= rust * 0.6; }
      if (h < -0.3) { r *= 0.35; g *= 0.35; b *= 0.35; }

      // Safety paint, worn where boots land.
      const wear = fbm(u * 2, v * 2, 10);
      const center = Math.abs(mx - PLANK_WIDTH / 2) < 0.1 && (my % 7.5) < 3.75;
      const edge = Math.abs(Math.abs(mx - PLANK_WIDTH / 2) - (PLANK_WIDTH / 2 - 1.3)) < 0.08;
      const paintMask = (center || edge) && wear > 0.32 + polish * 0.3 ? 1 : 0;
      if (paintMask) {
        const shade = 0.9 + (grime - 0.5) * 0.3;
        if (center) { r = 0.95 * shade; g = 0.62 * shade; b = 0.05 * shade; }
        else { r = g = b = 0.86 * shade; }
        rough = 0.62 + (grime - 0.5) * 0.2; metal = 0;
        height[i] += 0.12;
      }
      const o = i * 4;
      color[o] = Math.pow(Math.max(0, r), 1 / 2.2) * 255;
      color[o + 1] = Math.pow(Math.max(0, g), 1 / 2.2) * 255;
      color[o + 2] = Math.pow(Math.max(0, b), 1 / 2.2) * 255;
      color[o + 3] = 255;
      orm[o] = 255;
      orm[o + 1] = Math.min(1, Math.max(0.05, rough)) * 255;
      orm[o + 2] = Math.min(1, Math.max(0, metal)) * 255;
      orm[o + 3] = 255;
    }
  }
  // Normal map from the height field (tiling in v).
  const normal = new Uint8ClampedArray(W * H * 4);
  const strength = 2.2;
  for (let y = 0; y < H; y++) {
    const yu = ((y - 1 + H) % H) * W, yd = ((y + 1) % H) * W;
    for (let x = 0; x < W; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(W - 1, x + 1);
      const dx = (height[y * W + xr] - height[y * W + xl]) * strength;
      const dy = (height[yd + x] - height[yu + x]) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * W + x) * 4;
      normal[o] = (-dx / len * 0.5 + 0.5) * 255;
      normal[o + 1] = (-dy / len * 0.5 + 0.5) * 255;
      normal[o + 2] = (1 / len * 0.5 + 0.5) * 255;
      normal[o + 3] = 255;
    }
  }
  const make = (data, srgb) => {
    const texture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 16;
    texture.flipY = false;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  };
  return { map: make(color, true), normalMap: make(normal, false), ormMap: make(orm, false) };
}

/**
 * Creates a text canvas sprite for milestone distance signage.
 */
export function createMilestoneSprite(text, subtext, color = '#00f7ff') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(10, 18, 30, 0.85)';
  ctx.roundRect(10, 10, 492, 236, 24);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.stroke();

  // Top header text
  ctx.fillStyle = color;
  ctx.font = 'bold 54px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, 256, 95);

  // Subtext / description
  ctx.fillStyle = '#ffffff';
  ctx.font = '32px sans-serif';
  ctx.fillText(subtext, 256, 175);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(16, 8, 1);
  return sprite;
}

/**
 * Creates the entire plank system:
 * 1. Infinite/Extended Macro Plank Beam (visible from space and deep horizon)
 * 2. High-Detail Local Plank Chunk (anchored around the player for foot-level precision)
 * 3. Side Rails, Glass edge barriers, Light stanchions, and Milestones
 */
export function createPlankSystem() {
  const group = new THREE.Group();

  // 1. MACRO PLANK (Extending 25,000 km in both directions)
  const macroGeo = new THREE.BoxGeometry(PLANK_HALF_LENGTH * 2, 8, PLANK_WIDTH, 4096, 1, 1);
  // Matches the average look of the detailed deck so the 1 km handoff is invisible.
  const macroMat = new THREE.MeshStandardMaterial({
    color: 0x5f6468,
    metalness: 0.8,
    roughness: 0.5
  });
  // A single, non-overlapping coverage boundary for all distant beam surfaces.
  // Keep it synchronized with the snapped local chunk, including at endpoints.
  const localCenterX = { value: 0 };
  const excludeLocalDeck = shader => {
    shader.uniforms.localCenterX = localCenterX;
    shader.vertexShader = 'varying float deckX;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n deckX = (modelMatrix * vec4(transformed, 1.0)).x;');
    shader.fragmentShader = 'varying float deckX; uniform float localCenterX;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (abs(deckX - localCenterX) <= 1000.0) discard;');
  };
  macroMat.onBeforeCompile = excludeLocalDeck;
  const macroMesh = new THREE.Mesh(macroGeo, macroMat);
  macroMesh.position.y = -4.25; // top surface at y = 0
  macroMesh.receiveShadow = true;
  group.add(macroMesh);

  // Thick glowing neon edge strips on macro plank (visible from vast cosmic distances)
  const edgeStripGeo = new THREE.BoxGeometry(PLANK_HALF_LENGTH * 2, 0.08, 0.18, 4096, 1, 1);

  const leftEdgeMat = new THREE.MeshBasicMaterial({ color: 0xc6d6dd });
  leftEdgeMat.onBeforeCompile = excludeLocalDeck;
  const leftEdgeMesh = new THREE.Mesh(edgeStripGeo, leftEdgeMat);
  leftEdgeMesh.position.set(0, 0, -PLANK_WIDTH / 2);
  group.add(leftEdgeMesh);

  const rightEdgeMat = new THREE.MeshBasicMaterial({ color: 0xd3a754 });
  rightEdgeMat.onBeforeCompile = excludeLocalDeck;
  const rightEdgeMesh = new THREE.Mesh(edgeStripGeo, rightEdgeMat);
  rightEdgeMesh.position.set(0, 0, PLANK_WIDTH / 2);
  group.add(rightEdgeMesh);

  // 2. LOCAL HIGH-DETAIL PLANK CHUNK (Moves with player to keep millimeter visual quality)
  const localLength = 2000; // 2 km chunk
  const localGroup = new THREE.Group();

  const deckTextures = createDeckTextures();
  const localDeckMat = new THREE.MeshStandardMaterial({
    map: deckTextures.map,
    normalMap: deckTextures.normalMap,
    normalScale: new THREE.Vector2(1, 1),
    roughnessMap: deckTextures.ormMap,
    metalnessMap: deckTextures.ormMap,
    roughness: 1,
    metalness: 1
  });
  const localDeckGeo = new THREE.PlaneGeometry(localLength, PLANK_WIDTH, 400, 6);
  localDeckGeo.rotateX(-Math.PI / 2);
  const uv = localDeckGeo.attributes.uv;
  const pos = localDeckGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getZ(i) + PLANK_WIDTH / 2) / PLANK_WIDTH, pos.getX(i) / DECK_REPEAT);
  uv.needsUpdate = true;
  const localDeckMesh = new THREE.Mesh(localDeckGeo, localDeckMat);
  localDeckMesh.position.y = 0.08; // Top at y = 0
  localDeckMesh.receiveShadow = true;
  localGroup.add(localDeckMesh);

  // Glass edge panels on both sides
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xb9dbe6,
    transparent: true,
    opacity: 0.1,
    roughness: 0.04,
    metalness: 0,
    ior: 1.52,
    specularIntensity: 1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.4
  });
  const glassRailGeo = new THREE.BoxGeometry(localLength, 1.4, 0.15, 200, 1, 1);

  const leftGlass = new THREE.Mesh(glassRailGeo, glassMat);
  leftGlass.position.set(0, 0.7, -PLANK_WIDTH / 2 + 0.3);
  localGroup.add(leftGlass);

  const rightGlass = new THREE.Mesh(glassRailGeo, glassMat);
  rightGlass.position.set(0, 0.7, PLANK_WIDTH / 2 - 0.3);
  localGroup.add(rightGlass);

  // Glowing safety top rails
  const topRailGeo = new THREE.CylinderGeometry(0.12, 0.12, localLength, 12, 200);
  topRailGeo.rotateZ(Math.PI / 2);
  // Brushed stainless handrail.
  const topRailMatCyan = new THREE.MeshStandardMaterial({ color: 0xc9ced1, metalness: 1, roughness: 0.28 });
  const topRailMatYellow = topRailMatCyan;

  const leftTopRail = new THREE.Mesh(topRailGeo, topRailMatCyan);
  leftTopRail.castShadow = true;
  leftTopRail.position.set(0, 1.45, -PLANK_WIDTH / 2 + 0.3);
  localGroup.add(leftTopRail);

  const rightTopRail = new THREE.Mesh(topRailGeo, topRailMatYellow);
  rightTopRail.castShadow = true;
  rightTopRail.position.set(0, 1.45, PLANK_WIDTH / 2 - 0.3);
  localGroup.add(rightTopRail);

  // Rail vertical posts every 20 meters
  const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.5, 12);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xbfc4c7, metalness: 1, roughness: 0.3 });
  const postInstancedMesh = new THREE.InstancedMesh(postGeo, postMat, 202);
  postInstancedMesh.castShadow = true;
  postInstancedMesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let postIdx = 0;
  for (let px = -localLength / 2; px <= localLength / 2; px += 20) {
    // Left post
    dummy.position.set(px, 0.75, -PLANK_WIDTH / 2 + 0.3);
    dummy.updateMatrix();
    postInstancedMesh.setMatrixAt(postIdx++, dummy.matrix);
    // Right post
    dummy.position.set(px, 0.75, PLANK_WIDTH / 2 - 0.3);
    dummy.updateMatrix();
    postInstancedMesh.setMatrixAt(postIdx++, dummy.matrix);
  }
  postInstancedMesh.instanceMatrix.needsUpdate = true;
  localGroup.add(postInstancedMesh);

  group.add(localGroup);

  // 3. KEY MILESTONE ARCHWAYS ALONG THE PLANK
  const milestoneGroup = new THREE.Group();
  const milestones = [
    { x: 0, title: 'PLANK ANCHOR', sub: '0 km | Earth Sea Level' },
    { x: 100000, title: '100 KM', sub: 'Alt: 785 m | Slope: 0.9°' },
    { x: 336000, title: '336 KM (EVEREST)', sub: 'Alt: 8,849 m | O2 Depleted' },
    { x: 1000000, title: '1,000 KM', sub: 'Alt: 78 km | Stratosphere' },
    { x: 1133000, title: '1,133 KM (KÁRMÁN LINE)', sub: 'Alt: 100 km | Space Edge' },
    { x: 2295000, title: '2,295 KM (ISS ORBIT)', sub: 'Alt: 400 km | Slope: 19.8°' },
    { x: 3678000, title: '3,678 KM (FRICTION LIMIT)', sub: 'Alt: 985 km | Slope: 30° (Slipping)' },
    { x: 6371000, title: '6,371 KM (1 EARTH RADIUS)', sub: 'Alt: 2,639 km | Slope: 45° (Cliff)' },
    { x: 15000000, title: '15,000 KM', sub: 'Deep Space Terminal' }
  ];

  const archGeo = new THREE.BoxGeometry(1, 1, PLANK_WIDTH + 2);
  const archMat = new THREE.MeshStandardMaterial({ color: 0x111822, metalness: 0.9, roughness: 0.3 });

  milestones.forEach((m) => {
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.set(m.x, 7.5, 0);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), archMat);
      leg.position.set(m.x, 4, side * (PLANK_WIDTH / 2 + 0.7));
      milestoneGroup.add(leg);
    }
    arch.receiveShadow = true;
    arch.castShadow = true;
    milestoneGroup.add(arch);

    // Glowing billboard sign
    const sprite = createMilestoneSprite(m.title, m.sub);
    sprite.position.set(m.x, 18, 0);
    milestoneGroup.add(sprite);
  });

  group.add(milestoneGroup);

  return {
    group,
    macroMesh,
    localGroup,
    milestoneGroup,
    update(playerWorldX, playerWorldZ) {
      group.position.z = -playerWorldZ;
      // Macro plank is centered at world X = 0, so in player coordinates:
      macroMesh.position.x = -playerWorldX;
      leftEdgeMesh.position.x = -playerWorldX;
      rightEdgeMesh.position.x = -playerWorldX;
      milestoneGroup.position.x = -playerWorldX;

      // Local high-detail plank chunk snaps in discrete increments around player
      // to avoid visual swimming while keeping local detail sharp
      const snapInterval = 20; // snap every 20 meters
      const snappedX = THREE.MathUtils.clamp(Math.floor(playerWorldX / snapInterval) * snapInterval, -PLANK_HALF_LENGTH + localLength / 2, PLANK_HALF_LENGTH - localLength / 2);
      localGroup.position.x = snappedX - playerWorldX;
      localCenterX.value = localGroup.position.x;

      // Texture offset follows player for continuous seamless floor movement
      const offset = (snappedX / DECK_REPEAT) % 1;
      for (const texture of [localDeckMat.map, localDeckMat.normalMap, localDeckMat.roughnessMap]) texture.offset.y = offset;
    }
  };
}
