/**
 * atmosphere.js - Physically based sky: Rayleigh, Mie and ozone single scattering.
 *
 * A small "sky-view" lookup table is rebuilt every frame for the camera's
 * altitude and sun angle. The sky dome, ocean reflections, Earth haze, clouds
 * and the image-based lighting all sample the same table, so they agree.
 */
import * as THREE from 'three';
import { EARTH_RADIUS } from './physics.js';

export const ATMOSPHERE_HEIGHT = 100000;
const RAYLEIGH = [5.802e-6, 13.558e-6, 33.1e-6];
const RAYLEIGH_H = 8000;
const MIE_SCATTER = 9e-6;
const MIE_EXTINCT = 10e-6;
const MIE_H = 1200;
const OZONE = [0.65e-6, 1.881e-6, 0.085e-6];
// Radiance scale of the sun. Chosen so a lit white surface and a clear
// daytime sky sit in a similar range before exposure, like a real camera.
export const SUN_INTENSITY = 10;

const LUT_W = 192, LUT_H = 108;

// Shared GLSL: any material can include this and call skyRadiance(dir).
export const ATMOSPHERE_PARS = /* glsl */`
  uniform sampler2D skyLut;
  uniform vec3 skyUp;
  uniform vec3 skySunH;
  uniform float skyDip;
  uniform vec3 skySunDir;
  uniform vec3 sunRadiance;
  uniform float skyAir;
  uniform float cameraAltitude;
  #ifndef PI
  #define PI 3.141592653589793
  #endif
  vec2 skyLutUv(vec3 d) {
    float s = clamp(dot(d, skyUp), -1.0, 1.0);
    float el = asin(s);
    vec3 h = d - skyUp * s;
    float lh = length(h);
    float c = lh > 1e-5 ? dot(h / lh, skySunH) : 1.0;
    float u = acos(clamp(c, -1.0, 1.0)) / PI;
    float v = el >= -skyDip
      ? 0.5 + 0.5 * sqrt(clamp((el + skyDip) / (0.5 * PI + skyDip), 0.0, 1.0))
      : 0.5 - 0.5 * sqrt(clamp((-skyDip - el) / (0.5 * PI - skyDip), 0.0, 1.0));
    return vec2(u, v);
  }
  vec3 skyRadiance(vec3 d) { return texture2D(skyLut, skyLutUv(d)).rgb; }
  // Mean of exp(-s) over [0, x]; tends to 1 for flat paths.
  float pathAverage(float x) { return x < 1e-3 ? 1.0 - 0.5 * x : (1.0 - exp(-x)) / x; }
  // Transmittance of air over a straight path of the given length.
  vec3 airTransmittance(float dist, vec3 d) {
    float h = max(cameraAltitude, 0.0);
    // Average density along the path, lower for rays that climb.
    float climb = max(dot(d, skyUp), 0.0) * dist;
    float rh = exp(-h / ${RAYLEIGH_H}.0) * pathAverage(climb / ${RAYLEIGH_H}.0);
    float mh = exp(-h / ${MIE_H}.0) * pathAverage(climb / ${MIE_H}.0);
    vec3 ext = vec3(${RAYLEIGH.join(',')}) * rh + ${MIE_EXTINCT} * mh;
    return exp(-ext * dist);
  }
`;

