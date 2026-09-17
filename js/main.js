/**
 * main.js - Application entry point, Three.js loop, dynamic atmosphere, and system integration
 */
import * as THREE from 'three';
import { WeatherSystem } from './weather.js?v=clouds-1';
import { ArrivalIntro } from './intro.js?v=clouds-1';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { createEarthSystem } from './earth.js?v=clouds-1';
import { createPlankSystem } from './plank.js?v=clouds-1';
import { PlayerController, CAMERA_MODES } from './player.js?v=clouds-1';
import { SoundSystem } from './audio.js';
import { HUD } from './hud.js?v=clouds-1';
import { calculatePlankPhysics, EARTH_RADIUS } from './physics.js';

class App {
  constructor() {
    this.container = document.getElementById('viewport');

    // 1. Three.js Scene & Renderer with Logarithmic Depth Buffer for planetary scale
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.2, 500000000);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // 2. Orbit Controls (active in MACRO_ORBIT mode)
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.minDistance = EARTH_RADIUS * 1.05;
    this.orbitControls.maxDistance = EARTH_RADIUS * 8;
    this.orbitControls.enabled = false;

    // 3. Lighting (The Sun & Cosmic Fill)
    this.setupLighting();

    // 4. Earth System & Plank System
    this.earthSystem = createEarthSystem();
    this.scene.add(this.earthSystem.group);

    this.plankSystem = createPlankSystem();
    this.scene.add(this.plankSystem.group);

    this.weather = new WeatherSystem(this.scene);

    // 5. Sound & Player Controller
    this.soundSystem = new SoundSystem();
    this.player = new PlayerController(this.camera, this.renderer.domElement, this.orbitControls);
    this.scene.add(this.player.astronaut.group);
    this.scene.add(this.player.beaconMesh);

    // 6. HUD Telemetry & Inclinometer
    this.hud = new HUD(this.player, this.soundSystem);

    // 7. Clock for animation loop
    this.clock = new THREE.Clock();

    // Resize handling
    window.addEventListener('resize', () => this.onResize());

    // Gesture audio trigger
    window.addEventListener('click', () => this.soundSystem.init(), { once: true });
    window.addEventListener('keydown', () => this.soundSystem.init(), { once: true });

