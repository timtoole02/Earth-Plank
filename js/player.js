/**
 * player.js - Player controller, camera perspectives, dynamic gravity alignment, and astronaut avatar
 */
import * as THREE from 'three';
import { stepPlankMotion } from './motion.js?v=physics-1';
import { EARTH_RADIUS, calculatePlankPhysics, PLANK_WIDTH, PLANK_HALF_LENGTH } from './physics.js';

export const CAMERA_MODES = {
  GRAVITY_ALIGNED: 'gravity', // Human vestibular sense: camera upright to local gravity; plank ramps UP!
  PLANK_ALIGNED: 'plank',     // Camera level with plank deck; Earth drops away and tilts
  THIRD_PERSON: 'third',      // Over-the-shoulder astronaut avatar
  MACRO_ORBIT: 'orbit'        // Cosmic orbital view of Earth and tangent plank
};

/**
 * Builds an EVA-suited astronaut: layered cloth suit, hard upper torso,
 * life-support backpack, bubble helmet with a gold sun visor.
 * Faces +X. Limbs pivot at the hips and shoulders.
 */
function createAstronautMesh() {
  const group = new THREE.Group();

  // Multi-layer insulation fabric: soft, slightly warm white with cloth sheen.
  const suitMat = new THREE.MeshPhysicalMaterial({
    color: 0xe8e5dc, roughness: 0.82, metalness: 0,
    sheen: 1, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.6
  });
  const hardMat = new THREE.MeshPhysicalMaterial({ color: 0xf1f0ec, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 1 });
  const jointMat = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.7 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x5b5f64, roughness: 0.9 });
  // Gold-coated polycarbonate sun visor.
  const visorMat = new THREE.MeshPhysicalMaterial({
    color: 0xd9a441, roughness: 0.06, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.02
  });
  const bubbleMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.18,
    clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false
  });

  const add = (geometry, material, x, y, z, parent = group) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Torso: soft suit with a hard upper torso shell and chest control unit.
  const torso = add(new THREE.CapsuleGeometry(0.27, 0.42, 8, 20), suitMat, 0, 1.12, 0);
  torso.scale.set(0.95, 1, 1.15);
  add(new THREE.SphereGeometry(0.33, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), hardMat, 0, 1.3, 0).scale.set(0.95, 0.75, 1.1);
  add(new THREE.BoxGeometry(0.1, 0.16, 0.3), hardMat, 0.3, 1.22, 0);
  for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 12), metalMat, 0.355, 1.26 - i * 0.05, -0.08 + i * 0.08).rotation.z = Math.PI / 2;
  add(new THREE.TorusGeometry(0.27, 0.03, 8, 32), metalMat, 0, 0.9, 0).rotation.x = Math.PI / 2;

  // Primary life-support backpack.
  add(new THREE.BoxGeometry(0.26, 0.72, 0.56), hardMat, -0.36, 1.2, 0);
  add(new THREE.BoxGeometry(0.2, 0.12, 0.5), metalMat, -0.38, 1.6, 0);
  for (const z of [-0.15, 0.15]) add(new THREE.CylinderGeometry(0.05, 0.07, 0.1, 12), jointMat, -0.42, 0.8, z);

  // Helmet: neck ring, bubble, gold visor, and small helmet lights.
  add(new THREE.TorusGeometry(0.17, 0.035, 10, 32), metalMat, 0, 1.52, 0).rotation.x = Math.PI / 2;
  add(new THREE.SphereGeometry(0.17, 20, 16), jointMat, 0, 1.72, 0).scale.set(1, 1.15, 1);
  const visor = add(new THREE.SphereGeometry(0.235, 32, 24, -Math.PI / 2.6, Math.PI / 1.3, Math.PI * 0.18, Math.PI * 0.5), visorMat, 0, 1.73, 0);
  visor.rotation.y = Math.PI; // open face toward +X
  visor.castShadow = false;
  add(new THREE.SphereGeometry(0.25, 32, 24), bubbleMat, 0, 1.73, 0).castShadow = false;
  for (const z of [-0.2, 0.2]) add(new THREE.BoxGeometry(0.08, 0.05, 0.05), hardMat, 0.05, 1.9, z);

  // Limbs are groups whose origin is the joint, so rotation swings naturally.
  const limb = (x, y, z, upper, lower, radius, endGeo, endMat) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    group.add(pivot);
    add(new THREE.SphereGeometry(radius * 1.15, 16, 12), suitMat, 0, 0, 0, pivot);
    add(new THREE.CapsuleGeometry(radius, upper, 6, 16), suitMat, 0, -upper / 2 - radius * 0.3, 0, pivot);
    add(new THREE.TorusGeometry(radius * 1.02, 0.018, 8, 20), jointMat, 0, -upper - radius * 0.4, 0, pivot).rotation.x = Math.PI / 2;
    add(new THREE.CapsuleGeometry(radius * 0.92, lower, 6, 16), suitMat, 0, -upper - lower / 2 - radius * 0.9, 0, pivot);
    const end = add(endGeo, endMat, 0, -upper - lower - radius * 1.6, 0, pivot);
    return { pivot, end };
  };
  const hipY = 0.86, shoulderY = 1.38;
  const leftLeg = limb(0, hipY, -0.14, 0.3, 0.28, 0.1, new THREE.BoxGeometry(0.3, 0.12, 0.15), bootMat);
  const rightLeg = limb(0, hipY, 0.14, 0.3, 0.28, 0.1, new THREE.BoxGeometry(0.3, 0.12, 0.15), bootMat);
  for (const leg of [leftLeg, rightLeg]) leg.end.position.x = 0.05;
  const leftArm = limb(0, shoulderY, -0.38, 0.24, 0.22, 0.08, new THREE.SphereGeometry(0.075, 16, 12), jointMat);
  const rightArm = limb(0, shoulderY, 0.38, 0.24, 0.22, 0.08, new THREE.SphereGeometry(0.075, 16, 12), jointMat);
  leftArm.pivot.rotation.x = -0.12;
  rightArm.pivot.rotation.x = 0.12;

  return {
    group,
    leftLeg: leftLeg.pivot,
    rightLeg: rightLeg.pivot,
    leftArm: leftArm.pivot,
    rightArm: rightArm.pivot,
    animate(walkCycle, isMoving) {
      const swing = isMoving ? Math.sin(walkCycle) * 0.45 : 0;
      leftLeg.pivot.rotation.z = swing;
      rightLeg.pivot.rotation.z = -swing;
      leftArm.pivot.rotation.z = -swing * 0.8;
      rightArm.pivot.rotation.z = swing * 0.8;
    }
  };
}