const LUT_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform float altitude;
  uniform float sunElevation;
  uniform float sunIntensity;
  #define PI 3.141592653589793
  const float Rg = ${EARTH_RADIUS.toFixed(1)};
  const float Rt = ${(EARTH_RADIUS + ATMOSPHERE_HEIGHT).toFixed(1)};
  const vec3 betaR = vec3(${RAYLEIGH.join(',')});
  const float betaMs = ${MIE_SCATTER};
  const float betaMe = ${MIE_EXTINCT};
  const vec3 betaO = vec3(${OZONE.join(',')});

  // Far root of a sphere centred on the planet, for a ray starting inside it.
  float exitSphere(float r, float mu, float R) {
    float disc = R * R - r * r * (1.0 - mu * mu);
    return -r * mu + sqrt(max(disc, 0.0));
  }
  // Distance to the ground, or -1. Uses (r-Rg) directly to keep precision.
  float hitGround(float r, float mu) {
    if (mu >= 0.0) return -1.0;
    float s = sqrt(max(0.0, 1.0 - mu * mu));
    float disc = ((Rg - r) + r * mu * mu / (1.0 + s)) * (Rg + r * s);
    if (disc < 0.0) return -1.0;
    float c = (r - Rg) * (r + Rg);
    return c / (-r * mu + sqrt(disc));
  }
  vec3 densities(float h) {
    float o = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0);
    return vec3(exp(-h / ${RAYLEIGH_H}.0), exp(-h / ${MIE_H}.0), o);
  }
  vec3 extinction(vec3 od) { return betaR * od.x + betaMe * od.y + betaO * od.z; }

  vec3 sunTransmittance(vec3 p, vec3 sun) {
    float r = length(p);
    float mu = dot(p / r, sun);
    if (hitGround(r, mu) > 0.0) return vec3(0.0);
    float tMax = exitSphere(r, mu, Rt);
    vec3 od = vec3(0.0);
    const int N = 10;
    float dt = tMax / float(N);
    for (int i = 0; i < N; i++) {
      vec3 q = p + sun * (float(i) + 0.5) * dt;
      od += densities(length(q) - Rg) * dt;
    }
    return exp(-extinction(od));
  }

  void main() {
    float h = altitude;
    float dip = acos(clamp(Rg / (Rg + h), 0.0, 1.0));
    float el;
    if (vUv.y >= 0.5) { float c = (vUv.y - 0.5) * 2.0; el = c * c * (0.5 * PI + dip) - dip; }
    else { float c = (0.5 - vUv.y) * 2.0; el = -dip - c * c * (0.5 * PI - dip); }
    float az = vUv.x * PI;
    vec3 dir = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
    vec3 sun = vec3(cos(sunElevation), sin(sunElevation), 0.0);
    float r = Rg + h;
    vec3 origin = vec3(0.0, r, 0.0);
    float mu = dir.y;
    float tGround = hitGround(r, mu);
    float tMax = tGround > 0.0 ? tGround : exitSphere(r, mu, Rt);
    float cosT = dot(dir, sun);
    float phaseR = 3.0 / (16.0 * PI) * (1.0 + cosT * cosT);
    const float g = 0.8;
    float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + cosT * cosT)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));
    vec3 sum = vec3(0.0);
    vec3 od = vec3(0.0);
    const int N = 32;
    float prevT = 0.0;
    for (int i = 0; i < N; i++) {
      // Quadratic spacing: dense near the camera where density changes fast.
      float f = (float(i) + 1.0) / float(N);
      float t = tMax * f * f;
      float dt = t - prevT;
      float tm = 0.5 * (t + prevT);
      prevT = t;
      vec3 p = origin + dir * tm;
      float hp = length(p) - Rg;
      vec3 d = densities(hp);
      od += d * dt;
      vec3 viewT = exp(-extinction(od));
      vec3 sunT = sunTransmittance(p, sun);
      vec3 scatter = betaR * d.x * phaseR + betaMs * d.y * phaseM;
      // Cheap isotropic multiple-scattering term keeps twilight from going black.
      vec3 ms = (betaR * d.x + betaMs * d.y) * 0.06 * max(sun.y + 0.15, 0.0);
      sum += viewT * (sunT * scatter + ms) * dt;
    }
    gl_FragColor = vec4(sum * sunIntensity, 1.0);
  }
