// Sky dome, sun/moon lighting, fog, exposure and image-based environment derived from time of day + weather.
import * as THREE from 'three';
import type { Weather } from '../core/environment';
import { clamp, lerp, smoothstep } from '../core/math';
import type { BiomeDef } from './biomes';

// ------------------------------------------------------------------ pure state

export interface SkyState {
  /** True sun direction (may be below the horizon) */
  sunDir: THREE.Vector3;
  sunElevationDeg: number;
  /** Direction the key light comes from (sun by day, moon by night) */
  lightDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** 0 = day, 1 = full night (sun < ~-5 deg) */
  night: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  /** Warm glow added near the sun (sunrise/sunset) */
  glow: THREE.Color;
  glowStrength: number;
  lightColor: THREE.Color;
  lightIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  exposure: number;
  fogDensity: number;
  stars: number;
  /** Sun disc visibility 0..1 (clouds/weather) */
  sunDisc: number;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  envIntensity: number;
}

interface Key {
  el: number;
  zenith: number;
  horizon: number;
  glow: number;
  glowStrength: number;
  light: number;
  lightI: number;
  hemi: number;
  hemiI: number;
  exposure: number;
  stars: number;
}

// Keyframes by sun elevation (deg). Colours sRGB.
const KEYS: Key[] = [
  { el: -14, zenith: 0x061026, horizon: 0x1a2a4c, glow: 0x000000, glowStrength: 0, light: 0x9fb6ea, lightI: 0.75, hemi: 0x3a5288, hemiI: 1.15, exposure: 1.55, stars: 1 },
  { el: -6, zenith: 0x0c1a3e, horizon: 0x2c3a62, glow: 0x3a2030, glowStrength: 0.25, light: 0x8a9ad0, lightI: 0.6, hemi: 0x3c4c80, hemiI: 1.1, exposure: 1.4, stars: 0.75 },
  { el: -2, zenith: 0x23356a, horizon: 0x6a6280, glow: 0xd8683a, glowStrength: 0.9, light: 0xff9c64, lightI: 0.7, hemi: 0x5c5c80, hemiI: 1.05, exposure: 1.15, stars: 0.12 },
  { el: 2, zenith: 0x34569a, horizon: 0xb3a8b0, glow: 0xf29a58, glowStrength: 1, light: 0xffb47a, lightI: 1.6, hemi: 0x8a94b4, hemiI: 1.15, exposure: 1.05, stars: 0 },
  { el: 8, zenith: 0x3a6cb8, horizon: 0xcdd0d4, glow: 0xf3c487, glowStrength: 0.7, light: 0xffd9a8, lightI: 2.7, hemi: 0xa6bad6, hemiI: 1.05, exposure: 1, stars: 0 },
  { el: 20, zenith: 0x3a7cd0, horizon: 0xc6daee, glow: 0xfff0d8, glowStrength: 0.35, light: 0xfff2e0, lightI: 3.3, hemi: 0xb6cce6, hemiI: 1.1, exposure: 0.95, stars: 0 },
  { el: 50, zenith: 0x3576d2, horizon: 0xbcd6f0, glow: 0xfff8f0, glowStrength: 0.25, light: 0xfffaf2, lightI: 3.5, hemi: 0xbcd2ec, hemiI: 1.1, exposure: 0.92, stars: 0 },
];

const WEATHER: Record<Weather, { grey: number; dark: number; light: number; hemi: number; fog: number; glow: number; disc: number }> = {
  clear: { grey: 0, dark: 1, light: 1, hemi: 1, fog: 1, glow: 1, disc: 1 },
  scattered: { grey: 0.12, dark: 0.98, light: 0.95, hemi: 1.03, fog: 1.15, glow: 0.9, disc: 1 },
  overcast: { grey: 0.82, dark: 0.82, light: 0.32, hemi: 1.25, fog: 2.0, glow: 0.25, disc: 0 },
  storm: { grey: 0.92, dark: 0.5, light: 0.14, hemi: 0.95, fog: 3.1, glow: 0.05, disc: 0 },
};

