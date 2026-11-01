// 속도/고도/방위 테이프 눈금 계산 (순수 함수, 할당 없는 버퍼 재사용).

export interface TapeTick {
  value: number;
  /** 중앙 기준 상대 위치 -1..1 (반 스팬으로 정규화). 양수 = 값이 큼(세로 테이프 위쪽 / 방위 테이프 오른쪽) */
  offset: number;
  major: boolean;
}

export class TickBuffer {
  readonly ticks: TapeTick[] = [];
  count = 0;

  reset(): void {
    this.count = 0;
  }

  push(value: number, offset: number, major: boolean): void {
    let t = this.ticks[this.count];
    if (!t) this.ticks.push((t = { value: 0, offset: 0, major: false }));
    t.value = value;
    t.offset = offset;
    t.major = major;
    this.count++;
  }
}

function isMajor(k: number, ratio: number): boolean {
  return ((k % ratio) + ratio) % ratio === 0;
}

/**
 * value 중심 ±halfSpan 범위 눈금. minorStep 간격, majorStep(=minorStep 의 정수배)마다 큰 눈금.
 * minValue 아래 값(예: 음수 속도)은 넣지 않는다. 반환 = 눈금 수.
 */
export function computeTapeTicks(
  value: number,
  halfSpan: number,
  minorStep: number,
  majorStep: number,
  buf: TickBuffer,
  minValue = -Infinity,
): number {
  buf.reset();
  if (!(halfSpan > 0) || !(minorStep > 0) || !Number.isFinite(value)) return 0;
  const ratio = Math.max(1, Math.round(majorStep / minorStep));
  const lo = Math.max(value - halfSpan, minValue);
  const hi = value + halfSpan;
  const k0 = Math.ceil(lo / minorStep - 1e-9);
  const k1 = Math.floor(hi / minorStep + 1e-9);
  for (let k = k0; k <= k1; k++) {
    const v = k * minorStep;
    buf.push(v, (v - value) / halfSpan, isMajor(k, ratio));
  }
  return buf.count;
}

/** 방위 차이 to - from (deg, -180..180) */
export function headingDiff(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

/** 방위 테이프: 값은 0..360 으로 감아서 기록. offset 양수 = 오른쪽 */
export function computeHeadingTicks(heading: number, halfSpanDeg: number, minorStep: number, majorStep: number, buf: TickBuffer): number {
  buf.reset();
  if (!(halfSpanDeg > 0) || !(minorStep > 0) || !Number.isFinite(heading)) return 0;
  const ratio = Math.max(1, Math.round(majorStep / minorStep));
  const k0 = Math.ceil((heading - halfSpanDeg) / minorStep - 1e-9);
  const k1 = Math.floor((heading + halfSpanDeg) / minorStep + 1e-9);
  for (let k = k0; k <= k1; k++) {
    const raw = k * minorStep;
    let v = raw % 360;
    if (v < 0) v += 360;
    buf.push(v, (raw - heading) / halfSpanDeg, isMajor(k, ratio));
  }
  return buf.count;
}

/** 방위 → 나침반 문자 (주요 방위만, 아니면 null) */
export function cardinalLabel(deg: number): string | null {
  const d = Math.round(deg) % 360;
  switch (d) {
    case 0:
      return 'N';
    case 90:
      return 'E';
    case 180:
      return 'S';
    case 270:
      return 'W';
    default:
      return null;
  }
}

/** 테이프 단위 구성: 표시 단위계별 스팬/눈금 */
export interface TapeScale {
  halfSpan: number;
  minor: number;
  major: number;
}

export const SPEED_TAPE: Record<'nato' | 'metric', TapeScale> = {
  nato: { halfSpan: 60, minor: 10, major: 50 },
  metric: { halfSpan: 110, minor: 20, major: 100 },
};

export const ALTITUDE_TAPE: Record<'nato' | 'metric', TapeScale> = {
  nato: { halfSpan: 600, minor: 100, major: 500 },
  metric: { halfSpan: 200, minor: 50, major: 200 },
};
