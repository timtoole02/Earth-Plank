/**
 * main.js - Application entry point, Three.js loop, dynamic atmosphere, and system integration
 */
import * as THREE from 'three';
import { WeatherSystem } from './weather.js?v=realism-1';
import { ArrivalIntro } from './intro.js?v=realism-1';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { createEarthSystem, EARTH_VISUAL_DROP } from './earth.js?v=realism-1';
import { createPlankSystem } from './plank.js?v=realism-1';
import { PlayerController, CAMERA_MODES } from './player.js?v=realism-1';
import { SoundSystem } from './audio.js?v=music-2';
import { Atmosphere, createSkyDome } from './atmosphere.js';
import { createOcean } from './ocean.js';
import { VolumetricClouds } from './clouds.js';
import { PostProcessing } from './postfx.js';
import { HUD } from './hud.js?v=realism-1';
import { calculatePlankPhysics, EARTH_RADIUS } from './physics.js';

class App {
  constructor() {
    this.container = document.getElementById('viewport');

    // 1. Three.js Scene & Renderer with Logarithmic Depth Buffer for planetary scale
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.2, 500000000);

    // Antialiasing, tone mapping and colour output happen in the HDR post chain.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NoToneMapping;
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
    this.earthSystem = createEarthSystem(this.atmosphere, this.sunDirection);
    this.scene.add(this.earthSystem.group);
    const landMask = new THREE.TextureLoader().load('assets/earth_specular_2048.jpg');
    this.ocean = createOcean(this.atmosphere, landMask, this.earthSystem.earthMesh, EARTH_RADIUS + EARTH_VISUAL_DROP);
    this.scene.add(this.ocean.mesh);
    this.clouds = new VolumetricClouds(this.renderer, this.atmosphere, this.scene);
    this.earthSystem.setCloudDetail(this.clouds.noise);
    this.post = new PostProcessing(this.renderer);
    this.onResize();

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
    const sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
    const sunPos = new THREE.Vector3(18000000, 17000000, -65000000);
    this.sunDirection = sunPos.clone().normalize();
    this.sunLight = sunLight;
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(4096, 4096);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 1200;
    Object.assign(sunLight.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60 });
    sunLight.shadow.normalBias = 0.03;
    sunLight.shadow.bias = -0.0001;
    sunLight.shadow.radius = 2;
    this.scene.add(sunLight, sunLight.target);

    this.atmosphere = new Atmosphere(this.renderer, this.sunDirection);

    // Visible Sun: an HDR disc (about twice the real angular size) that the
    // bloom turns into glare. Its colour follows the atmosphere's transmittance.
    const sunGeo = new THREE.SphereGeometry(EARTH_RADIUS * 0.1, 32, 32);
    this.sunMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
    const sunMesh = new THREE.Mesh(sunGeo, this.sunMat);
    sunMesh.position.copy(sunPos);
    this.scene.add(sunMesh);

    // Soft radial halo, always facing the camera.
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 128;
    const glowContext = glowCanvas.getContext('2d');
    const glowGradient = glowContext.createRadialGradient(64,64,0,64,64,64);
    glowGradient.addColorStop(0,'rgba(255,248,222,0.5)');
    glowGradient.addColorStop(0.2,'rgba(255,235,186,0.12)');
    glowGradient.addColorStop(1,'rgba(255,225,160,0)');
    glowContext.fillStyle = glowGradient; glowContext.fillRect(0,0,128,128);
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(glowCanvas),transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false,fog:false}));
    this.sunGlow.position.copy(sunPos);
    this.sunGlow.scale.setScalar(EARTH_RADIUS * 1.2);
    this.scene.add(this.sunGlow);

    // Soft celestial ambient light
    const ambientLight = new THREE.AmbientLight(0x7893b1, 0.08);
    this.ambientLight = ambientLight;
    this.scene.add(ambientLight);

    // Subtle blue Earth-shine fill light from below
    const earthShine = new THREE.DirectionalLight(0x1a4b88, 0.35);
    earthShine.position.set(0, -1, 0);
    this.earthShine = earthShine;
    this.scene.add(earthShine);
    this.skyFill = new THREE.HemisphereLight(0xc7e2ff, 0x485567, 0.2);
    this.scene.add(this.skyFill);

    this.sky = createSkyDome(this.atmosphere);
    this.scene.add(this.sky);

    // Image-based lighting from the same sky, refreshed as the view changes.
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envScene = new THREE.Scene();
    this.envScene.add(createSkyDome(this.atmosphere, { forEnvironment: true }));
    this.envTarget = null;
    this.envState = { air: -1, up: new THREE.Vector3(), age: 0 };
    this.earthCenter = new THREE.Vector3();
    this.cameraUp = new THREE.Vector3(0, 1, 0);
  }

  updateEnvironment(delta, air) {
    const state = this.envState;
    state.age += delta;
    const turned = state.up.dot(this.cameraUp) < 0.99985;
    if (state.air >= 0 && state.age < 0.2) return;
    if (state.air >= 0 && Math.abs(state.air - air) < 0.01 && !turned) return;
    state.air = air; state.up.copy(this.cameraUp); state.age = 0;
    const next = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
    this.scene.environment = next.texture;
    this.envTarget?.dispose();
    this.envTarget = next;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const ratio = this.renderer.getPixelRatio();
    this.post?.setSize(window.innerWidth, window.innerHeight, ratio);
    this.clouds?.setSize(window.innerWidth, window.innerHeight, ratio);
  }

  updateSkyAtmosphere(altitude, delta) {
    const orbit = this.player.cameraMode === CAMERA_MODES.MACRO_ORBIT;
    // Camera height above the visual sea level, measured from the real centre.
    this.earthCenter.copy(this.earthSystem.group.position);
    const rel = this.camera.position.clone().sub(this.earthCenter);
    const cameraAltitude = rel.length() - EARTH_RADIUS - EARTH_VISUAL_DROP;
    this.cameraUp.copy(rel).normalize();
    const air = orbit ? 0 : 1 - THREE.MathUtils.smoothstep(cameraAltitude, 70000, 140000);
    this.atmosphere.update(this.cameraUp, cameraAltitude, air);
    this.cameraAltitude = cameraAltitude;
    this.sky.position.copy(this.camera.position);

    const t = this.atmosphere.transmittance;
    this.sunLight.color.setRGB(t[0], t[1], t[2]);
    this.sunMat.color.setRGB(t[0], t[1], t[2]).multiplyScalar(60);
    this.sunGlow.material.color.setRGB(t[0], t[1], t[2]);
    this.earthSystem.starMat.uniforms.visibility.value = Math.pow(1 - Math.min(1, Math.exp(-Math.max(0, cameraAltitude) / 18000) * (orbit ? 0 : 1)), 3) * 0.75;
    const atmosphereFade = orbit ? 1 : THREE.MathUtils.smoothstep(altitude, 90000, 140000);
    this.earthSystem.atmosphereMesh.material.uniforms.visibility.value = atmosphereFade;
    // The volumetric layer owns the low sky; the textured shell takes over from high up.
    this.earthSystem.cloudMesh.material.opacity = 0.8 * (orbit ? 1 : THREE.MathUtils.smoothstep(cameraAltitude, 20000, 40000));
    const cinematic = this.intro?.active ? 1 - THREE.MathUtils.smoothstep(this.intro.elapsed, 25, 29) : 0;
    this.skyFill.intensity = THREE.MathUtils.lerp(0.05 + air * 0.25, 0.9, cinematic);
    this.ambientLight.intensity = THREE.MathUtils.lerp(0.08, 0.6, cinematic);
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(500);
    // The deck's under-fill would otherwise paint a highlight on the night side.
    this.earthShine.intensity = orbit ? 0 : 0.35;
    // Keep the shadow shader variant stable across the walking handoff.
    this.sunLight.shadow.autoUpdate = !orbit;
    this.updateEnvironment(delta, air);
    return { orbit, air, cameraAltitude };
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = Math.min(this.clock.getDelta(), 0.1);

    // 1. Update Player Physics & Camera
    if (this.intro.active) this.intro.update(delta);
    else this.player.update(delta);

    // 2. Floating Origin Updates:
    // Update Earth and Plank relative to player's current world position
    this.earthSystem.update(delta, this.player.worldX, this.player.worldZ, this.cameraAltitude);
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
    const { orbit, cameraAltitude } = this.updateSkyAtmosphere(this.intro.active ? this.intro.altitude : physics.altitude, delta);
    this.weather.update(delta, this.player, this.camera, {
      intro: this.intro.active,
      orbit,
      altitude: this.intro.active ? this.intro.altitude : physics.altitude
    });
    // In-cloud mist takes the colour of sun- and sky-lit water droplets.
    const t = this.atmosphere.transmittance;
    this.weather.fog.color.setRGB(0.1 + t[0] * 0.55, 0.12 + t[1] * 0.55, 0.16 + t[2] * 0.55);
    this.sky.material.uniforms.cloud.value = 1 - Math.exp(-this.weather.density * 600);
    this.sky.material.uniforms.cloudColor.value.copy(this.weather.fog.color);
    this.ocean.update(delta, this.player, this.earthCenter, cameraAltitude, !orbit);
    const cloudFade = orbit ? 0 : 1 - THREE.MathUtils.smoothstep(cameraAltitude, 20000, 40000);
    this.clouds.update(delta, this.camera, this.earthCenter, EARTH_RADIUS + EARTH_VISUAL_DROP, this.player, this.weather.fog, cloudFade);
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

    // 6. Render (HDR scene -> bloom -> filmic tone map)
    this.post.render(this.scene, this.camera, delta);
  }
}

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  // Handy for inspecting the scene from devtools: open with ?debug
  if (new URLSearchParams(location.search).has('debug')) window.earthPlank = app;
});
