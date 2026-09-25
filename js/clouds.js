/**
 * clouds.js - Raymarched volumetric cumulus layer.
 *
 * Clouds live in a spherical shell around the real Earth centre. Density comes
 * from tileable Perlin-Worley noise, light is marched toward the sun with a
 * multiple-scattering approximation, and ambient light comes from the same
 * scattering sky as everything else. The march runs at half resolution; a
 * full-screen composite in the main scene depth-tests it at full resolution so
 * the deck, rails and astronaut stay crisp in front of the clouds.
 */
import * as THREE from 'three';
import { ATMOSPHERE_PARS, fullscreenScene, FULLSCREEN_VERTEX } from './atmosphere.js';

export const CLOUD_BASE = 1050;
export const CLOUD_TOP = 2350;
const MIN_START = 90;

// ---------- Tileable 3D noise, generated once at startup ----------
function createNoiseTexture(size = 64) {
  let seed = 1337;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

  function worleyPoints(cells) {
    const pts = new Float32Array(cells * cells * cells * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = rand();
    return pts;
  }
  function worley(x, y, z, cells, pts) {
    // x,y,z in [0,1); returns 1 - F1 (bright centres, tileable).
    const fx = x * cells, fy = y * cells, fz = z * cells;
    const cx = Math.floor(fx), cy = Math.floor(fy), cz = Math.floor(fz);
    let best = 1e9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ix = cx + dx, iy = cy + dy, iz = cz + dz;
      const wx = (ix % cells + cells) % cells, wy = (iy % cells + cells) % cells, wz = (iz % cells + cells) % cells;
      const k = ((wz * cells + wy) * cells + wx) * 3;
      const px = ix + pts[k] - fx, py = iy + pts[k + 1] - fy, pz = iz + pts[k + 2] - fz;
      const d = px * px + py * py + pz * pz;
      if (d < best) best = d;
    }
    return 1 - Math.min(1, Math.sqrt(best));
  }
  // Tileable gradient noise via hashed lattice with wrap.
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const grads = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function perlin(x, y, z, period) {
    const fx = x * period, fy = y * period, fz = z * period;
    const X = Math.floor(fx), Y = Math.floor(fy), Z = Math.floor(fz);
    const xf = fx - X, yf = fy - Y, zf = fz - Z;
    const g = (ix, iy, iz, dx, dy, dz) => {
      const h = perm[perm[perm[(ix % period + period) % period] + (iy % period + period) % period] + (iz % period + period) % period] % 12;
      const v = grads[h];
      return v[0] * dx + v[1] * dy + v[2] * dz;
    };
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const lerp = (a, b, t) => a + (b - a) * t;
    return lerp(
      lerp(lerp(g(X, Y, Z, xf, yf, zf), g(X + 1, Y, Z, xf - 1, yf, zf), u),
        lerp(g(X, Y + 1, Z, xf, yf - 1, zf), g(X + 1, Y + 1, Z, xf - 1, yf - 1, zf), u), v),
      lerp(lerp(g(X, Y, Z + 1, xf, yf, zf - 1), g(X + 1, Y, Z + 1, xf - 1, yf, zf - 1), u),
        lerp(g(X, Y + 1, Z + 1, xf, yf - 1, zf - 1), g(X + 1, Y + 1, Z + 1, xf - 1, yf - 1, zf - 1), u), v), w);
  }
  const w4 = worleyPoints(4), w8 = worleyPoints(8), w16 = worleyPoints(16), w32 = worleyPoints(32);
  const data = new Uint8Array(size * size * size * 4);
  const remap = (v, a, b, c, d) => c + (v - a) / (b - a) * (d - c);
  let o = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size, pz = z / size;
    const p = perlin(px, py, pz, 4) * 0.5 + perlin(px, py, pz, 8) * 0.25 + perlin(px, py, pz, 16) * 0.125;
    const pn = Math.min(1, Math.max(0, p * 0.9 + 0.5));
    const wLow = worley(px, py, pz, 4, w4) * 0.625 + worley(px, py, pz, 8, w8) * 0.25 + worley(px, py, pz, 16, w16) * 0.125;
    const wHigh = worley(px, py, pz, 8, w8) * 0.625 + worley(px, py, pz, 16, w16) * 0.25 + worley(px, py, pz, 32, w32) * 0.125;
    const perlinWorley = Math.min(1, Math.max(0, remap(pn, wLow - 1, 1, 0, 1)));
    data[o++] = perlinWorley * 255;
    data[o++] = wHigh * 255;
    data[o++] = pn * 255;
    data[o++] = wLow * 255;
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

// Shared shell intersection code (heights measured from the visual sea level).
const SHELL_GLSL = /* glsl */`
  uniform float camRadius;   // camera distance from Earth's centre
  uniform float camHeight;   // camera height above sea level
  uniform float groundRadius;
  uniform vec3 camUp;
  // Discriminant of a sphere of height H for a ray from height h (precise form).
  float shellDisc(float H, float mu) {
    float s = sqrt(max(0.0, 1.0 - mu * mu));
    return ((H - camHeight) + camRadius * mu * mu / (1.0 + s)) * (groundRadius + H + camRadius * s);
  }
  float shellNear(float H, float mu) {
    float disc = shellDisc(H, mu);
    if (disc < 0.0 || mu > 0.0) return -1.0;
    return (camHeight - H) * (camRadius + groundRadius + H) / (-camRadius * mu + sqrt(disc));
  }
  float shellFar(float H, float mu) {
    float disc = shellDisc(H, mu);
    if (disc < 0.0) return -1.0;
    return -camRadius * mu + sqrt(disc);
  }
  // Returns (start, end) of the cloud slab along the ray, or end < start.
  vec2 cloudInterval(vec3 dir, float base, float top, float maxDist) {
    float mu = dot(dir, camUp);
    float tGround = camHeight > 0.0 ? shellNear(0.0, mu) : -1.0;
    float t0, t1;
    if (camHeight < base) {
      if (tGround > 0.0) return vec2(1.0, 0.0);
      t0 = shellFar(base, mu); t1 = shellFar(top, mu);
    } else if (camHeight <= top) {
      t0 = 0.0; t1 = shellFar(top, mu);
      float tb = shellNear(base, mu);
      if (tb > 0.0) t1 = min(t1, tb);
    } else {
      t0 = shellNear(top, mu);
      if (t0 < 0.0) return vec2(1.0, 0.0);
      float tb = shellNear(base, mu);
      t1 = tb > 0.0 ? tb : shellFar(top, mu);
    }
    t0 = max(t0, ${MIN_START.toFixed(1)});
    t1 = min(t1, t0 + maxDist);
    return vec2(t0, t1);
  }
  float heightAt(float t, float mu) {
    float q = t * t + 2.0 * camRadius * t * mu;
    return camHeight + q / (sqrt(max(camRadius * camRadius + q, 0.0)) + camRadius);
  }
`;

const MARCH_FRAGMENT = /* glsl */`
  precision highp float;
  precision highp sampler3D;
  varying vec2 vUv;
  uniform sampler3D noise;
  uniform mat4 invProjection;
  uniform mat4 cameraWorld;
  uniform vec2 playerXZ;
  uniform vec2 wind;
  uniform float time;
  uniform float coverage;
  uniform float frame;
  uniform float fade;
  uniform float fogDensity;
  uniform vec3 fogColor;
  ${ATMOSPHERE_PARS}
  ${SHELL_GLSL}
  const float BASE = ${CLOUD_BASE.toFixed(1)};
  const float TOP = ${CLOUD_TOP.toFixed(1)};

  float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
  float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

  float density(vec3 p, float h, bool detail) {
    float hf = clamp((h - BASE) / (TOP - BASE), 0.0, 1.0);
    vec2 xz = p.xz + wind;
    vec4 weather = texture(noise, vec3(xz / 36000.0, 0.31));
    float cover = clamp(coverage + (weather.b - 0.5) * 1.3, 0.0, 1.0);
    // Flat bases, rounded towers that grow taller where coverage is high.
    float profile = smoothstep(0.0, 0.07, hf) * (1.0 - smoothstep(0.25 + 0.6 * weather.a, 1.0, hf));
    vec3 q = vec3(xz.x, h * 1.6, xz.y) / 4200.0;
    float base = texture(noise, q).r;
    float d = remap(base * profile, 1.0 - cover, 1.0, 0.0, 1.0);
    if (d <= 0.0) return 0.0;
    if (detail) {
      vec3 dq = vec3(xz.x + time * 3.0, h, xz.y) / 680.0;
      float wisps = texture(noise, dq).g;
      float erode = mix(wisps, 1.0 - wisps, clamp(hf * 4.0, 0.0, 1.0)) * 0.42;
      d = remap(d, erode, 1.0, 0.0, 1.0);
    }
    return max(d, 0.0) * 0.045;
  }

  void main() {
    vec4 clip = vec4(vUv * 2.0 - 1.0, -1.0, 1.0); // near plane: the far plane is 5e8 m away
    vec4 view = invProjection * clip;
    vec3 dir = normalize(mat3(cameraWorld) * (view.xyz / view.w));
    vec2 span = cloudInterval(dir, BASE, TOP, 36000.0);
    if (span.y <= span.x || fade <= 0.0) { gl_FragColor = vec4(0.0); return; }

    float mu = dot(dir, camUp);
    vec3 L = skySunDir;
    float cosT = dot(dir, L);
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy + frame * 5.588238, vec2(0.06711056, 0.00583715))));
    vec3 ambientTop = skyRadiance(camUp) * 1.6;
    vec3 ambientBottom = (sunRadiance * max(dot(L, camUp), 0.0) * 0.06 + ambientTop * 0.25);

    const int STEPS = 72;
    float T = 1.0;
    vec3 color = vec3(0.0);
    float depthSum = 0.0, weightSum = 0.0;
    float len = span.y - span.x;
    float prev = span.x;
    for (int i = 0; i < STEPS; i++) {
      float f = (float(i) + ign) / float(STEPS);
      float t = span.x + len * f * f;
      float dt = t - prev;
      prev = t;
      if (dt <= 0.0) continue;
      float h = heightAt(t, mu);
      vec3 p = vec3(playerXZ.x, 0.0, playerXZ.y) + dir * t;
      float sigma = density(p, h, true);
      if (sigma > 1e-5) {
        // Light march toward the sun with growing steps.
        float od = 0.0;
        float lt = 0.0;
        float ls = 45.0;
        for (int j = 0; j < 6; j++) {
          lt += ls;
          vec3 lp = p + L * lt;
          float lh = h + lt * dot(L, camUp);
          if (lh > TOP) break;
          od += density(lp, lh, false) * ls;
          ls *= 1.7;
        }
        // Multiple-scattering octaves (Wrenninge) + silver lining phase.
        float sun = 0.0;
        float a = 1.0, b = 1.0, c = 1.0;
        for (int k = 0; k < 3; k++) {
          float phase = mix(hg(cosT, 0.75 * c), hg(cosT, -0.25 * c), 0.3);
          sun += a * phase * exp(-od * b);
          a *= 0.5; b *= 0.45; c *= 0.5;
        }
        float powder = 1.0 - exp(-sigma * 2.0 * 60.0);
        float hf = clamp((h - BASE) / (TOP - BASE), 0.0, 1.0);
        vec3 ambient = mix(ambientBottom, ambientTop, hf);
        vec3 S = sigma * (sunRadiance * sun * mix(0.6, 1.0, powder) * 4.0 + ambient);
        float ext = exp(-sigma * dt);
        vec3 Sint = (S - S * ext) / sigma;
        color += T * Sint;
        float w = T * (1.0 - ext);
        depthSum += t * w; weightSum += w;
        T *= ext;
        if (T < 0.01) break;
      }
    }
    float alpha = 1.0 - T;
    if (alpha < 0.002) { gl_FragColor = vec4(0.0); return; }
    float dist = depthSum / max(weightSum, 1e-5);
    vec3 Tair = airTransmittance(dist, dir);
    color = color * Tair + skyRadiance(dir) * (1.0 - Tair) * alpha;
    float fogF = 1.0 - exp(-fogDensity * fogDensity * dist * dist);
    color = mix(color, fogColor * alpha, fogF);
    // Clouds far out thin into the haze instead of ending at a hard edge.
    float farFade = 1.0 - smoothstep(20000.0, 36000.0, dist);
    gl_FragColor = vec4(color, alpha) * fade * farFade;
  }
`;

const COMPOSITE_FRAGMENT = /* glsl */`
  precision highp float;
  uniform sampler2D clouds;
  uniform vec2 resolution;
  uniform mat4 invProjection;
  uniform mat4 cameraWorld;
  uniform float logDepthFC;
  uniform float fade;
  ${SHELL_GLSL}
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution;
    vec4 c = texture2D(clouds, uv);
    vec4 view = invProjection * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
    vec3 viewDir = normalize(view.xyz / view.w);
    vec3 dir = normalize(mat3(cameraWorld) * viewDir);
    vec2 span = cloudInterval(dir, ${CLOUD_BASE.toFixed(1)}, ${CLOUD_TOP.toFixed(1)}, 36000.0);
    // Depth at the slab entry: nearer geometry (deck, rails) stays in front.
    float viewZ = max(span.x, ${MIN_START.toFixed(1)}) * max(-viewDir.z, 1e-3);
    gl_FragDepth = log2(1.0 + viewZ) * logDepthFC * 0.5;
    if (c.a < 0.002 || fade <= 0.0) discard;
    gl_FragColor = c;
  }
`;

export class VolumetricClouds {
  constructor(renderer, atmosphere, scene) {
    this.renderer = renderer;
    this.noise = createNoiseTexture();
    this.frame = 0;
    this.time = 0;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const shell = {
      camRadius: { value: 0 }, camHeight: { value: 2 }, groundRadius: { value: 0 }, camUp: { value: new THREE.Vector3(0, 1, 0) },
      invProjection: { value: new THREE.Matrix4() }, cameraWorld: { value: new THREE.Matrix4() }, fade: { value: 1 }
    };
    this.shell = shell;
    this.march = new THREE.ShaderMaterial({
      uniforms: {
        ...atmosphere.uniforms, ...shell,
        noise: { value: this.noise }, playerXZ: { value: new THREE.Vector2() }, wind: { value: new THREE.Vector2() },
        time: { value: 0 }, coverage: { value: 0.44 }, frame: { value: 0 },
        fogDensity: { value: 0 }, fogColor: { value: new THREE.Color() }
      },
      vertexShader: FULLSCREEN_VERTEX, fragmentShader: MARCH_FRAGMENT, depthTest: false, depthWrite: false
    });
    this.marchScene = fullscreenScene(this.march);
    this.marchCamera = new THREE.Camera();

    this.composite = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)),
      new THREE.ShaderMaterial({
        uniforms: { ...shell, clouds: { value: this.target.texture }, resolution: { value: new THREE.Vector2(1, 1) }, logDepthFC: { value: 1 } },
        vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: COMPOSITE_FRAGMENT,
        transparent: true, depthWrite: false, depthTest: true,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor
      })
    );
    this.composite.frustumCulled = false;
    this.composite.renderOrder = -1;
    scene.add(this.composite);
  }

  setSize(width, height, pixelRatio) {
    const w = Math.max(1, Math.floor(width * pixelRatio)), h = Math.max(1, Math.floor(height * pixelRatio));
    // March at half the drawing-buffer resolution, at most ~1.2 MP.
    const scale = Math.min(0.5, Math.sqrt(1.2e6 / (w * h)));
    this.target.setSize(Math.max(1, Math.floor(w * scale)), Math.max(1, Math.floor(h * scale)));
    this.composite.material.uniforms.resolution.value.set(w, h);
  }

  /**
   * @param earthCenter world position of Earth's centre (visual sphere)
   * @param groundRadius radius of the visual sea level
   */
  update(delta, camera, earthCenter, groundRadius, player, fog, fade) {
    this.time += delta;
    this.frame = (this.frame + 1) % 64;
    const s = this.shell;
    s.fade.value = fade;
    this.composite.visible = fade > 0.001;
    if (!this.composite.visible) return;
    camera.updateMatrixWorld();
    const rel = camera.position.clone().sub(earthCenter);
    const r = rel.length();
    s.camRadius.value = r;
    s.camHeight.value = r - groundRadius;
    s.groundRadius.value = groundRadius;
    s.camUp.value.copy(rel).normalize();
    s.invProjection.value.copy(camera.projectionMatrixInverse);
    s.cameraWorld.value.copy(camera.matrixWorld);
    const u = this.march.uniforms;
    u.playerXZ.value.set(player.worldX + camera.position.x, player.worldZ + camera.position.z);
    u.wind.value.set(-this.time * 9, -this.time * 4);
    u.time.value = this.time;
    u.frame.value = this.frame;
    u.fogDensity.value = fog.density;
    u.fogColor.value.copy(fog.color);
    this.composite.material.uniforms.logDepthFC.value = 2.0 / (Math.log(camera.far + 1.0) / Math.LN2);

    const target = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.marchScene, this.marchCamera);
    this.renderer.setRenderTarget(target);
  }
}
