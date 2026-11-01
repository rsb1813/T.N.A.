// 컨텍스트별 공용 오디오 버퍼: 노이즈(백색/핑크/브라운), 화염 파열음, M61A2 펄스열, 잔향 IR, 경고음 패턴.
// 모두 절차적으로 생성한다 (오디오 파일 없음). OfflineAudioContext 에도 그대로 쓸 수 있다.

export type NoiseKind = 'white' | 'pink' | 'brown';
export type Rand = () => number;

export interface SynthAssets {
  readonly ctx: BaseAudioContext;
  /** 스테레오(좌우 비상관) 루프 노이즈 */
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  /** 드문드문 튀는 임펄스 (애프터버너/로켓 모터의 파열음, 채프 바스락거림) */
  readonly crackle: AudioBuffer;
  /** M61A2 6000rpm(100발/s) 펄스열 — 루프 재생, playbackRate 로 발사 속도 조절 */
  readonly gun: AudioBuffer;
  /** 실외 잔향 임펄스 응답 */
  readonly reverb: AudioBuffer;
  /** 부드러운 포화 (tanh) */
  readonly softClip: Float32Array<ArrayBuffer>;
  /** 강한 포화 (폭발 펀치) */
  readonly hardClip: Float32Array<ArrayBuffer>;
  noise(kind: NoiseKind): AudioBuffer;
  /** 반복 게이트 패턴 (0..1 제어 신호). segments = [시작 s, 길이 s][] */
  gate(key: string, periodSec: number, segments: ReadonlyArray<readonly [number, number]>, edgeSec?: number): AudioBuffer;
  /** 반복 계단 패턴 (값 그대로, 예: 주파수 Hz). steps = [시작 s, 값][] (시작 오름차순) */
  steps(key: string, periodSec: number, steps: ReadonlyArray<readonly [number, number]>, glideSec?: number): AudioBuffer;
}

const NOISE_SEC = 4;

/** 루프 이음새가 들리지 않게 끝 구간을 시작 구간에 교차 페이드한 채널 */
function seamless(src: Float32Array, length: number, fade: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length);
  out.set(src.subarray(0, length));
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const a = Math.sqrt(t);
    const b = Math.sqrt(1 - t);
    out[i] = src[i] * a + src[length + i] * b;
  }
  return out;
}

function normalizeRms(ch: Float32Array, targetRms: number): void {
  let s = 0;
  for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
  const rms = Math.sqrt(s / Math.max(1, ch.length));
  if (rms < 1e-9) return;
  const k = targetRms / rms;
  for (let i = 0; i < ch.length; i++) ch[i] = Math.max(-1, Math.min(1, ch[i] * k));
}

function makeNoise(ctx: BaseAudioContext, kind: NoiseKind, rnd: Rand): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.floor(NOISE_SEC * sr);
  const fade = Math.floor(0.05 * sr);
  const buf = ctx.createBuffer(2, length, sr);
  const raw = new Float32Array(length + fade);
  for (let c = 0; c < 2; c++) {
    if (kind === 'white') {
      for (let i = 0; i < raw.length; i++) raw[i] = rnd() * 2 - 1;
    } else if (kind === 'pink') {
      // Paul Kellet 의 핑크 노이즈 필터
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < raw.length; i++) {
        const w = rnd() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      }
    } else {
      // 누설 적분 브라운 노이즈 (직류 성분 제거)
      let last = 0;
      for (let i = 0; i < raw.length; i++) {
        last = (last + 0.02 * (rnd() * 2 - 1)) * 0.998;
        raw[i] = last;
      }
    }
    const ch = seamless(raw, length, fade);
    normalizeRms(ch, kind === 'white' ? 0.3 : 0.25);
    buf.getChannelData(c).set(ch);
  }
  return buf;
}

function makeCrackle(ctx: BaseAudioContext, rnd: Rand): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.floor(NOISE_SEC * sr);
  const buf = ctx.createBuffer(1, length, sr);
  const d = buf.getChannelData(0);
  // 평균 초당 90개의 짧은 파열 (랜덤 진폭·길이). 끝 0.02s 는 비워 루프 이음새를 없앤다
  const n = Math.floor(NOISE_SEC * 90);
  for (let k = 0; k < n; k++) {
    const at = Math.floor(rnd() * (length - 0.03 * sr));
    const amp = Math.pow(rnd(), 2.2) * (rnd() < 0.5 ? -1 : 1);
    const tau = (0.0004 + rnd() * 0.0025) * sr;
    const len = Math.min(Math.floor(tau * 6), length - at - 1);
    for (let i = 0; i < len; i++) d[at + i] += amp * Math.exp(-i / tau) * (rnd() * 2 - 1);
  }
  normalizeRms(d, 0.22);
  return buf;
}