const BASE_FOG_DENSITY = 1 / 64_000;

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

function lerpHex(a: number, b: number, t: number, out: THREE.Color): THREE.Color {
  _c1.setHex(a);
  _c2.setHex(b);
  return out.copy(_c1).lerp(_c2, t);
}

/** Sun elevation/azimuth model: rises ~5.8 h in the east, sets ~19.2 h in the west, ~62 deg at 12.5 h */
export function sunAngles(timeOfDay: number): { elevationDeg: number; azimuthDeg: number } {
  const t = ((timeOfDay % 24) + 24) % 24;
  const day = (t - 5.8) / 13.4;
  const elevationDeg = 62 * Math.sin(Math.PI * day);
  // azimuth sweeps east -> south -> west by day, continues through north at night
  const azimuthDeg = 90 + 180 * day;
  return { elevationDeg, azimuthDeg };
}

export function directionFromAngles(azimuthDeg: number, elevationDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

function greyOf(c: THREE.Color, amount: number, darken: number): void {
  const l = c.r * 0.3 + c.g * 0.55 + c.b * 0.15;
  c.r = lerp(c.r, l, amount) * darken;
  c.g = lerp(c.g, l, amount) * darken;
  c.b = lerp(c.b, l * 1.04, amount) * darken;
}

export function computeSkyState(timeOfDay: number, weather: Weather, biome: BiomeDef): SkyState {
  const { elevationDeg, azimuthDeg } = sunAngles(timeOfDay);
  const sunDir = directionFromAngles(azimuthDeg, elevationDeg);
  // moon: high in the opposite sky
  const moonDir = directionFromAngles(azimuthDeg + 180, 38 + 10 * Math.sin(timeOfDay));
  const el = clamp(elevationDeg, KEYS[0].el, KEYS[KEYS.length - 1].el);
  let k = 0;
  while (k < KEYS.length - 2 && el > KEYS[k + 1].el) k++;
  const a = KEYS[k];
  const b = KEYS[k + 1];
  const t = smoothstep(a.el, b.el, el);
  const w = WEATHER[weather] ?? WEATHER.clear;

  const zenith = lerpHex(a.zenith, b.zenith, t, new THREE.Color());
  const horizon = lerpHex(a.horizon, b.horizon, t, new THREE.Color());
  const glow = lerpHex(a.glow, b.glow, t, new THREE.Color());
  const lightColor = lerpHex(a.light, b.light, t, new THREE.Color());
  const hemiSky = lerpHex(a.hemi, b.hemi, t, new THREE.Color());
  const night = 1 - smoothstep(-5, -1, elevationDeg);

  // biome haze tints the horizon (keeps brightness)
  const day = 1 - night;
  if (biome.haze.amount > 0) {
    _c1.setHex(biome.haze.color);
    const lh = horizon.r * 0.3 + horizon.g * 0.55 + horizon.b * 0.15;
    const lz = _c1.r * 0.3 + _c1.g * 0.55 + _c1.b * 0.15;
    _c1.multiplyScalar(lh / Math.max(1e-4, lz));
    horizon.lerp(_c1, biome.haze.amount * day);
  }
  greyOf(zenith, w.grey, w.dark);
  greyOf(horizon, w.grey * 0.9, lerp(1, w.dark, 0.8));
  greyOf(hemiSky, w.grey * 0.7, lerp(1, w.dark, 0.6));

  const hemiGround = new THREE.Color().setHex(biome.bounce);
  hemiGround.multiplyScalar(lerp(1, 0.25, night));

  // key light: sun by day, moon by night (blend through twilight)
  const sunW = smoothstep(-4, 1, elevationDeg);
  const lightDir = new THREE.Vector3()
    .copy(moonDir)
    .multiplyScalar(1 - sunW)
    .addScaledVector(directionFromAngles(azimuthDeg, Math.max(elevationDeg, 2)), sunW)
    .normalize();
  const lightIntensity = lerp(a.lightI, b.lightI, t) * w.light;
  const hemiIntensity = lerp(a.hemiI, b.hemiI, t) * w.hemi;

  const cloudLit = new THREE.Color().copy(lightColor).multiplyScalar(lerp(0.55, 1.15, day)).lerp(hemiSky, 0.25);
  const cloudShade = new THREE.Color().copy(hemiSky).multiplyScalar(lerp(0.32, 0.6, day));
  if (weather === 'overcast' || weather === 'storm') {
    const g = weather === 'storm' ? 0.42 : 0.72;
    cloudLit.setRGB(g, g * 1.01, g * 1.04).multiplyScalar(lerp(0.15, 1, day));
    cloudShade.setRGB(g * 0.55, g * 0.57, g * 0.62).multiplyScalar(lerp(0.15, 1, day));
  }

  let fogDensity = BASE_FOG_DENSITY * w.fog * (1 + biome.haze.amount * 0.5);
  if (night > 0) fogDensity *= lerp(1, 1.15, night);

  return {
    sunDir,
    sunElevationDeg: elevationDeg,
    lightDir,
    moonDir,
    night,
    zenith,
    horizon,
    glow,
    glowStrength: lerp(a.glowStrength, b.glowStrength, t) * w.glow,
    lightColor,
    lightIntensity,
    hemiSky,
    hemiGround,
    hemiIntensity,
    exposure: lerp(a.exposure, b.exposure, t) * (weather === 'storm' ? 1.12 : weather === 'overcast' ? 1.05 : 1),
    fogDensity,
    stars: lerp(a.stars, b.stars, t) * (1 - w.grey * 0.9),
    sunDisc: w.disc * smoothstep(-2, 1, elevationDeg),
    cloudLit,
    cloudShade,
    envIntensity: lerp(0.75, 0.3, night) * lerp(1, 0.75, w.grey),
  };
}

// ------------------------------------------------------------------ dome

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position * 1000.0, 1.0);
  gl_Position = vec4(p.xy, 0.0, p.w);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uGlow;
