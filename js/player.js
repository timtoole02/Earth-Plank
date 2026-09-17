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
 * Builds a stylized 3D astronaut mesh.
 */
function createAstronautMesh() {
  const group = new THREE.Group();

  // White suit material
  const suitMat = new THREE.MeshStandardMaterial({
    color: 0xeeeeee,
    roughness: 0.4,
    metalness: 0.1
  });

  // Visor gold reflective material
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0xffb700,
    roughness: 0.1,
    metalness: 0.95
  });

  // Dark joints/accents
  const jointMat = new THREE.MeshStandardMaterial({
    color: 0x22262c,
    roughness: 0.8
  });

  // Helper to enable shadows on mesh
  const addMesh = (mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };

  // Torso
  const torsoGeo = new THREE.BoxGeometry(0.7, 0.85, 0.45);
  const torso = new THREE.Mesh(torsoGeo, suitMat);
  torso.position.y = 1.1;
  addMesh(torso);

  // Life support backpack
  const packGeo = new THREE.BoxGeometry(0.55, 0.7, 0.3);
  const pack = new THREE.Mesh(packGeo, suitMat);
  pack.position.set(-0.28, 1.15, 0); // on astronaut's back
  addMesh(pack);

  // Thruster nozzles
  const nozzleGeo = new THREE.CylinderGeometry(0.06, 0.1, 0.15, 8);
  const leftNozzle = new THREE.Mesh(nozzleGeo, jointMat);
  leftNozzle.position.set(-0.35, 0.75, -0.15);
  addMesh(leftNozzle);
  const rightNozzle = new THREE.Mesh(nozzleGeo, jointMat);
  rightNozzle.position.set(-0.35, 0.75, 0.15);
  addMesh(rightNozzle);

  // Helmet
  const helmetGeo = new THREE.SphereGeometry(0.28, 16, 16);
  const helmet = new THREE.Mesh(helmetGeo, suitMat);
  helmet.position.y = 1.75;
  addMesh(helmet);

  // Visor (facing forward +X)
  const visorGeo = new THREE.SphereGeometry(0.24, 16, 16, 0, Math.PI, 0, Math.PI);
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.rotation.z = -Math.PI / 2;
  visor.position.set(0.1, 1.75, 0);
  addMesh(visor);

  // Left & Right Legs
  const legGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.8, 12);
  const leftLeg = new THREE.Mesh(legGeo, suitMat);
  leftLeg.position.set(0, 0.45, -0.2);
  addMesh(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, suitMat);
  rightLeg.position.set(0, 0.45, 0.2);
  addMesh(rightLeg);

  // Left & Right Arms
  const armGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.7, 12);
  const leftArm = new THREE.Mesh(armGeo, suitMat);
  leftArm.position.set(0, 1.05, -0.42);
  addMesh(leftArm);

  const rightArm = new THREE.Mesh(armGeo, suitMat);
  rightArm.position.set(0, 1.05, 0.42);
  addMesh(rightArm);

  return {
    group,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    animate(walkCycle, isMoving) {
      if (isMoving) {
        leftLeg.rotation.z = Math.sin(walkCycle) * 0.45;
        rightLeg.rotation.z = -Math.sin(walkCycle) * 0.45;
        leftArm.rotation.z = -Math.sin(walkCycle) * 0.45;
        rightArm.rotation.z = Math.sin(walkCycle) * 0.45;
      } else {
        leftLeg.rotation.z = 0;
        rightLeg.rotation.z = 0;
        leftArm.rotation.z = 0;
        rightArm.rotation.z = 0;
      }
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
