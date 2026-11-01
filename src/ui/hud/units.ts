// HUD 표시 단위 변환/포맷 (순수 함수). 시뮬레이션 값은 SI, 표시만 kt/ft/NM 또는 km/h/m/km.
import { FT, KT, NM, type UnitSystem } from '../../core/math';

export function speedIn(ms: number, u: UnitSystem): number {
  return u === 'nato' ? ms / KT : ms * 3.6;
}

export function altitudeIn(m: number, u: UnitSystem): number {
  return u === 'nato' ? m / FT : m;
}

/** 수직속도: nato = ft/min, metric = m/s */
export function verticalSpeedIn(ms: number, u: UnitSystem): number {
  return u === 'nato' ? (ms / FT) * 60 : ms;
}

export function distanceIn(m: number, u: UnitSystem): number {
  return u === 'nato' ? m / NM : m / 1000;
}

/** 표시 단위 1 의 미터 값 */
export function metersPerDistanceUnit(u: UnitSystem): number {
  return u === 'nato' ? NM : 1000;
}

export const speedLabel = (u: UnitSystem): string => (u === 'nato' ? 'KT' : 'KM/H');
export const altitudeLabel = (u: UnitSystem): string => (u === 'nato' ? 'FT' : 'M');
export const distanceLabel = (u: UnitSystem): string => (u === 'nato' ? 'NM' : 'KM');
export const verticalSpeedLabel = (u: UnitSystem): string => (u === 'nato' ? 'FPM' : 'M/S');

/** 거리 표시: 10 미만은 소수 1자리, 그 이상은 정수 */
export function formatRange(m: number, u: UnitSystem): string {
  const v = distanceIn(Math.max(0, m), u);
  return v < 9.95 ? v.toFixed(1) : `${Math.round(v)}`;
}

/** 정수 천 단위 구분 (12,500). toLocaleString 보다 싸고 환경 독립 */
export function formatThousands(n: number): string {
  const v = Math.round(n);
  const neg = v < 0;
  let s = `${Math.abs(v)}`;
  if (s.length > 3) {
    let out = '';
    let i = s.length % 3;
    if (i > 0) out = s.slice(0, i);
    for (; i < s.length; i += 3) out += (out ? ',' : '') + s.slice(i, i + 3);
    s = out;
  }
  return neg ? `-${s}` : s;
}

export function formatSigned(n: number, digits = 0): string {
  const r = digits > 0 ? n.toFixed(digits) : `${Math.round(n)}`;
  const zero = Number(r) === 0;
  if (zero) return digits > 0 ? (0).toFixed(digits) : '0';
  return n > 0 ? `+${r}` : r;
}

/** 수직속도: ft/min 은 10 단위 반올림 + 천 단위 구분, m/s 는 소수 1자리 */
export function formatVerticalSpeed(ms: number, u: UnitSystem): string {
  const v = verticalSpeedIn(ms, u);
  if (u === 'nato') {
    const r = Math.round(v / 10) * 10;
    if (r === 0) return '0';
    return (r > 0 ? '+' : '') + formatThousands(r);
  }
  return formatSigned(v, 1);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 초 → "MM:SS" (1시간 이상이면 "H:MM:SS") */
export function formatClock(sec: number): string {
  const t = Math.max(0, Math.floor(sec + 1e-6));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

/** 방위 3자리 (0 → "000", 360 → "000") */
export function formatHeading(deg: number): string {
  let d = Math.round(deg) % 360;
  if (d < 0) d += 360;
  return d < 10 ? `00${d}` : d < 100 ? `0${d}` : `${d}`;
}

/** 표적 aspect: 0 = 꼬리, 180 = 정면. side = 우리가 보는 표적의 좌/우 */
export function formatAspect(deg: number, side: 'L' | 'R'): string {
  const d = Math.round(Math.max(0, Math.min(180, deg)));
  if (d === 0 || d === 180) return `${d}`;
  return `${d}${side}`;
}
