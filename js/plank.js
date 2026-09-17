/**
 * plank.js - Procedural high-detail tangent plank, distance milestones, and rails
 */
import * as THREE from 'three';
import { PLANK_WIDTH, PLANK_HALF_LENGTH } from './physics.js';

/**
 * Creates the high-tech plank deck texture with grid lines and friction strips.
 */
function createDeckTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Base composite dark carbon deck
  ctx.fillStyle = '#70777c';
  ctx.fillRect(0, 0, 512, 512);

  // Metal grid tiles
  ctx.strokeStyle = '#4f565a';
  ctx.lineWidth = 4;
  const tileSize = 64;
  for (let x = 0; x < 512; x += tileSize) {
    for (let y = 0; y < 512; y += tileSize) {
      ctx.strokeRect(x, y, tileSize, tileSize);
    }
  }

  // Tread / friction dots
  ctx.fillStyle = '#858b8d';
  for (let x = 16; x < 512; x += 32) {
    for (let y = 16; y < 512; y += 32) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Fine surface grain keeps the metal from looking like flat plastic.
  for (let i = 0; i < 24000; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)';
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1, 1);
  }
  // Bright center safety dashes
  ctx.fillStyle = '#ffaa00';
  ctx.fillRect(250, 64, 12, 128);
  ctx.fillRect(250, 320, 12, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.repeat.set(1, 1);
  return texture;
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
  const macroMat = new THREE.MeshStandardMaterial({
    color: 0x2c3545,
    metalness: 0.85,
    roughness: 0.4
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

  const localDeckMat = new THREE.MeshStandardMaterial({
    map: createDeckTexture(),
    roughness: 0.72,
    metalness: 0.25
  });
  const localDeckGeo = new THREE.PlaneGeometry(localLength, PLANK_WIDTH, 400, 6);
  localDeckGeo.rotateX(-Math.PI / 2);
  const uv = localDeckGeo.attributes.uv;
  const pos = localDeckGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getZ(i) + PLANK_WIDTH / 2) / PLANK_WIDTH, pos.getX(i) / 12);
  uv.needsUpdate = true;
  const localDeckMesh = new THREE.Mesh(localDeckGeo, localDeckMat);
  localDeckMesh.position.y = 0.08; // Top at y = 0
  localDeckMesh.receiveShadow = true;
  localGroup.add(localDeckMesh);

  // Glass edge panels on both sides
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x88ccff,
    transparent: true,
    opacity: 0.14,
    roughness: 0.05,
    transmission: 0,
    thickness: 0.5,
    clearcoat: 1.0
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
  const topRailMatCyan = new THREE.MeshStandardMaterial({ color: 0xabb5ba, metalness: 0.65, roughness: 0.32 });
  const topRailMatYellow = topRailMatCyan;

  const leftTopRail = new THREE.Mesh(topRailGeo, topRailMatCyan);
  leftTopRail.position.set(0, 1.45, -PLANK_WIDTH / 2 + 0.3);
  localGroup.add(leftTopRail);

  const rightTopRail = new THREE.Mesh(topRailGeo, topRailMatYellow);
  rightTopRail.position.set(0, 1.45, PLANK_WIDTH / 2 - 0.3);
  localGroup.add(rightTopRail);

  // Rail vertical posts every 20 meters
  const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.5, 12);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9, roughness: 0.2 });
  const postInstancedMesh = new THREE.InstancedMesh(postGeo, postMat, 202);
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
      localDeckMat.map.offset.y = (snappedX / 12) % 1;
    }
  };
}