    this.intro = new ArrivalIntro(this);
    // Start loop
    this.animate();
  }

  setupLighting() {
    // Distant Sunlight illuminating the Earth and plank from space
    const sunLight = new THREE.DirectionalLight(0xfff4e4, 2.8);
    const sunPos = new THREE.Vector3(18000000, 17000000, -65000000);
    this.sunDirection = sunPos.clone().normalize();
    this.sunLight = sunLight;
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 1200;
    Object.assign(sunLight.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60 });
    sunLight.shadow.normalBias = 0.03;
    sunLight.shadow.bias = -0.0001;
    this.scene.add(sunLight, sunLight.target);

    // Visible Sun Mesh
    const sunGeo = new THREE.SphereGeometry(EARTH_RADIUS * 0.4, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.position.copy(sunPos);
    this.scene.add(sunMesh);

    // Soft radial halo, always facing the camera.
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 128;
    const glowContext = glowCanvas.getContext('2d');
    const glowGradient = glowContext.createRadialGradient(64,64,0,64,64,64);
    glowGradient.addColorStop(0,'rgba(255,248,222,0.6)');
    glowGradient.addColorStop(0.3,'rgba(255,235,186,0.25)');
    glowGradient.addColorStop(1,'rgba(255,225,160,0)');
    glowContext.fillStyle = glowGradient; glowContext.fillRect(0,0,128,128);
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(glowCanvas),transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
    sunGlow.position.copy(sunPos);
    sunGlow.scale.setScalar(EARTH_RADIUS * 1.8);
    this.scene.add(sunGlow);

    // Soft celestial ambient light
    const ambientLight = new THREE.AmbientLight(0x7893b1, 0.35);
    this.ambientLight = ambientLight;
    this.scene.add(ambientLight);

    // Subtle blue Earth-shine fill light from below
    const earthShine = new THREE.DirectionalLight(0x1a4b88, 0.6);
    earthShine.position.set(0, -1, 0);
    this.scene.add(earthShine);
    this.skyFill = new THREE.HemisphereLight(0xc7e2ff, 0x485567, 1.3);
    this.scene.add(this.skyFill);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
      uniforms: { air: { value: 1 }, cloud: { value: 0 }, up: { value: new THREE.Vector3(0, 1, 0) }, sun: { value: this.sunDirection } },
      vertexShader: `varying vec3 direction;
        void main() { direction = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 direction; uniform float air; uniform float cloud; uniform vec3 up; uniform vec3 sun;
        void main() {
          vec3 ray = normalize(direction);
          float height = max(0.0, dot(ray, up));
          vec3 sky = mix(vec3(0.66, 0.79, 0.88), vec3(0.12, 0.36, 0.68), pow(height, 0.45));
          float glow = pow(max(0.0, dot(ray, sun)), 32.0);
          sky += vec3(0.28, 0.22, 0.12) * glow;
          vec3 background = mix(vec3(0.002, 0.004, 0.009), sky, air);
          gl_FragColor = vec4(mix(background, vec3(0.80,0.85,0.89), cloud), 1.0);
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false
    }));
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  updateSkyAtmosphere(altitude) {
    const orbit = this.player.cameraMode === CAMERA_MODES.MACRO_ORBIT;
    const air = orbit ? 0 : Math.exp(-Math.max(0, altitude) / 18000);
    this.sky.position.copy(this.camera.position);
    this.sky.material.uniforms.air.value = air;
    this.sky.material.uniforms.up.value.set(this.player.worldX, EARTH_RADIUS, this.player.worldZ).normalize();
    this.earthSystem.starMat.uniforms.visibility.value = Math.pow(1 - air, 3) * 0.75;
    const atmosphereFade = orbit ? 1 : THREE.MathUtils.smoothstep(altitude, 90000, 140000);
    this.earthSystem.atmosphereMesh.material.uniforms.visibility.value = atmosphereFade;
    // Fade the global cloud shell before crossing its geometry, not at the crossing.
    this.earthSystem.cloudMesh.material.opacity = 0.8 * (orbit ? 1 : THREE.MathUtils.smoothstep(altitude, 9000, 16000));
    const cinematic = this.intro?.active ? 1 - THREE.MathUtils.smoothstep(this.intro.elapsed, 25, 29) : 0;
    this.skyFill.intensity = THREE.MathUtils.lerp(0.15 + air * 1.15, 1.8, cinematic);
    this.ambientLight.intensity = THREE.MathUtils.lerp(0.35, 1.4, cinematic);
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(500);
    // Keep the shadow shader variant stable across the walking handoff.
    this.sunLight.shadow.autoUpdate = !orbit;
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = Math.min(this.clock.getDelta(), 0.1);

    // 1. Update Player Physics & Camera
    if (this.intro.active) this.intro.update(delta);
    else this.player.update(delta);

    // 2. Floating Origin Updates:
    // Update Earth and Plank relative to player's current world position
    this.earthSystem.update(delta, this.player.worldX, this.player.worldZ);
    this.plankSystem.update(this.player.worldX, this.player.worldZ);

    // 3. Macro Orbit Mode handling
    if (this.player.cameraMode === CAMERA_MODES.MACRO_ORBIT) {
      this.orbitControls.target.set(-this.player.worldX, -EARTH_RADIUS, -this.player.worldZ);
      this.orbitControls.update();
      this.player.beaconMesh.visible = true;
    } else {
      this.player.beaconMesh.visible = false;
    }

    // 4. Update dynamic atmosphere sky color
    const physics = calculatePlankPhysics(this.player.worldX);
    this.updateSkyAtmosphere(this.intro.active ? this.intro.altitude : physics.altitude);
    this.weather.update(delta, this.player, this.camera, {
      intro: this.intro.active,
      orbit: this.player.cameraMode === CAMERA_MODES.MACRO_ORBIT,
      altitude: this.intro.active ? this.intro.altitude : physics.altitude
    });
    this.sky.material.uniforms.cloud.value = 1 - Math.exp(-this.weather.density * 600);
    this.intro.moon.position.set(-22000000 - this.player.worldX, 9500000, -46000000 - this.player.worldZ);

    // Billboard signs should not clip across the lens on the final descent.
    for (const sign of this.plankSystem.milestoneGroup.children) {
      if (!sign.isSprite) continue;
      const distance = this.camera.position.distanceTo(sign.getWorldPosition(new THREE.Vector3()));
      sign.material.opacity = this.intro.active ? THREE.MathUtils.smoothstep(distance, 35, 120) : 1;
    }

    // 5. Update HUD and Sound System
    this.hud.update();
    const speed = Math.sqrt(this.player.vx * this.player.vx + this.player.vz * this.player.vz);
    this.soundSystem.update(speed, physics.airDensityRatio, speed > 0.1);

    // 6. Render
    this.renderer.render(this.scene, this.camera);
  }
}

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  new App();
});
