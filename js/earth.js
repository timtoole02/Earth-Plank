/**
 * earth.js - Realistic Earth rendering with high-res textures, atmosphere glow, and dynamic skybox
 */
import * as THREE from 'three';
import { EARTH_RADIUS } from './physics.js';
import { ATMOSPHERE_PARS } from './atmosphere.js';

// The globe is drawn a few metres low so the local ocean surface can sit on
// top of it without depth fighting. Invisible at any scale but the deck's.
export const EARTH_VISUAL_DROP = 5;

/**
 * Creates the Atmosphere Rayleigh Glow Shell with custom Fresnel shader.
 */
export function createAtmosphereMesh(radius) {
  const geometry = new THREE.SphereGeometry(radius * 1.012, 128, 128);
  const material = new THREE.ShaderMaterial({
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec3 vWorldNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec3 vWorldNormal;
      uniform vec3 color;
      uniform vec3 sunDirection;
      uniform float visibility;
      void main() {
        vec3 viewDir = normalize(-vPosition);
        float facing = clamp(abs(dot(normalize(vNormal), viewDir)), 0.0, 1.0);
        float intensity = 2.5 * pow(facing, 0.5) * pow(1.0 - facing, 3.0);
        intensity = clamp(intensity, 0.0, 1.0);
        // Scattered light only exists where the air is sunlit. Near the
        // terminator the long path through the air reddens it.
        float sun = dot(normalize(vWorldNormal), sunDirection);
        float lit = smoothstep(-0.25, 0.35, sun);
        vec3 sunset = vec3(1.0, 0.45, 0.18);
        vec3 tint = mix(sunset, color, smoothstep(-0.12, 0.1, sun));
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(tint * 1.6 * lit, intensity * visibility * lit);
      }
    `,
    uniforms: {
      color: { value: new THREE.Color(0x4f9bff) }, visibility: { value: 1 },
      sunDirection: { value: new THREE.Vector3(0, 1, 0) }
    },
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false
  });

  return new THREE.Mesh(geometry, material);
}

/**
 * Creates Earth system (Globe, Clouds, Atmosphere, and Starfield).
 */
export function createEarthSystem(atmosphere, sunDirection) {
  const group = new THREE.Group();
  const textureLoader = new THREE.TextureLoader();

  const surface = textureLoader.load('assets/earth_atmos_2048.jpg');
  surface.colorSpace = THREE.SRGBColorSpace;
  surface.anisotropy = 8;
  // The source map is bright over water: invert it for physical roughness.
  const roughness = textureLoader.load('assets/earth_specular_2048.jpg', (texture) => {
    const canvas = document.createElement('canvas');
    canvas.width = texture.image.width; canvas.height = texture.image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(texture.image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const value = 245 - pixels.data[i] * 0.7;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
    }
    ctx.putImageData(pixels, 0, 0);
    texture.image = canvas; texture.needsUpdate = true;
  });
  // 1. Solid Earth Sphere using High-Res Textures
  const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS, 128, 128);
  const earthMat = new THREE.MeshStandardMaterial({
    map: surface,
    normalMap: textureLoader.load('assets/earth_normal_2048.jpg'),
    roughnessMap: roughness,
    normalScale: new THREE.Vector2(0.35, 0.35),
    metalness: 0.0, // Oceans will reflect specular map
    roughness: 1.0,
    envMapIntensity: 0 // the sky probe is taken at deck level, not in orbit
  });

  // The globe's huge triangles interpolate log-depth across the tangent deck.
  // Compute depth on the mathematical sphere instead. The rationalized near
  // root avoids subtracting two ~6,371 km values to recover a few centimeters.
  const sphereDepth = {
    earthRadius: { value: EARTH_RADIUS },
    earthCameraRadius: { value: EARTH_RADIUS },
    earthCameraHeight: { value: 1.8 },
    earthCameraUp: { value: new THREE.Vector3(0, 1, 0) }
  };
  earthMat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, sphereDepth, atmosphere.uniforms);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      ${ATMOSPHERE_PARS}
      uniform float earthRadius;
      uniform float earthCameraRadius;
      uniform float earthCameraHeight;
      uniform vec3 earthCameraUp;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <logdepthbuf_fragment>', `
      #include <logdepthbuf_fragment>
      #if defined(USE_LOGDEPTHBUF) && defined(USE_LOGDEPTHBUF_EXT)
        vec3 earthRay = -normalize(vViewPosition);
        float sphereB = earthCameraRadius * dot(earthRay, earthCameraUp);
        float sphereC = earthCameraHeight * (2.0 * earthRadius + earthCameraHeight);
        float sphereRoot = sqrt(max(0.0, sphereB * sphereB - sphereC));
        float sphereHit = sphereC / max(0.000001, -sphereB + sphereRoot);
        float sphereViewDepth = max(0.0, -earthRay.z * sphereHit);
        gl_FragDepthEXT = log2(1.0 + sphereViewDepth) * logDepthBufFC * 0.5;
      #endif
    `);
    // The night side should be dark: no sky fill from deck-level lights.
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
      #include <lights_fragment_end>
      reflectedLight.indirectDiffuse *= 0.06;
    `);
    // Aerial perspective inside the atmosphere, limb haze from space.
    shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', `
      {
        vec3 rayView = -normalize(vViewPosition);
        float b = earthCameraRadius * dot(rayView, earthCameraUp);
        float c = earthCameraHeight * (2.0 * earthRadius + earthCameraHeight);
        float root = sqrt(max(0.0, b * b - c));
        float hitDist = c / max(0.000001, -b + root);
        vec3 rayWorld = normalize((vec4(rayView, 0.0) * viewMatrix).xyz);
        vec3 Tair = airTransmittance(hitDist, rayWorld);
        vec3 hazed = gl_FragColor.rgb * Tair + skyRadiance(rayWorld);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, hazed, skyAir);
        vec3 nView = normalize(vNormal);
        vec3 nWorld = normalize((vec4(nView, 0.0) * viewMatrix).xyz);
        float rim = pow(1.0 - clamp(dot(nView, -rayView), 0.0, 1.0), 2.5);
        float lit = smoothstep(-0.15, 0.4, dot(nWorld, skySunDir));
        gl_FragColor.rgb += vec3(0.16, 0.34, 0.8) * (0.04 + rim * 0.9) * lit * (1.0 - skyAir);
      }
      #include <tonemapping_fragment>
    `);
  };
  const earthMesh = new THREE.Mesh(earthGeo, earthMat);
  const earthCenter = new THREE.Vector3();
  const cameraRelative = new THREE.Vector3();
  earthMesh.onBeforeRender = (renderer, scene, camera) => {
    earthMesh.getWorldPosition(earthCenter);
    camera.getWorldPosition(cameraRelative).sub(earthCenter);
    const radius = cameraRelative.length();
    sphereDepth.earthCameraRadius.value = radius;
    sphereDepth.earthCameraHeight.value = Math.max(0, radius - EARTH_RADIUS);
    sphereDepth.earthCameraUp.value.copy(cameraRelative).normalize().transformDirection(camera.matrixWorldInverse);
  };
  earthMesh.castShadow = false; // Planetary triangles do not belong in the local deck shadow map.
  earthMesh.receiveShadow = true;

  // Rotate Earth to place equator at the top edge (Y axis alignment)
  // Three.js spheres have poles at Y. Equator is in XZ plane.
  // Our plank is along X axis, tangent at (0, 0, 0), Earth center at (0, -R_E, 0).
  // So the equator is naturally tangent to the X axis!
  // Let's rotate Earth so a nice continent (e.g. Africa/Americas) is visible at the anchor point.
  earthMesh.rotation.z = Math.PI / 2;
  earthMesh.rotation.y = -Math.PI / 2;
  group.add(earthMesh);

  // 2. Cloud Sphere
  const cloudGeo = new THREE.SphereGeometry(EARTH_RADIUS + 6000, 128, 128);
  const cloudMat = new THREE.MeshStandardMaterial({
    map: textureLoader.load('assets/earth_clouds_1024.png', t => { t.colorSpace = THREE.SRGBColorSpace; }),
    transparent: true,
    opacity: 0.8,
    blending: THREE.NormalBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  // Breaks the 1024 px cloud map into cumulus-sized cells when seen from low orbit.
  const cloudDetail = { detailNoise: { value: null }, detailStrength: { value: 0 } };
  cloudMat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, cloudDetail);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler3D;
        uniform sampler3D detailNoise;
        uniform float detailStrength;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
        {
          vec2 duv = vMapUv * vec2(70.0, 35.0);
          float n = texture(detailNoise, vec3(duv, 0.37)).r * 0.65 + texture(detailNoise, vec3(duv * 2.2, 0.71)).a * 0.35;
          float a = diffuseColor.a;
          float detailed = smoothstep(0.2, 0.8, a * (0.55 + 0.75 * n));
          diffuseColor.a = mix(a, detailed, detailStrength);
          diffuseColor.rgb *= mix(1.0, 0.82 + 0.25 * n, detailStrength);
        }
        #endif`);
  };
  cloudMat.customProgramCacheKey = () => 'cloud-detail';
  const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
  cloudMesh.rotation.copy(earthMesh.rotation);
  group.add(cloudMesh);

  // 3. Atmosphere Rayleigh Glow
  const atmosphereMesh = createAtmosphereMesh(EARTH_RADIUS);
  atmosphereMesh.material.uniforms.sunDirection.value.copy(sunDirection);
  group.add(atmosphereMesh);

  // 4. Deep Space Starfield (High quality)
  const starGeo = new THREE.BufferGeometry();
  const starCount = 8000;
  const starPos = new Float32Array(starCount * 3);
  const starColors = new Float32Array(starCount * 3);
  const starSizes = new Float32Array(starCount);

  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const dist = EARTH_RADIUS * 8 + Math.random() * (EARTH_RADIUS * 10);

    starPos[i * 3] = dist * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = dist * Math.sin(phi) * Math.sin(theta);
    starPos[i * 3 + 2] = dist * Math.cos(phi);

    // Realistic stellar colors (blue-white, pure white, yellow-orange, red-dwarf)
    const tint = Math.random();
    if (tint < 0.4) {
      starColors[i * 3] = 0.8; starColors[i * 3 + 1] = 0.9; starColors[i * 3 + 2] = 1.0; // Blueish
    } else if (tint < 0.8) {
      starColors[i * 3] = 1.0; starColors[i * 3 + 1] = 1.0; starColors[i * 3 + 2] = 1.0; // White
    } else if (tint < 0.95) {
      starColors[i * 3] = 1.0; starColors[i * 3 + 1] = 0.9; starColors[i * 3 + 2] = 0.7; // Yellow
    } else {
      starColors[i * 3] = 1.0; starColors[i * 3 + 1] = 0.6; starColors[i * 3 + 2] = 0.4; // Red
    }

    // Size variation for depth
    starSizes[i] = 0.5 + Math.pow(Math.random(), 6) * 3.0;
  }

  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
  starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));

  // Custom shader for circular, twinkling stars
  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 }, visibility: { value: 0 }
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float size;
      attribute vec3 color;
      varying vec3 vColor;
      uniform float time;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        // Stars do not twinkle above the atmosphere.
        gl_PointSize = clamp(size * (80000000.0 / max(1.0, -mvPosition.z)), 0.7, 3.5);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      varying vec3 vColor;
      uniform float visibility;
      void main() {
        // Circular soft star shape
        vec2 xy = gl_PointCoord.xy - vec2(0.5);
        float ll = length(xy);
        if (ll > 0.5) discard;
        // Soft gaussian-like falloff
        float alpha = exp(-ll * ll * 20.0);
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(vColor * 1.6, alpha * visibility);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const starMesh = new THREE.Points(starGeo, starMat);
  group.add(starMesh);

  return {
    group,
    earthMesh,
    cloudMesh,
    atmosphereMesh,
    starMesh,
    starMat,
    setCloudDetail(texture) { cloudDetail.detailNoise.value = texture; },
    update(delta, playerWorldX, playerWorldZ, cameraAltitude = 0) {
      // Detail matters in low orbit; from far away the map alone reads best.
      cloudDetail.detailStrength.value = cloudDetail.detailNoise.value
        ? 1 - THREE.MathUtils.smoothstep(cameraAltitude, 1500000, 6000000) : 0;
      // Position Earth center relative to player
      group.position.set(-playerWorldX, -EARTH_RADIUS - EARTH_VISUAL_DROP, -playerWorldZ);

      // Slow realistic cloud rotation
      cloudMesh.rotation.y += delta * 0.0003;

      // Update star twinkle time
      starMat.uniforms.time.value += delta;
    }
  };
}
