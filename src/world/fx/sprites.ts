// Additive billboards re-written every frame (motor flames, flare cores, muzzle glows).
// Optional stretch along a world direction for flame tongues.
import * as THREE from 'three';
import { GLSL_FOG_FACTOR, GLSL_FRAG_PARS, GLSL_VERT_END, GLSL_VERT_PARS } from '../glsl';
import { getParticleTexture } from '../textures';

const VERT = /* glsl */ `
${GLSL_VERT_PARS}
attribute vec4 aPos;
attribute vec4 aCol;
attribute vec4 aDir;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 mvPosition = viewMatrix * vec4(aPos.xyz, 1.0);
  vec2 c = position.xy;
  float size = aPos.w;
  vec2 off = c * size;
  if (aDir.w > 0.0) {
    vec3 vd = (viewMatrix * vec4(aDir.xyz, 0.0)).xyz;
    float l = length(vd.xy);
    vec2 dir = l > 1e-4 ? vd.xy / l : vec2(0.0, 1.0);
    float L = size + aDir.w * l;
    off = dir * (c.y + 0.5 - 0.5 * size / L) * L + vec2(-dir.y, dir.x) * c.x * size;
  }
  mvPosition.xy += off;
  gl_Position = projectionMatrix * mvPosition;
  vUv = (c + 0.5) * 0.5;
  vCol = aCol;
  ${GLSL_VERT_END}
}
`;

const FRAG = /* glsl */ `
${GLSL_FRAG_PARS}
${GLSL_FOG_FACTOR}
uniform sampler2D uTex;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  #include <logdepthbuf_fragment>
  vec4 tx = texture2D(uTex, vUv);
  float a = tx.a * vCol.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol.rgb * (1.0 - tnaFogFactor()), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class SpriteBank {
  readonly mesh: THREE.Mesh;
  private readonly geom: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aCol: THREE.InstancedBufferAttribute;
  private readonly aDir: THREE.InstancedBufferAttribute;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly dir: Float32Array;
  private count = 0;

  constructor(readonly capacity: number) {
    this.geom = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geom.index = quad.index;
    this.geom.setAttribute('position', quad.attributes.position);
    this.pos = new Float32Array(capacity * 4);
    this.col = new Float32Array(capacity * 4);
    this.dir = new Float32Array(capacity * 4);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 4).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aDir = new THREE.InstancedBufferAttribute(this.dir, 4).setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('aPos', this.aPos);
    this.geom.setAttribute('aCol', this.aCol);
    this.geom.setAttribute('aDir', this.aDir);
    this.geom.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      name: 'tna_fx_sprites',
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: null } }]),
    });
    this.material.uniforms.uTex.value = getParticleTexture();
    this.mesh = new THREE.Mesh(this.geom, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 23;
    this.mesh.name = 'tna_fx_sprites';
  }

  begin(): void {
    this.count = 0;
  }

  /** Add a glow (size m, HDR colour). dir/stretch: elongate backwards along a world direction (stretch m) */
  add(p: THREE.Vector3, size: number, r: number, g: number, b: number, a: number, dir?: THREE.Vector3, stretch = 0): void {
    if (this.count >= this.capacity) return;
    const o = this.count * 4;
    this.pos[o] = p.x;
    this.pos[o + 1] = p.y;
    this.pos[o + 2] = p.z;
    this.pos[o + 3] = size;
    this.col[o] = r;
    this.col[o + 1] = g;
    this.col[o + 2] = b;
    this.col[o + 3] = a;
    if (dir && stretch > 0) {
      this.dir[o] = dir.x;
      this.dir[o + 1] = dir.y;
      this.dir[o + 2] = dir.z;
      this.dir[o + 3] = stretch;
    } else {
      this.dir[o + 3] = 0;
    }
    this.count++;
  }

  end(): void {
    const n = this.count * 4;
    for (const a of [this.aPos, this.aCol, this.aDir]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(4, n));
      a.needsUpdate = true;
    }
    this.geom.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geom.dispose();
    this.material.dispose();
  }
}