uniform float uGlowStrength;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunDisc;
uniform vec3 uMoonDir;
uniform float uStars;
uniform float uFlash;
uniform float uTime;
uniform float uEnvMode;
varying vec3 vDir;

float h13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 d = normalize(vDir);
  float el = d.y;
  float up = clamp(el, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.42));
  // slightly brighter haze band just above the horizon
  col = mix(col, uHorizon * 1.04, (1.0 - smoothstep(0.0, 0.06, el)) * 0.6);
  if (el < 0.0) {
    vec3 below = uEnvMode > 0.5 ? uGround : uHorizon;
    col = mix(uHorizon, below, smoothstep(0.0, uEnvMode > 0.5 ? 0.12 : 0.35, -el));
  }
  float cs = dot(d, uSunDir);
  float horizonW = 1.0 - smoothstep(0.0, 0.55, abs(el));
  float glow = pow(max(cs, 0.0), 6.0) * (0.35 + 0.65 * horizonW) + pow(max(cs, 0.0), 48.0) * 0.6;
  col += uGlow * glow * uGlowStrength;
  // sun disc + corona
  float disc = smoothstep(0.99975, 0.99988, cs);
  float corona = pow(max(cs, 0.0), 900.0) * 0.8;
  col += uSunColor * (disc * 6.0 + corona) * uSunDisc * step(-0.02, el);
  // night sky
  if (uStars > 0.001 && el > -0.05) {
    vec3 sp = d * 260.0;
    vec3 cell = floor(sp);
    float h = h13(cell);
    if (h > 0.986) {
      vec3 starPos = cell + vec3(h13(cell + 1.7), h13(cell + 4.3), h13(cell + 9.1));
      float sd = length(sp - starPos);
      float tw = 0.75 + 0.25 * sin(uTime * (2.0 + h * 9.0) + h * 40.0);
      float b = (1.0 - smoothstep(0.0, 0.11 + (h - 0.986) * 6.0, sd)) * tw;
      col += vec3(0.82, 0.88, 1.0) * b * uStars * smoothstep(-0.02, 0.15, el) * (0.6 + 30.0 * (h - 0.986));
    }
    float mc = dot(d, uMoonDir);
    col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.99955, 0.9997, mc) * 1.6 + pow(max(mc, 0.0), 300.0) * 0.25) * uStars;
  }
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.4 + 0.6 * up);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** Sky dome + lights + fog + exposure + PMREM environment for one scene */
export class SkySystem {
  readonly dome: THREE.Mesh;
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbfd6ee, 0x6f7f4a, 1.4);
  readonly fog: THREE.FogExp2;
  state: SkyState;
  private readonly material: THREE.ShaderMaterial;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private time = 0;
  private flash = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private timeOfDay: number,
    private readonly weather: Weather,
    private readonly biome: BiomeDef,
  ) {
    this.state = computeSkyState(timeOfDay, weather, biome);
    this.material = new THREE.ShaderMaterial({
      name: 'tna_sky',
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uGlow: { value: new THREE.Color() },
        uGlowStrength: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uSunDisc: { value: 1 },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uStars: { value: 0 },
        uFlash: { value: 0 },
        uTime: { value: 0 },
        uEnvMode: { value: 0 },
      },
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.material);
    this.dome.name = 'tna_sky';
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.fog = new THREE.FogExp2(0xbcd6f0, this.state.fogDensity);
    this.sun.name = 'tna_sun';
    this.hemi.name = 'tna_hemi';
    scene.add(this.dome, this.sun, this.hemi);
    scene.fog = this.fog;
    this.apply();
  }

  setTimeOfDay(hours: number): void {
    this.timeOfDay = hours;
    this.state = computeSkyState(hours, this.weather, this.biome);
    this.apply();
  }

  /** Lightning or other global flash (0..1), decays in update */
  triggerFlash(amount: number): void {
    this.flash = Math.max(this.flash, amount);
  }

  get flashLevel(): number {
    return this.flash;
  }

  private apply(): void {
    const s = this.state;
    const u = this.material.uniforms;
    u.uZenith.value.copy(s.zenith);
    u.uHorizon.value.copy(s.horizon);
    u.uGround.value.copy(s.hemiGround).lerp(s.horizon, 0.35).multiplyScalar(0.8);
    u.uGlow.value.copy(s.glow);
    u.uGlowStrength.value = s.glowStrength;
    u.uSunDir.value.copy(s.sunDir);
    u.uSunColor.value.copy(s.lightColor);
    u.uSunDisc.value = s.sunDisc;
    u.uMoonDir.value.copy(s.moonDir);
    u.uStars.value = s.stars;
    this.fog.color.copy(s.horizon);
    this.fog.density = s.fogDensity;
    this.sun.color.copy(s.lightColor);
    this.sun.intensity = s.lightIntensity;
    this.sun.position.copy(s.lightDir).multiplyScalar(1000);
    this.sun.target.position.set(0, 0, 0);
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = s.hemiIntensity;
    this.renderer.toneMappingExposure = s.exposure;
    this.rebuildEnvironment();
  }

  private rebuildEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envDome = new THREE.Mesh(this.dome.geometry, this.material);
    envDome.frustumCulled = false;
    envScene.add(envDome);
    this.material.uniforms.uEnvMode.value = 1;
    const target = pmrem.fromScene(envScene, 0, 0.1, 10, { size: 128 });
    this.material.uniforms.uEnvMode.value = 0;
    pmrem.dispose();
    this.envTarget?.dispose();
    this.envTarget = target;
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = this.state.envIntensity;
  }

  update(dt: number): void {
    this.time += dt;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
    }
    u.uFlash.value = this.flash * 0.6;
    this.hemi.intensity = this.state.hemiIntensity * (1 + this.flash * 2.5);
  }

  dispose(): void {
    this.scene.remove(this.dome, this.sun, this.hemi);
    if (this.scene.fog === this.fog) this.scene.fog = null;
    if (this.envTarget && this.scene.environment === this.envTarget.texture) this.scene.environment = null;
    this.envTarget?.dispose();
    this.dome.geometry.dispose();
    this.material.dispose();
    this.sun.dispose();
    this.hemi.dispose();
  }
}
