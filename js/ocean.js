/**
 * ocean.js - Local sea surface around the point beneath the player.
 *
 * The globe texture is far too coarse to stand on. This curved cap follows the
 * player's sub-point, shades a spectrum of wind waves per pixel, reflects the
 * scattered sky, glitters in the sun and hazes into the horizon. Land is masked
 * out with the same specular map the globe uses, and the cap fades out with
 * altitude where the globe texture takes over.
 */
import * as THREE from 'three';
import { ATMOSPHERE_PARS } from './atmosphere.js';

export const SEA_LEVEL_OFFSET = -1.5; // sea sits 1.5 m below the deck at the anchor
const CAP_RADIUS = 240000;

function capGeometry() {
  const rings = 150, segments = 160;
  const positions = [0, 0, 0];
  const index = [];
  // Radial spacing grows geometrically: centimetres near the feet, kilometres far out.
  const r0 = 2, growth = Math.pow(CAP_RADIUS / r0, 1 / (rings - 1));
  for (let i = 0; i < rings; i++) {
    const r = r0 * Math.pow(growth, i);
    for (let j = 0; j < segments; j++) {
      const a = j / segments * Math.PI * 2;
      positions.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let j = 0; j < segments; j++) index.push(0, 1 + (j + 1) % segments, 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = 1 + i * segments + j, b = 1 + i * segments + (j + 1) % segments;
      const c = a + segments, d = b + segments;
      index.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

/** @param groundRadius radius of the deck's sea-level reference (the globe itself is drawn a little lower) */
export function createOcean(atmosphere, landMask, earthMesh, groundRadius) {
  const radius = groundRadius + SEA_LEVEL_OFFSET;
  const uniforms = {
    ...atmosphere.uniforms,
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    time: { value: 0 },
    waveOrigin: { value: new THREE.Vector2() },
    capOrigin: { value: new THREE.Vector3() },
    earthInverse: { value: new THREE.Matrix3() },
    earthCenterWorld: { value: new THREE.Vector3() },
    capX: { value: new THREE.Vector3(1, 0, 0) },
    capZ: { value: new THREE.Vector3(0, 0, 1) },
    landMask: { value: landMask },
    fade: { value: 1 },
    seaRadius: { value: radius }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      uniform float seaRadius;
      uniform vec3 capOrigin;
      uniform mat3 earthInverse;
      varying vec3 vWorld;
      varying vec2 vPlane;
      varying float vRadius;
      varying vec3 vEarthDir;
      void main() {
        float r2 = dot(position.xz, position.xz);
        // Exact sphere drop, written to avoid cancellation near the centre.
        float drop = r2 / (sqrt(max(seaRadius * seaRadius - r2, 0.0)) + seaRadius);
        vec3 p = vec3(position.x, -drop, position.z);
        vPlane = position.xz;
        vRadius = sqrt(r2);
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        vEarthDir = earthInverse * (capOrigin + mat3(modelMatrix) * p);
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      #include <logdepthbuf_pars_fragment>
      ${ATMOSPHERE_PARS}
      uniform float time;
      uniform vec2 waveOrigin;
      uniform sampler2D landMask;
      uniform float fade;
      uniform vec3 earthCenterWorld;
      uniform vec3 capX;
      uniform vec3 capZ;
      varying vec3 vWorld;
      varying vec2 vPlane;
      varying float vRadius;
      varying vec3 vEarthDir;

      // Sum of directional waves with a rough deep-water spectrum. Each wave's
      // contribution fades once it is smaller than a pixel, so the far sea
      // turns into a smooth, correctly rough mirror instead of aliasing.
      vec3 waveNormal(vec2 p, float footprint, out float variance) {
        vec2 grad = vec2(0.0);
        variance = 0.0;
        float wavelength = 60.0;
        float angle = 0.35;
        for (int i = 0; i < 14; i++) {
          vec2 dir = vec2(cos(angle), sin(angle));
          float k = 6.2831853 / wavelength;
          float omega = sqrt(9.81 * k);
          float amp = wavelength * 0.0065;
          float slope = amp * k;
          float keep = smoothstep(2.5, 0.8, footprint / wavelength);
          float phase = dot(dir, p) * k - omega * time + float(i) * 1.7;
          grad += dir * slope * cos(phase) * keep;
          variance += slope * slope * 0.5 * (1.0 - keep);
          wavelength *= 0.72;
          angle += 2.39996;
        }
        return normalize(vec3(-grad.x, 1.0, -grad.y));
      }

      float fresnel(float c) { return 0.02 + 0.98 * pow(1.0 - c, 5.0); }

      void main() {
        #include <logdepthbuf_fragment>
        vec3 ed = normalize(vEarthDir);
        float phi = atan(ed.z, -ed.x);
        vec2 earthUv = vec2(phi / (2.0 * PI) + (phi < 0.0 ? 1.0 : 0.0), 1.0 - acos(clamp(ed.y, -1.0, 1.0)) / PI);
        float water = smoothstep(0.35, 0.6, texture2D(landMask, earthUv).r);
        float edge = 1.0 - smoothstep(0.55, 1.0, vRadius / ${CAP_RADIUS.toFixed(1)});
        float alpha = water * edge * fade;
        if (alpha < 0.002) discard;

        vec3 toCamera = cameraPosition - vWorld;
        float dist = length(toCamera);
        vec3 V = toCamera / dist;
        vec3 up = normalize(vWorld - earthCenterWorld);
        float footprint = dist * 0.0025 / max(abs(dot(V, up)), 0.08);
        float variance;
        vec3 n = waveNormal(vPlane + waveOrigin, footprint, variance);
        // Planar wave coordinates stay world-fixed via waveOrigin.
        vec3 N = normalize(capX * n.x + up * n.y + capZ * n.z);
        float NdotV = max(dot(N, V), 0.001);
        vec3 R = reflect(-V, N);
        // Keep reflections above the horizon (no self-reflection of the sea).
        R = normalize(R + skyUp * max(0.0, 0.01 - dot(R, skyUp)));

        vec3 sky = skyRadiance(R);
        float F = fresnel(NdotV);

        // Sun glitter: GGX with roughness from sub-pixel wave slopes.
        vec3 L = skySunDir;
        vec3 H = normalize(L + V);
        float rough = clamp(0.045 + sqrt(variance) * 1.4, 0.045, 0.6);
        float a2 = rough * rough * rough * rough;
        float NdotH = max(dot(N, H), 0.0);
        float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
        float D = a2 / (PI * d * d);
        float NdotL = max(dot(N, L), 0.0);
        float G = 1.0 / (4.0 * max(NdotV, 0.05) * max(NdotL, 0.05) + 1e-4);
        vec3 spec = sunRadiance * D * G * NdotL * fresnel(max(dot(H, V), 0.0)) * 0.12;

        // Water body: light scattered back up from below the surface.
        vec3 irradiance = sunRadiance * max(dot(L, up), 0.0) + skyRadiance(skyUp) * PI;
        vec3 deep = vec3(0.0015, 0.012, 0.022) * irradiance;
        float crest = clamp(1.0 - n.y, 0.0, 1.0) * 6.0;
        vec3 body = deep + vec3(0.0, 0.018, 0.02) * irradiance * crest * max(dot(L, up), 0.0);

        vec3 color = body * (1.0 - F) + sky * F + spec;
        // Aerial perspective: air between camera and water.
        vec3 viewDir = -V;
        vec3 Tair = airTransmittance(dist, viewDir);
        color = color * Tair + skyRadiance(viewDir) * (1.0 - Tair);
        gl_FragColor = vec4(color, alpha);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: true,
    fog: true
  });
  const mesh = new THREE.Mesh(capGeometry(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;

  const earthCenter = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const ex = new THREE.Vector3(), ez = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const earthRotation = new THREE.Matrix4();
  return {
    mesh,
    update(delta, player, earthGroupPosition, altitude, visible) {
      uniforms.time.value += delta;
      const fade = 1 - THREE.MathUtils.smoothstep(altitude, 25000, 60000);
      uniforms.fade.value = fade;
      mesh.visible = visible && fade > 0.001;
      if (!mesh.visible) return;
      earthCenter.copy(earthGroupPosition);
      // Sub-point below the player (player sits at the scene origin).
      normal.copy(earthCenter).negate().normalize();
      mesh.position.copy(earthCenter).addScaledVector(normal, radius);
      ez.set(0, 0, 1).addScaledVector(normal, -normal.z).normalize();
      ex.crossVectors(normal, ez);
      basis.makeBasis(ex, normal, ez);
      mesh.quaternion.setFromRotationMatrix(basis);
      uniforms.waveOrigin.value.set(player.worldX, player.worldZ);
      uniforms.capOrigin.value.copy(normal).multiplyScalar(radius);
      uniforms.earthCenterWorld.value.copy(earthCenter);
      uniforms.capX.value.copy(ex);
      uniforms.capZ.value.copy(ez);
      earthRotation.makeRotationFromEuler(earthMesh.rotation);
      uniforms.earthInverse.value.setFromMatrix4(earthRotation).transpose();
    }
  };
}
