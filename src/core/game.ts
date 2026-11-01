// 게임 루프: 고정 스텝 시뮬레이션 + 가변 프레임 렌더.
import * as THREE from 'three';
import type { Sim } from './sim';

export interface System {
  readonly name: string;
  /** 고정 스텝마다 (엔티티 갱신 후) */
  fixedUpdate?(dt: number, sim: Sim): void;
  /** 렌더 프레임마다 (카메라, 이펙트, HUD, 오디오 리스너 등) */
  update?(dt: number, sim: Sim): void;
  dispose?(): void;
}

export const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  sim: Sim | null = null;
  paused = false;
  /** 시간 배율 (킬캠 슬로모션 등) */
  timeScale = 1;
  /** 마지막 프레임 렌더 시간 (ms) — 성능 표시용 */
  frameMs = 0;
  fps = 0;

  private systems: System[] = [];
  private accumulator = 0;
  private lastTime = 0;
  private raf = 0;
  private running = false;
  private fpsFrames = 0;
  private fpsTime = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = false;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 400_000);
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
    } else {
      window.addEventListener('resize', () => this.resize());
    }
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setSim(sim: Sim | null): void {
    this.sim = sim;
    this.accumulator = 0;
  }

  addSystem(s: System): void {
    this.systems.push(s);
  }

  removeSystem(s: System): void {
    this.systems = this.systems.filter((x) => x !== s);
  }

  /** 시스템 전부 dispose 후 제거 */
  clearSystems(): void {
    for (const s of this.systems) {
      try {
        s.dispose?.();
      } catch (err) {
        console.error(`[game] ${s.name} dispose 오류`, err);
      }
    }
    this.systems = [];
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** 시뮬레이션을 n 스텝 강제로 진행 (테스트/헤드리스 검증용) */
  stepFixed(n = 1): void {
    for (let i = 0; i < n; i++) this.fixedStep(FIXED_DT);
  }

  /** 한 프레임 처리. 테스트에서 직접 호출 가능 */
  frame(nowMs: number): void {
    const t0 = performance.now();
    const realDt = Math.min(0.1, Math.max(0, (nowMs - this.lastTime) / 1000));
    this.lastTime = nowMs;
    const sim = this.sim;
    if (sim && !this.paused) {
      this.accumulator += realDt * this.timeScale;
      let steps = 0;
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        this.fixedStep(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }
    if (sim) {
      const dt = this.paused ? 0 : realDt * this.timeScale;
      sim.world.syncObjects();
      for (const s of this.systems) {
        if (!s.update) continue;
        try {
          s.update(dt, sim);
        } catch (err) {
          console.error(`[game] ${s.name}.update 오류`, err);
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.frameMs = performance.now() - t0;
    this.fpsFrames++;
    this.fpsTime += realDt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }

  private fixedStep(dt: number): void {
    const sim = this.sim;
    if (!sim) return;
    sim.time += dt;
    sim.frame++;
    sim.world.step(dt, sim);
    for (const s of this.systems) {
      if (!s.fixedUpdate) continue;
      try {
        s.fixedUpdate(dt, sim);
      } catch (err) {
        console.error(`[game] ${s.name}.fixedUpdate 오류`, err);
      }
    }
  }

  dispose(): void {
    this.stop();
    this.clearSystems();
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
  }
}
