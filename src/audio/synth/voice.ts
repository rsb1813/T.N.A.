// 보이스 빌더: 한 번의 소리를 이루는 노드들을 만들고, 끝나면 한꺼번에 정리한다.
import type { NoiseKind, Rand, SynthAssets } from './assets';

/** 0 으로 지수 램프를 할 수 없어서 쓰는 최소값 */
export const SILENT = 1e-4;

export class Voice {
  readonly nodes: AudioNode[] = [];
  readonly sources: AudioScheduledSourceNode[] = [];
  /** 마지막 소스가 멈추는 시각 */
  end = 0;
  disposed = false;
  private lastSource: AudioScheduledSourceNode | null = null;
  private endedCb: (() => void) | null = null;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly assets: SynthAssets,
    /** 이 보이스의 출력 (레시피는 여기에 연결한다) */
    readonly out: AudioNode,
    readonly rnd: Rand = Math.random,
  ) {}

  /** 지터: center × (1 ± spread) */
  vary(center: number, spread: number): number {
    return center * (1 + (this.rnd() * 2 - 1) * spread);
  }

  gain(value = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    this.nodes.push(g);
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.707, gainDb = 0): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.gain.value = gainDb;
    this.nodes.push(f);
    return f;
  }

  shaper(curve: Float32Array<ArrayBuffer>, oversample: OverSampleType = '2x'): WaveShaperNode {
    const s = this.ctx.createWaveShaper();
    s.curve = curve;
    s.oversample = oversample;
    this.nodes.push(s);
    return s;
  }

  osc(type: OscillatorType, freq: number, t0: number, t1: number, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    this.schedule(o, t0, t1);
    return o;
  }

  /** 루프 노이즈 소스 (랜덤 시작 위치) */
  noise(kind: NoiseKind, t0: number, t1: number, rate = 1): AudioBufferSourceNode {
    const buf = this.assets.noise(kind);
    return this.buffer(buf, t0, t1, true, rate, this.rnd() * buf.duration);
  }

  buffer(buf: AudioBuffer, t0: number, t1: number, loop: boolean, rate = 1, offset = 0): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    s.playbackRate.value = rate;
    this.schedule(s, t0, t1, offset % buf.duration);
    return s;
  }

  constant(value: number, t0: number, t1: number): ConstantSourceNode {
    const c = this.ctx.createConstantSource();
    c.offset.value = value;
    this.schedule(c, t0, t1);
    return c;
  }

  /** a → b → c ... 직렬 연결, 마지막 노드 반환 */
  chain<T extends AudioNode>(...nodes: [AudioNode, ...AudioNode[], T]): T {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1] as T;
  }

  /** 모든 소스를 when 에 멈춘다 (보이스 강탈/즉시 정지) */
  stopAt(when: number): void {
    for (const s of this.sources) {
      try {
        s.stop(when);
      } catch {
        /* 이미 멈춤 */
      }
    }
    this.end = Math.min(this.end, when);
  }

  /** 마지막 소스가 끝나면 한 번 호출 */
  onEnded(cb: () => void): void {
    this.endedCb = cb;
    if (this.lastSource) this.lastSource.onended = () => this.endedCb?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* 이미 멈춤 */
      }
      s.disconnect();
    }
    for (const n of this.nodes) n.disconnect();
    this.sources.length = 0;
    this.nodes.length = 0;
    this.endedCb = null;
  }

  private schedule(s: AudioScheduledSourceNode, t0: number, t1: number, offset?: number): void {
    if (offset !== undefined) (s as AudioBufferSourceNode).start(t0, offset);
    else s.start(t0);
    s.stop(t1);
    this.sources.push(s);
    this.nodes.push(s);
    if (t1 >= this.end) {
      this.end = t1;
      if (this.lastSource) this.lastSource.onended = null;
      this.lastSource = s;
      if (this.endedCb) s.onended = () => this.endedCb?.();
    }
  }
}

// ---------------------------------------------------------------- 엔벨로프 헬퍼

/** 빠른 상승 후 지수 감쇠. decay 초 뒤에는 약 −50dB. 끝 시각 반환 */
export function envAD(p: AudioParam, t0: number, peak: number, attack: number, decay: number): number {
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(peak, t0 + attack);
  p.setTargetAtTime(0, t0 + attack, decay / 6);
  return t0 + attack + decay;
}

/** 상승 → 유지 → 지수 감쇠. 끝 시각 반환 */
export function envAHD(p: AudioParam, t0: number, peak: number, attack: number, hold: number, decay: number): number {
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(peak, t0 + attack);
  p.setValueAtTime(peak, t0 + attack + hold);
  p.setTargetAtTime(0, t0 + attack + hold, decay / 6);
  return t0 + attack + hold + decay;
}

/** 지수 스윕 (양수 값만) */
export function sweep(p: AudioParam, t0: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(Math.max(SILENT, from), t0);
  p.exponentialRampToValueAtTime(Math.max(SILENT, to), t0 + Math.max(0.001, dur));
}

/** 진행 중인 자동화를 now 값으로 고정 (cancelAndHoldAtTime 미지원 브라우저 대비) */
export function holdParam(p: AudioParam, now: number): void {
  const anyP = p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof anyP.cancelAndHoldAtTime === 'function') {
    anyP.cancelAndHoldAtTime(now);
  } else {
    const v = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(v, now);
  }
}

/** 값이 의미 있게 바뀔 때만 setTargetAtTime (매 프레임 자동화 이벤트 누적 방지) */
export class SmoothParam {
  private last = Number.NaN;

  constructor(
    readonly param: AudioParam,
    private readonly timeConstant: number,
    private readonly epsilon = 1e-3,
  ) {}

  set(value: number, now: number, timeConstant = this.timeConstant): void {
    if (!Number.isFinite(value)) return;
    if (Number.isFinite(this.last) && Math.abs(value - this.last) <= this.epsilon * Math.max(1, Math.abs(this.last))) return;
    this.last = value;
    this.param.setTargetAtTime(value, now, timeConstant);
  }

  /** 즉시 설정 (실체화 직후) */
  jump(value: number, now: number): void {
    if (!Number.isFinite(value)) return;
    this.last = value;
    this.param.cancelScheduledValues(now);
    this.param.setValueAtTime(value, now);
  }

  get target(): number {
    return this.last;
  }
}