export class PlayerController {
  constructor(camera, domElement, orbitControls) {
    this.camera = camera;
    this.domElement = domElement;
    this.orbitControls = orbitControls;

    // World coordinates (in meters)
    this.worldX = 0; // starts at touchpoint (center of plank)
    this.worldZ = 0; // center of 30m plank width
    this.worldY = 1.8; // eye level above deck

    // Velocity
    this.vx = 0;
    this.vz = 0;
    this.speedMultiplier = 1 / 3.6; // 1x, 10x, 100x, 1000x, etc.
    this.baseSpeed = 5.0; // 5 m/s running
    this.isAutopilot = false;
    this.travelDirection = 1;
    this.motionState = { powered: false, slipping: false };
    this.magBootsEnabled = false; // Prevents slipping when player wants to explore freely

    // Camera settings
    this.cameraMode = CAMERA_MODES.GRAVITY_ALIGNED;
    this.yaw = 0;   // radians around vertical
    this.pitch = 0; // radians looking up/down
    this.isLooking = false;
    this.paused = true;
    this.mouseSensitivity = 0.002;
    this.walkCycle = 0;

    // Macro orbit camera distance and angle
    this.orbitDistance = EARTH_RADIUS * 2.8;
    this.orbitTheta = 0;
    this.orbitPhi = Math.PI / 4;

    // Astronaut mesh
    this.astronaut = createAstronautMesh();

    // Beacon for macro orbit view
    const beaconGeo = new THREE.SphereGeometry(150000, 16, 16);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff0055, wireframe: true });
    this.beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);

    // Key states
    this.keys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      sprint: false
    };

    this.setupInputs();
  }

  setupInputs() {
    const movementKeys = {
      KeyW: 'forward', ArrowUp: 'forward', KeyS: 'backward', ArrowDown: 'backward',
      KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
      ShiftLeft: 'sprint', ShiftRight: 'sprint'
    };
    const isForm = (target) => target?.closest?.('input, select, textarea, button, [contenteditable="true"]');
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.code === 'Escape' || (e.code === 'KeyP' && !isForm(e.target))) {
        this.pause();
        document.getElementById('guide-drawer')?.classList.remove('open');
        return;
      }
      if (this.inputSuspended || isForm(e.target)) return;
      if (movementKeys[e.code] && document.activeElement === this.domElement && !this.paused) {
        e.preventDefault();
        this.keys[movementKeys[e.code]] = true;
        if (movementKeys[e.code] === 'forward') this.travelDirection = 1;
        if (movementKeys[e.code] === 'backward') this.travelDirection = -1;
      }
      if (e.repeat) return;
      if (e.code === 'Space' && document.activeElement === this.domElement && !this.paused) {
        e.preventDefault();
        this.toggleAutopilot();
      }
      const modes = { Digit1: 'gravity', Digit2: 'plank', Digit3: 'third', Digit4: 'orbit' };
      if (modes[e.code]) this.setCameraMode(modes[e.code]);
    }, true);
    window.addEventListener('keyup', (e) => {
      if (movementKeys[e.code]) this.keys[movementKeys[e.code]] = false;
    });
    window.addEventListener('blur', () => this.pause());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    // Never request browser pointer lock. Drag-look leaves the cursor available
    // even in embedded browsers that intercept Escape before the page sees it.
    this.domElement.tabIndex = 0;
    this.domElement.setAttribute('aria-label', 'Game view. Drag to look, WASD to move, Escape or P to pause.');
    let lastX = 0, lastY = 0;
    this.domElement.addEventListener('pointerdown', e => {
      if (this.inputSuspended || this.cameraMode === CAMERA_MODES.MACRO_ORBIT || e.button !== 0) return;
      this.domElement.focus({ preventScroll: true });
      this.paused = false;
      this.isLooking = true;
      lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('pointermove', e => {
      if (!this.isLooking || this.paused || this.cameraMode === CAMERA_MODES.MACRO_ORBIT) return;
      if (!(e.buttons & 1)) { this.isLooking = false; return; }
      this.yaw += (e.clientX - lastX) * this.mouseSensitivity;
      this.pitch -= (e.clientY - lastY) * this.mouseSensitivity;
      lastX = e.clientX; lastY = e.clientY;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    });
    window.addEventListener('pointerup', () => { this.isLooking = false; });
    window.addEventListener('pointercancel', () => this.pause());
    this.domElement.addEventListener('blur', () => this.pause());
    document.getElementById('btn-pause')?.addEventListener('click', () => this.pause());
    // Also free a lock left over by an older build or another page component.
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === this.domElement) this.pause();
    });
  }

  pause() {
    this.isLooking = false;
    if (document.pointerLockElement) document.exitPointerLock?.();
    if (document.activeElement === this.domElement) this.domElement.blur();
    this.paused = true;
    this.isAutopilot = false;
    this.vx = this.vz = 0;
    Object.keys(this.keys).forEach(key => this.keys[key] = false);
  }

  setCameraMode(mode) {
    const previous = this.cameraMode;
    this.cameraMode = mode;
    if (mode === CAMERA_MODES.MACRO_ORBIT) {
      this.pause();
      this.orbitControls.enabled = true;
      if (previous !== mode) {
        this.camera.up.set(0, 1, 0);
        this.orbitControls.target.set(-this.worldX, -EARTH_RADIUS, -this.worldZ);
        this.camera.position.copy(this.orbitControls.target).add(new THREE.Vector3(EARTH_RADIUS * 1.6, EARTH_RADIUS * 1.3, EARTH_RADIUS * 2.2));
        this.orbitControls.update();
      }
    } else {
      this.orbitControls.enabled = false;
    }
  }

  toggleAutopilot() {
    if (this.cameraMode === CAMERA_MODES.MACRO_ORBIT) return false;
    this.isAutopilot = !this.isAutopilot;
    this.paused = false;
    return this.isAutopilot;
  }

  setSpeedMultiplier(mult) {
    this.speedMultiplier = mult;
  }

  teleportToKm(km, { recenter = false } = {}) {
    this.worldX = THREE.MathUtils.clamp(km * 1000, -PLANK_HALF_LENGTH, PLANK_HALF_LENGTH);
    if (recenter) this.worldZ = 0;
    this.vx = 0;
    this.vz = 0;
  }

  update(delta) {
    const physics = calculatePlankPhysics(this.worldX);

    if (this.paused || this.cameraMode === CAMERA_MODES.MACRO_ORBIT) {
      this.updateCameraAndAstronaut(physics);
      return;
    }
    // Movement stays aligned with the deck; looking around never steers a lane.
    let forward = Number(this.keys.forward) - Number(this.keys.backward);
    if (this.isAutopilot && forward === 0) forward = this.travelDirection;
    const lateral = Number(this.keys.right) - Number(this.keys.left);
    this.motionState = stepPlankMotion(this, {
      forward, lateral,
      speed: this.baseSpeed * this.speedMultiplier * (this.keys.sprint ? 2.5 : 1),
      magBoots: this.magBootsEnabled
    }, delta);

    // Walking animation cycle
    const isMoving = Math.abs(this.vx) > 0.1 || Math.abs(this.vz) > 0.1;
    if (isMoving) {
      this.walkCycle += delta * (8 * Math.min(this.speedMultiplier, 3));
    }
    this.astronaut.animate(this.walkCycle, isMoving);

    // Update camera and astronaut positioning based on active mode
    this.updateCameraAndAstronaut(calculatePlankPhysics(this.worldX));
  }

  updateCameraAndAstronaut(physics) {
    const isMoving = Math.abs(this.vx) > 0.1 || Math.abs(this.vz) > 0.1;

    // Astronaut local mesh position (always at local origin in floating coordinate system)
    this.astronaut.group.position.set(0, 0, 0);

    // In gravity-aligned mode or steep slope, astronaut leans into the incline
    const slopeRad = physics.thetaRad * (this.worldX >= 0 ? 1 : -1);
    this.astronaut.group.rotation.z = -slopeRad; // lean forward into the slope
    this.astronaut.group.rotation.y = this.vx < -0.1 ? Math.PI : 0;

    // Visibility of astronaut: hide in first-person modes, show in 3rd person and macro
    this.astronaut.group.visible = (
      this.cameraMode === CAMERA_MODES.THIRD_PERSON ||
      this.cameraMode === CAMERA_MODES.MACRO_ORBIT
    );

    // Update camera based on active mode
    switch (this.cameraMode) {
      case CAMERA_MODES.GRAVITY_ALIGNED: {
        // Human Vestibular Sense Mode:
        // Local Gravity points toward Earth center: Vector (-worldX, -EARTH_RADIUS, 0).
        // "Up" in human perception is opposite gravity: Vector (worldX, EARTH_RADIUS, 0).
        // That means the upright reference frame is tilted forward by theta!
        // As a result, the flat plank (horizontal in world) appears to angle UP into the sky!
        const upVec = new THREE.Vector3(this.worldX, EARTH_RADIUS, 0).normalize();
        this.camera.up.copy(upVec);

        // Camera position at player's eye level (1.8m above plank, tilted with upVec)
        const eyeOffset = upVec.clone().multiplyScalar(1.8);
        this.camera.position.set(eyeOffset.x, eyeOffset.y, 0);

        // Compute forward and look target
        // Forward tangent along plank tilted to gravity frame
        const forward = new THREE.Vector3(
          Math.cos(this.yaw) * Math.cos(this.pitch),
          Math.sin(this.pitch),
          Math.sin(this.yaw) * Math.cos(this.pitch)
        );

        // Apply rotation relative to gravity up vector
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), upVec);
        forward.applyQuaternion(quat);

        const lookTarget = this.camera.position.clone().add(forward);
        this.camera.lookAt(lookTarget);
        break;
      }

      case CAMERA_MODES.PLANK_ALIGNED: {
        // Plank Deck Frame:
        // Up is strictly perpendicular to the plank: (0, 1, 0).
        // Plank stays flat and straight; Earth curves away and tilts beneath you.
        this.camera.up.set(0, 1, 0);
        this.camera.position.set(0, this.worldY, 0);

        const forward = new THREE.Vector3(
          Math.cos(this.yaw) * Math.cos(this.pitch),
          Math.sin(this.pitch),
          Math.sin(this.yaw) * Math.cos(this.pitch)
        );
        const lookTarget = this.camera.position.clone().add(forward);
        this.camera.lookAt(lookTarget);
        break;
      }

      case CAMERA_MODES.THIRD_PERSON: {
        // Over-the-shoulder astronaut view
        const upVec = new THREE.Vector3(this.worldX, EARTH_RADIUS, 0).normalize();
        this.camera.up.copy(upVec);

        // Camera positioned behind astronaut
        const camDistance = 4.5;
        const camHeight = 2.2;
        const behindVec = new THREE.Vector3(
          -Math.cos(this.yaw) * Math.cos(this.pitch) * camDistance,
          Math.max(0.4, camHeight - Math.sin(this.pitch) * camDistance),
          -Math.sin(this.yaw) * Math.cos(this.pitch) * camDistance
        );

        // Rotate behindVec by gravity inclination
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), upVec);
        behindVec.applyQuaternion(quat);

        this.camera.position.copy(behindVec);
        const targetPos = this.astronaut.group.position.clone().add(upVec.clone().multiplyScalar(1.5));
        this.camera.lookAt(targetPos);
        break;
      }

      case CAMERA_MODES.MACRO_ORBIT: {
        // Cosmic view: OrbitControls manages camera position around Earth
        // Beacon marker highlights current player position on the macro plank
        this.beaconMesh.position.set(0, 0, 0);
        break;
      }
    }
  }
}
