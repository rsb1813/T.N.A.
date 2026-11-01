// 3D 모델 로더/캐시. 미션 시작 전에 preloadModels() 로 올려두고, 엔티티 생성 시 getModel() 로 복제한다.
// 모델이 없으면 간단한 대체 형상을 돌려줘서 모델 작업 전에도 게임이 돌아간다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

export const MODEL_BASE = `${import.meta.env?.BASE_URL ?? './'}models/`;

const cache = new Map<string, THREE.Object3D | null>();
const pending = new Map<string, Promise<THREE.Object3D | null>>();
let loader: GLTFLoader | null = null;

function getLoader(): GLTFLoader {
  if (!loader) loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

/** 모델 하나 로드 (실패하면 null 캐시 → 대체 형상 사용) */
export function loadModel(id: string): Promise<THREE.Object3D | null> {
  if (cache.has(id)) return Promise.resolve(cache.get(id) ?? null);
  const p = pending.get(id);
  if (p) return p;
  const promise = getLoader()
    .loadAsync(`${MODEL_BASE}${id}.glb`)
    .then((gltf) => {
      const root = gltf.scene;
      root.name = id;
      root.userData.animations = gltf.animations;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.frustumCulled = true;
      });
      cache.set(id, root);
      return root;
    })
    .catch((err) => {
      console.warn(`[assets] 모델 '${id}' 로드 실패 — 대체 형상 사용`, err?.message ?? err);
      cache.set(id, null);
      return null;
    })
    .finally(() => pending.delete(id));
  pending.set(id, promise);
  return promise;
}

export async function preloadModels(ids: Iterable<string>, onProgress?: (done: number, total: number) => void): Promise<void> {
  const list = [...new Set(ids)];
  let done = 0;
  await Promise.all(
    list.map((id) =>
      loadModel(id).then(() => {
        done++;
        onProgress?.(done, list.length);
      }),
    ),
  );
}

export function hasModel(id: string): boolean {
  return !!cache.get(id);
}

/**
 * 모델 복제본. 머티리얼은 공유되므로 색을 바꾸려면 cloneMaterials 사용.
 * 로드되지 않았으면 대체 형상(fallback 크기 기준) 반환.
 */
export function getModel(id: string, fallback: FallbackShape = { kind: 'aircraft', length: 15 }): THREE.Object3D {
  const src = cache.get(id);
  if (src) {
    const obj = skeletonClone(src);
    obj.userData.modelId = id;
    return obj;
  }
  const obj = makeFallback(fallback);
  obj.userData.modelId = id;
  obj.userData.fallback = true;
  return obj;
}

/** 이름으로 노드 찾기 (station_L1, nozzle_L 등) */
export function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return root.getObjectByName(name) ?? null;
}

/** 이름 접두사로 노드 수집 */
export function findNodes(root: THREE.Object3D, prefix: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name.startsWith(prefix)) out.push(o);
  });
  return out;
}

/** 머티리얼을 복제해서 이 인스턴스만 색을 바꿀 수 있게 한다 */
export function cloneMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
  });
}

/** 이름이 name 인 머티리얼(들)의 기본색 변경 (예: 'paint' → 세력 도장) */
export function tintMaterial(root: THREE.Object3D, name: string, color: THREE.ColorRepresentation): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const std = mat as THREE.MeshStandardMaterial;
      if (std.name === name && std.color) std.color.set(color);
    }
  });
}

// ---------------------------------------------------------------- 대체 형상

export type FallbackShape =
  | { kind: 'aircraft'; length: number }
  | { kind: 'missile'; length: number }
  | { kind: 'box'; size: [number, number, number] };

const fallbackMat = new THREE.MeshStandardMaterial({ color: 0x8a96a3, roughness: 0.6, metalness: 0.2, name: 'paint' });

function makeFallback(shape: FallbackShape): THREE.Object3D {
  const g = new THREE.Group();
  if (shape.kind === 'aircraft') {
    const L = shape.length;
    const body = new THREE.Mesh(new THREE.ConeGeometry(L * 0.07, L, 8).rotateX(-Math.PI / 2), fallbackMat);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(L * 0.7, L * 0.02, L * 0.25), fallbackMat);
    wing.position.z = L * 0.1;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(L * 0.02, L * 0.2, L * 0.15), fallbackMat);
    tail.position.set(0, L * 0.1, L * 0.4);
    g.add(body, wing, tail);
  } else if (shape.kind === 'missile') {
    const L = shape.length;
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(L * 0.04, L * 0.04, L, 6).rotateX(Math.PI / 2), fallbackMat));
  } else {
    const [x, y, z] = shape.size;
    const m = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), fallbackMat);
    m.position.y = y / 2;
    g.add(m);
  }
  return g;
}