/** 탄 하나 = 날카로운 파열 + 짧은 몸통 공명 + 저역 쿵. 10ms(6000rpm) 주기, 슬롯 안에서 지터 */
function makeGun(ctx: BaseAudioContext, rnd: Rand): AudioBuffer {
  const sr = ctx.sampleRate;
  const period = Math.round(0.01 * sr);
  const shots = 24;
  const length = period * shots;
  const buf = ctx.createBuffer(1, length, sr);
  const d = buf.getChannelData(0);
  for (let s = 0; s < shots; s++) {
    const jitter = Math.floor((rnd() - 0.5) * 0.0008 * sr);
    const base = s * period + Math.max(0, Math.floor(0.0006 * sr) + jitter);
    const amp = 0.85 + rnd() * 0.3;
    const bodyF = 120 + rnd() * 30;
    const end = Math.min(length, s * period + period);
    for (let i = base; i < end; i++) {
      const t = (i - base) / sr;
      const crack = (rnd() * 2 - 1) * Math.exp(-t / 0.0009);
      const body = Math.sin(2 * Math.PI * bodyF * t) * Math.exp(-t / 0.0032) * 0.55;
      const thump = Math.sin(2 * Math.PI * 62 * t) * Math.exp(-t / 0.0055) * 0.35;
      d[i] += amp * (crack + body + thump);
    }
  }
  normalizeRms(d, 0.3);
  return buf;
}

/** 실외(지형 반사) 잔향: 초반 반사 몇 개 + 시간이 갈수록 어두워지는 지수 감쇠 노이즈 */
function makeReverb(ctx: BaseAudioContext, rnd: Rand): AudioBuffer {
  const sr = ctx.sampleRate;
  const sec = 2.6;
  const length = Math.floor(sec * sr);
  const buf = ctx.createBuffer(2, length, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const w = rnd() * 2 - 1;
      // 저역통과 계수가 시간에 따라 작아짐 → 꼬리가 어두워진다
      const a = 0.08 + 0.75 * Math.exp(-t / 0.5);
      lp += a * (w - lp);
      d[i] = lp * Math.exp(-t / 0.55) * (t < 0.012 ? t / 0.012 : 1);
    }
    for (let k = 0; k < 6; k++) {
      const at = Math.floor((0.03 + rnd() * 0.22) * sr);
      d[at] += (rnd() < 0.5 ? -1 : 1) * (0.5 - k * 0.06);
    }
    normalizeRms(d, 0.05);
  }
  return buf;
}

function clipCurve(drive: number, n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const k = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / k;
  }
  return c;
}

export function createSynthAssets(ctx: BaseAudioContext, rnd: Rand = Math.random): SynthAssets {
  const white = makeNoise(ctx, 'white', rnd);
  const pink = makeNoise(ctx, 'pink', rnd);
  const brown = makeNoise(ctx, 'brown', rnd);
  const patterns = new Map<string, AudioBuffer>();
  return {
    ctx,
    white,
    pink,
    brown,
    crackle: makeCrackle(ctx, rnd),
    gun: makeGun(ctx, rnd),
    reverb: makeReverb(ctx, rnd),
    softClip: clipCurve(1.6),
    hardClip: clipCurve(4),
    noise(kind) {
      return kind === 'white' ? white : kind === 'pink' ? pink : brown;
    },
    gate(key, periodSec, segments, edgeSec = 0.004) {
      const id = `gate:${key}`;
      let b = patterns.get(id);
      if (b) return b;
      const sr = ctx.sampleRate;
      const length = Math.max(1, Math.round(periodSec * sr));
      b = ctx.createBuffer(1, length, sr);
      const d = b.getChannelData(0);
      const edge = Math.max(1, edgeSec * sr);
      for (const [start, dur] of segments) {
        const s0 = Math.round(start * sr);
        const s1 = Math.round((start + dur) * sr);
        for (let i = s0; i < s1; i++) {
          const k = Math.min(1, (i - s0) / edge, (s1 - i) / edge);
          d[((i % length) + length) % length] = Math.max(d[((i % length) + length) % length], k);
        }
      }
      patterns.set(id, b);
      return b;
    },
    steps(key, periodSec, steps, glideSec = 0.002) {
      const id = `steps:${key}`;
      let b = patterns.get(id);
      if (b) return b;
      const sr = ctx.sampleRate;
      const length = Math.max(1, Math.round(periodSec * sr));
      b = ctx.createBuffer(1, length, sr);
      const d = b.getChannelData(0);
      const glide = Math.max(1, glideSec * sr);
      for (let i = 0; i < length; i++) {
        const t = i / sr;
        let k = steps.length - 1;
        for (let j = 0; j < steps.length; j++) if (steps[j][0] <= t) k = j;
        const prev = steps[(k - 1 + steps.length) % steps.length][1];
        const since = i - Math.round(steps[k][0] * sr);
        const x = since >= 0 && since < glide ? since / glide : 1;
        d[i] = prev + (steps[k][1] - prev) * x;
      }
      patterns.set(id, b);
      return b;
    },
  };
}
