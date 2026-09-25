/**
 * postfx.js - HDR render target, physically based bloom and filmic output.
 *
 * The scene renders into a multisampled half-float target so the sun, specular
 * glints and bright cloud edges keep their energy. A mip-chain bloom spreads
 * that energy like lens glare, then ACES tone mapping, a gentle vignette and
 * film grain produce the final sRGB image.
 */
import * as THREE from 'three';
import { fullscreenScene, FULLSCREEN_VERTEX } from './atmosphere.js';

const LEVELS = 6;

const DOWNSAMPLE = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D source;
  uniform vec2 texel;
  uniform float threshold;
  uniform bool prefilter;
  vec3 s(vec2 o) { return texture2D(source, vUv + o * texel).rgb; }
  void main() {
    // 13-tap filter (Jimenez 2014) avoids fireflies and pulsing when moving.
    vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
    vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
    vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
    vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
    vec3 color = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    if (prefilter) {
      float lum = max(max(color.r, color.g), color.b);
      float knee = threshold * 0.5;
      float soft = clamp(lum - threshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee + 1e-4);
      float w = max(soft, lum - threshold) / max(lum, 1e-4);
      color = min(color * w, vec3(64.0));
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;

const UPSAMPLE = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D source;
  uniform vec2 texel;
  uniform float radius;
  vec3 s(vec2 o) { return texture2D(source, vUv + o * texel * radius).rgb; }
  void main() {
    vec3 c = s(vec2(0)) * 4.0 + (s(vec2(-1, 0)) + s(vec2(1, 0)) + s(vec2(0, -1)) + s(vec2(0, 1))) * 2.0
      + s(vec2(-1, -1)) + s(vec2(1, -1)) + s(vec2(-1, 1)) + s(vec2(1, 1));
    gl_FragColor = vec4(c / 16.0, 1.0);
  }
`;

const COMPOSITE = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D scene;
  uniform sampler2D bloom;
  uniform float bloomStrength;
  uniform float exposure;
  uniform float time;
  uniform float vignette;
  uniform vec2 resolution;
  vec3 RRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 aces(vec3 color) {
    const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    color = inM * color;
    color = RRTAndODTFit(color);
    return clamp(outM * color, 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
  void main() {
    vec3 color = texture2D(scene, vUv).rgb;
    color += texture2D(bloom, vUv).rgb * bloomStrength;
    vec2 q = vUv - 0.5;
    q.x *= resolution.x / resolution.y;
    color *= mix(1.0, smoothstep(1.25, 0.25, length(q)), vignette);
    color = aces(color * exposure / 0.6);
    color = toSRGB(color);
    // Film grain plus dither removes banding in the sky gradient.
    float n = hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 17.0) - 1.0;
    color += n * (1.0 / 255.0 + 0.012 * (1.0 - color));
    gl_FragColor = vec4(color, 1.0);
  }
`;

export class PostProcessing {
  constructor(renderer) {
    this.renderer = renderer;
    this.camera = new THREE.Camera();
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.mips = [];
    for (let i = 0; i < LEVELS; i++) {
      this.mips.push(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
    }
    this.down = new THREE.ShaderMaterial({
      uniforms: { source: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 3 }, prefilter: { value: true } },
      vertexShader: FULLSCREEN_VERTEX, fragmentShader: DOWNSAMPLE, depthTest: false, depthWrite: false
    });
    this.up = new THREE.ShaderMaterial({
      uniforms: { source: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 1 } },
      vertexShader: FULLSCREEN_VERTEX, fragmentShader: UPSAMPLE, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, transparent: true
    });
    this.composite = new THREE.ShaderMaterial({
      uniforms: {
        scene: { value: this.target.texture }, bloom: { value: null }, bloomStrength: { value: 0.06 },
        exposure: { value: 0.95 }, time: { value: 0 }, vignette: { value: 0.35 }, resolution: { value: new THREE.Vector2(1, 1) }
      },
      vertexShader: FULLSCREEN_VERTEX, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false
    });
    this.downScene = fullscreenScene(this.down);
    this.upScene = fullscreenScene(this.up);
    this.compositeScene = fullscreenScene(this.composite);
  }

  setSize(width, height, pixelRatio) {
    const w = Math.max(1, Math.floor(width * pixelRatio)), h = Math.max(1, Math.floor(height * pixelRatio));
    this.target.setSize(w, h);
    let mw = w, mh = h;
    for (const mip of this.mips) {
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
      mip.setSize(mw, mh);
    }
    this.composite.uniforms.resolution.value.set(w, h);
  }

  render(scene, camera, delta) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(scene, camera);

    // Downsample chain: first pass extracts only highlights.
    let source = this.target.texture;
    let size = new THREE.Vector2(this.target.width, this.target.height);
    this.mips.forEach((mip, i) => {
      this.down.uniforms.source.value = source;
      this.down.uniforms.texel.value.set(1 / size.x, 1 / size.y);
      this.down.uniforms.prefilter.value = i === 0;
      r.setRenderTarget(mip);
      r.render(this.downScene, this.camera);
      source = mip.texture;
      size.set(mip.width, mip.height);
    });
    // Upsample and accumulate back up the chain.
    const autoClear = r.autoClear;
    r.autoClear = false;
    for (let i = LEVELS - 1; i > 0; i--) {
      const from = this.mips[i], to = this.mips[i - 1];
      this.up.uniforms.source.value = from.texture;
      this.up.uniforms.texel.value.set(1 / from.width, 1 / from.height);
      r.setRenderTarget(to);
      r.render(this.upScene, this.camera);
    }
    r.autoClear = autoClear;

    this.composite.uniforms.bloom.value = this.mips[0].texture;
    this.composite.uniforms.time.value = (this.composite.uniforms.time.value + delta) % 100;
    r.setRenderTarget(null);
    r.render(this.compositeScene, this.camera);
  }
}
