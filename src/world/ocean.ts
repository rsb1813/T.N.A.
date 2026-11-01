// Ocean: one large plane that follows the camera. Animated wave normals, fresnel sky reflection, sun glint,
// lighter shallow water + shore foam driven by a depth texture baked from the terrain heightfield.
import * as THREE from 'three';
import type { BiomeDef } from './biomes';
import { GLSL_FRAG_PARS, GLSL_NOISE, GLSL_VERT_END, GLSL_VERT_PARS } from './glsl';
import type { SkyState } from './sky';
import type { Terrain } from './terrain/terrain';

const VERT = /* glsl */ `
${GLSL_VERT_PARS}
varying vec3 vWPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  ${GLSL_VERT_END}
}
`;

const FRAG = /* glsl */ `
${GLSL_FRAG_PARS}
${GLSL_NOISE}
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform float uGlowStrength;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform vec3 uAmbient;
uniform float uGlint;
uniform float uRough;
uniform sampler2D uDepth;
uniform float uExtent;
varying vec3 vWPos;

vec2 wave(vec2 p, vec2 d, float len, float amp, float t, float fade) {
  float k = 6.2831853 / len;
  float w = sqrt(9.81 * k);
  float ph = dot(d, p) * k - w * t;
  return d * (amp * k * cos(ph)) * fade;
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 wp = vWPos;
  vec3 toCam = cameraPosition - wp;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float t = uTime;
  vec2 g = vec2(0.0);
  g += wave(wp.xz, normalize(vec2(0.8, 0.6)), 140.0, 1.4, t, 1.0 - smoothstep(4000.0, 16000.0, dist));
  g += wave(wp.xz, normalize(vec2(-0.3, 0.95)), 61.0, 0.55, t, 1.0 - smoothstep(2000.0, 8000.0, dist));
  g += wave(wp.xz, normalize(vec2(0.95, -0.2)), 29.0, 0.22, t, 1.0 - smoothstep(900.0, 3500.0, dist));
  g += wave(wp.xz, normalize(vec2(0.2, 0.98)), 13.0, 0.08, t, 1.0 - smoothstep(400.0, 1600.0, dist));
  g += wave(wp.xz, normalize(vec2(-0.7, -0.7)), 6.1, 0.032, t, 1.0 - smoothstep(200.0, 800.0, dist));
  float nn = tnaNoise(wp.xz * 0.004 + t * 0.02) - 0.5;
  g *= uRough * (1.0 + nn * 0.6);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

  float NdV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.42));
  float cs = max(dot(R, uLightDir), 0.0);
  sky += uGlow * pow(cs, 6.0) * uGlowStrength * 0.6;

  vec2 uv = (wp.xz + uExtent) / (2.0 * uExtent);
  vec2 dw = texture2D(uDepth, clamp(uv, 0.0, 1.0)).rg;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) dw = vec2(1.0);
  float depth = dw.r;
  float open = smoothstep(0.18, 0.5, dw.g);
  vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 0.75, depth));
  // rivers and lakes: darker, no turquoise shallows
  water = mix(mix(uDeep, uShallow, 0.3) * 0.8, water, open);
  water *= 0.92 + 0.16 * tnaNoise(wp.xz * 0.0007);
  float sunUp = max(uLightDir.y, 0.0);
  vec3 body = water * (uAmbient + uLightColor * uLightIntensity * sunUp * 0.22);
  vec3 col = mix(body, sky, fres * 0.9);

  float glint = pow(cs, 700.0) * 26.0 + pow(cs, 90.0) * 0.5;
  col += uLightColor * uLightIntensity * glint * uGlint;

  float shore = 1.0 - smoothstep(0.0, 0.045, depth);
  float fn = tnaNoise(wp.xz * 0.08 + vec2(t * 0.15, -t * 0.11)) * tnaNoise(wp.xz * 0.023 - t * 0.05);
  float foam = shore * open * smoothstep(0.12, 0.45, fn + shore * 0.35);
  col = mix(col, (uAmbient + uLightColor * uLightIntensity * sunUp * 0.3) * 0.95, foam * 0.85);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class Ocean {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly depthTex: THREE.DataTexture;
  private time = 0;

  constructor(terrain: Terrain, biome: BiomeDef, roughness: number) {
    this.depthTex = Ocean.bakeDepth(terrain);
    this.material = new THREE.ShaderMaterial({
      name: 'tna_ocean',
      vertexShader: VERT,
      fragmentShader: FRAG,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uDeep: { value: new THREE.Color().setHex(biome.water.deep) },
          uShallow: { value: new THREE.Color().setHex(biome.water.shallow) },
          uZenith: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uGlow: { value: new THREE.Color() },
          uGlowStrength: { value: 0 },
          uLightDir: { value: new THREE.Vector3(0, 1, 0) },
          uLightColor: { value: new THREE.Color() },
          uLightIntensity: { value: 1 },
          uAmbient: { value: new THREE.Color() },
          uGlint: { value: 1 },
          uRough: { value: roughness },
          uDepth: { value: null },
          uExtent: { value: terrain.extent },
        },
      ]),
    });
    this.material.uniforms.uDepth.value = this.depthTex;
    const R = 220_000;
    const geom = new THREE.PlaneGeometry(2 * R, 2 * R, 16, 16).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.name = 'tna_ocean';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  /**
   * RG depth texture over the heightfield: R = local depth (0 = land/shoreline, 1 = >= 60 m),
   * G = fraction of open water within ~1.5 km (separates coasts from narrow rivers and lakes).
   */
  private static bakeDepth(terrain: Terrain): THREE.DataTexture {
    const S = 1024;
    const N = terrain.gridSize;
    const H = terrain.heights;
    const depth = new Float32Array(S * S);
    const wet = new Float32Array(S * S);
    for (let j = 0; j < S; j++) {
      const gj = Math.round((j / (S - 1)) * (N - 1)) * N;
      for (let i = 0; i < S; i++) {
        const h = H[gj + Math.round((i / (S - 1)) * (N - 1))];
        depth[j * S + i] = h < 0 ? Math.sqrt(Math.min(1, -h / 60)) : 0;
        wet[j * S + i] = h < 0 ? 1 : 0;
      }
    }
    // separable box blur of the water mask (radius r texels)
    const r = 6;
    const tmp = new Float32Array(S * S);
    for (let j = 0; j < S; j++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += wet[j * S + Math.min(S - 1, Math.max(0, i))];
      for (let i = 0; i < S; i++) {
        tmp[j * S + i] = acc / (2 * r + 1);
        acc += wet[j * S + Math.min(S - 1, i + r + 1)] - wet[j * S + Math.max(0, i - r)];
      }
    }
    const data = new Uint8Array(S * S * 2);
    for (let i = 0; i < S; i++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += tmp[Math.min(S - 1, Math.max(0, j)) * S + i];
      for (let j = 0; j < S; j++) {
        const k = j * S + i;
        data[k * 2] = Math.round(depth[k] * 255);
        data[k * 2 + 1] = Math.round((acc / (2 * r + 1)) * 255);
        acc += tmp[Math.min(S - 1, j + r + 1) * S + i] - tmp[Math.max(0, j - r) * S + i];
      }
    }
    const tex = new THREE.DataTexture(data, S, S, THREE.RGFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.flipY = false;
    tex.needsUpdate = true;
    return tex;
  }

  setSky(s: SkyState): void {
    const u = this.material.uniforms;
    u.uZenith.value.copy(s.zenith);
    u.uHorizon.value.copy(s.horizon);
    u.uGlow.value.copy(s.glow);
    u.uGlowStrength.value = s.glowStrength;
    u.uLightDir.value.copy(s.lightDir);
    u.uLightColor.value.copy(s.lightColor);
    u.uLightIntensity.value = s.lightIntensity;
    u.uAmbient.value.copy(s.hemiSky).multiplyScalar(s.hemiIntensity * 0.32);
    u.uGlint.value = s.night > 0.5 ? 0.35 : s.sunDisc > 0 ? 1 : 0.12;
  }

  update(dt: number, camera: THREE.Vector3): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    this.mesh.position.set(Math.round(camera.x / 1000) * 1000, 0, Math.round(camera.z / 1000) * 1000);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.depthTex.dispose();
  }
}