`;

function fullscreenScene(material) {
  const scene = new THREE.Scene();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  scene.add(quad);
  return scene;
}
export { fullscreenScene };
export const FULLSCREEN_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** Sun transmittance through the atmosphere at a given altitude (CPU, for light colour). */
export function sunTransmittance(altitude, sunElevation) {
  const r = EARTH_RADIUS + Math.max(0, altitude);
  const mu = Math.sin(sunElevation);
  // Ground occlusion: sun below the geometric horizon.
  if (mu < 0 && r * r * (1 - mu * mu) < EARTH_RADIUS * EARTH_RADIUS) return [0, 0, 0];
  const R = EARTH_RADIUS + ATMOSPHERE_HEIGHT;
  if (r >= R) return [1, 1, 1];
  const tMax = -r * mu + Math.sqrt(Math.max(0, R * R - r * r * (1 - mu * mu)));
  const N = 48, dt = tMax / N;
  let odR = 0, odM = 0, odO = 0;
  const cosE = Math.cos(sunElevation);
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) * dt;
    const x = cosE * t, y = r + mu * t;
    const h = Math.hypot(x, y) - EARTH_RADIUS;
    odR += Math.exp(-h / RAYLEIGH_H) * dt;
    odM += Math.exp(-h / MIE_H) * dt;
    odO += Math.max(0, 1 - Math.abs(h - 25000) / 15000) * dt;
  }
  return [0, 1, 2].map(c => Math.exp(-(RAYLEIGH[c] * odR + MIE_EXTINCT * odM + OZONE[c] * odO)));
}

export class Atmosphere {
  constructor(renderer, sunDirection) {
    this.renderer = renderer;
    this.sunDirection = sunDirection;
    this.lutTarget = new THREE.WebGLRenderTarget(LUT_W, LUT_H, {
      type: THREE.HalfFloatType, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping
    });
    this.lutMaterial = new THREE.ShaderMaterial({
      uniforms: { altitude: { value: 2 }, sunElevation: { value: 0.3 }, sunIntensity: { value: SUN_INTENSITY } },
      vertexShader: FULLSCREEN_VERTEX, fragmentShader: LUT_FRAGMENT, depthTest: false, depthWrite: false
    });
    this.lutScene = fullscreenScene(this.lutMaterial);
    this.lutCamera = new THREE.Camera();

    // Shared by reference with every material that includes ATMOSPHERE_PARS.
    this.uniforms = {
      skyLut: { value: this.lutTarget.texture },
      skyUp: { value: new THREE.Vector3(0, 1, 0) },
      skySunH: { value: new THREE.Vector3(1, 0, 0) },
      skyDip: { value: 0 },
      skySunDir: { value: sunDirection.clone() },
      sunRadiance: { value: new THREE.Vector3(1, 1, 1) },
      skyAir: { value: 1 },
      cameraAltitude: { value: 2 }
    };
    this.sunColor = new THREE.Color(1, 1, 1);
    this.transmittance = [1, 1, 1];
    this.zenith = new THREE.Color();
    this.horizon = new THREE.Color();
  }

  /**
   * @param up        unit vector from Earth's centre to the camera (world space)
   * @param altitude  camera altitude in metres
   * @param air       0 in orbit view, 1 inside the atmosphere (visual fade)
   */
  update(up, altitude, air) {
    const u = this.uniforms;
    const h = THREE.MathUtils.clamp(altitude, 1, ATMOSPHERE_HEIGHT - 5000);
    const sin = THREE.MathUtils.clamp(this.sunDirection.dot(up), -1, 1);
    const sunElevation = Math.asin(sin);
    u.skyUp.value.copy(up);
    u.skySunH.value.copy(this.sunDirection).addScaledVector(up, -sin);
    if (u.skySunH.value.lengthSq() < 1e-8) u.skySunH.value.set(1, 0, 0).addScaledVector(up, -up.x);
    u.skySunH.value.normalize();
    u.skyDip.value = Math.acos(EARTH_RADIUS / (EARTH_RADIUS + h));
    u.skySunDir.value.copy(this.sunDirection);
    u.skyAir.value = air;
    u.cameraAltitude.value = Math.max(0, altitude);
    this.lutMaterial.uniforms.altitude.value = h;
    this.lutMaterial.uniforms.sunElevation.value = sunElevation;

    this.transmittance = sunTransmittance(Math.max(0, altitude), sunElevation);
    const t = this.transmittance;
    u.sunRadiance.value.set(t[0], t[1], t[2]).multiplyScalar(SUN_INTENSITY);
    this.sunColor.setRGB(t[0], t[1], t[2]);

    const target = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.lutTarget);
    this.renderer.render(this.lutScene, this.lutCamera);
    this.renderer.setRenderTarget(target);
  }
}

/** Camera-centred sky dome that samples the LUT. */
export function createSkyDome(atmosphere, { forEnvironment = false } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere.uniforms, cloud: { value: 0 }, cloudColor: { value: new THREE.Color(0.8, 0.85, 0.89) } },
    vertexShader: /* glsl */`
      varying vec3 direction;
      void main() { direction = (modelMatrix * vec4(position, 0.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      varying vec3 direction; uniform float cloud; uniform vec3 cloudColor;
      ${ATMOSPHERE_PARS}
      void main() {
        vec3 d = normalize(direction);
        vec3 sky = skyRadiance(d);
        ${forEnvironment ? `
        // Environment only: stand-in for sunlit sea below the horizon.
        float below = smoothstep(0.0, -0.08, dot(d, skyUp));
        vec3 ground = vec3(0.012, 0.03, 0.05) * (sunRadiance * max(dot(skySunDir, skyUp), 0.0) + skyRadiance(skyUp) * 2.0);
        sky = mix(sky, sky + ground, below);` : ''}
        sky *= skyAir;
        gl_FragColor = vec4(mix(sky, cloudColor, cloud), 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(forEnvironment ? 50 : 100, 48, 24), material);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return mesh;
}
