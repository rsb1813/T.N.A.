// 월드 → 화면 투영 (순수 수학, DOM 없음). HUD 는 sim.camera 로 매 프레임 갱신해서 쓴다.
import * as THREE from 'three';

export interface ScreenPoint {
  x: number;
  y: number;
  /** 카메라 앞쪽 (w > 0) */
  front: boolean;
  /** 카메라 앞 방향 거리 (m, 클립 w). 방향 투영이면 1 */
  depth: number;
}

export function makeScreenPoint(): ScreenPoint {
  return { x: 0, y: 0, front: false, depth: 0 };
}

const _m = new THREE.Matrix4();

export class Projector {
  width = 1;
  height = 1;
  /** 화면 중앙에서 tan(각) 1 에 해당하는 픽셀 (세로 기준) */
  focalPx = 1;
  /** view-projection 행렬 원소 (열 우선) */
  private readonly vp = new Float64Array(16);
  /** view(회전+이동) 행렬 원소 */
  private readonly view = new Float64Array(16);

  /** camera.matrixWorldInverse / projectionMatrix 가 최신이어야 한다 (HUD 가 updateMatrixWorld 호출) */
  update(camera: THREE.Camera & { projectionMatrix: THREE.Matrix4 }, width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = _m.elements;
    for (let i = 0; i < 16; i++) this.vp[i] = e[i];
    const v = camera.matrixWorldInverse.elements;
    for (let i = 0; i < 16; i++) this.view[i] = v[i];
    this.focalPx = (camera.projectionMatrix.elements[5] * this.height) / 2;
  }

  private projectH(x: number, y: number, z: number, w: number, out: ScreenPoint): boolean {
    const m = this.vp;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
    out.depth = cw;
    if (cw <= 1e-6) {
      out.front = false;
      // 뒤쪽 점: 화면 방향만 의미 있게 (멀리 바깥으로)
      const k = 1e6;
      out.x = this.width * 0.5 + cx * k;
      out.y = this.height * 0.5 - cy * k;
      return false;
    }
    out.front = true;
    out.x = (cx / cw + 1) * 0.5 * this.width;
    out.y = (1 - cy / cw) * 0.5 * this.height;
    return true;
  }

  /** 월드 점 → 화면 px. 카메라 앞이면 true */
  projectPoint(p: THREE.Vector3, out: ScreenPoint): boolean {
    return this.projectH(p.x, p.y, p.z, 1, out);
  }

  projectXYZ(x: number, y: number, z: number, out: ScreenPoint): boolean {
    return this.projectH(x, y, z, 1, out);
  }

  /** 무한 원점의 방향 (보어사이트, 비행경로, 피치 래더) → 화면 px */
  projectDirection(dx: number, dy: number, dz: number, out: ScreenPoint): boolean {
    const ok = this.projectH(dx, dy, dz, 0, out);
    out.depth = 1;
    return ok;
  }

  /** 월드 점 → 카메라 공간 (x 오른쪽, y 위, z 뒤 = 카메라는 -z 를 본다) */
  toCamera(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const m = this.view;
    const x = p.x;
    const y = p.y;
    const z = p.z;
    return out.set(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
  }

  /** 반지름 r(m) 물체가 depth 에서 차지하는 화면 반지름 px */
  pixelRadius(r: number, depth: number): number {
    return depth > 1e-3 ? (r * this.focalPx) / depth : 0;
  }

  inside(sp: ScreenPoint, margin = 0): boolean {
    return sp.front && sp.x >= margin && sp.y >= margin && sp.x <= this.width - margin && sp.y <= this.height - margin;
  }
}

export interface EdgeArrow {
  x: number;
  y: number;
  /** 화살표 방향 (rad, 캔버스 기준: 0 = 오른쪽, π/2 = 아래) */
  angle: number;
}

/**
 * 화면 밖 표적 화살표: 카메라 공간 좌표에서 화면 방향을 구해 타원(rx, ry) 위에 놓는다.
 * 카메라 뒤쪽 표적도 같은 식으로 "그쪽으로 돌아라" 방향이 나온다. 정확히 뒤면 아래를 가리킨다.
 */
export function edgeArrow(camX: number, camY: number, cx: number, cy: number, rx: number, ry: number, out: EdgeArrow): EdgeArrow {
  let dx = camX;
  let dy = -camY;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) {
    dx = 0;
    dy = 1;
  } else {
    dx /= len;
    dy /= len;
  }
  // 타원과 반직선의 교점: t = 1 / sqrt((dx/rx)² + (dy/ry)²)
  const t = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  out.x = cx + dx * t;
  out.y = cy + dy * t;
  out.angle = Math.atan2(dy, dx);
  return out;
}

/** 방위(deg, 기수 기준 시계방향) → 캔버스 각 (rad). 0° = 위 */
export function bearingToCanvasAngle(bearingDeg: number): number {
  return ((bearingDeg - 90) * Math.PI) / 180;
}
