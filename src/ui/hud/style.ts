// HUD 색/글꼴/레이아웃 기준값. 레이아웃은 1280x720 기준 픽셀에 배율 s 를 곱해 쓴다.

export const HUD_COLORS = {
  main: '#7dffb0',
  mainDim: 'rgba(125, 255, 176, 0.55)',
  mainFaint: 'rgba(125, 255, 176, 0.18)',
  hostile: '#ff5a5a',
  target: '#ffd24a',
  friendly: '#6ecbff',
  neutral: '#c9d4cf',
  warn: '#ff3b3b',
  caution: '#ffb03b',
  text: '#eaf6ef',
  textDim: 'rgba(234, 246, 239, 0.6)',
  /** 패널 배경 — 밝은 하늘 위 가독성 */
  panel: 'rgba(3, 14, 9, 0.46)',
  panelEdge: 'rgba(125, 255, 176, 0.35)',
  /** 선택 행 반전 글자색 */
  inverse: '#03140a',
} as const;

export type HudColor = string;

/** 무전 화자 색 (RadioMessage.side) */
export const RADIO_SIDE_COLORS: Record<'friendly' | 'enemy' | 'neutral' | 'command', string> = {
  friendly: HUD_COLORS.friendly,
  enemy: HUD_COLORS.hostile,
  neutral: HUD_COLORS.neutral,
  command: HUD_COLORS.target,
};

/** 숫자는 고정폭. 한글 글리프는 시스템 한글 글꼴로 대체된다 */
export const FONT_MONO =
  "'JetBrains Mono', Consolas, 'DejaVu Sans Mono', Menlo, 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', 'WenQuanYi Zen Hei', monospace";
export const FONT_SANS =
  "'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', 'WenQuanYi Zen Hei', Inter, 'Segoe UI', sans-serif";

const fontCache = new Map<number, string>();

function fontKey(px: number, weight: number, family: 0 | 1): number {
  return (Math.round(px * 4) * 10 + Math.round(weight / 100)) * 2 + family;
}

/** 'bold 14px <mono>' 같은 문자열을 캐시해서 돌려준다 (매 프레임 문자열 생성 방지) */
export function monoFont(px: number, weight = 500): string {
  const k = fontKey(px, weight, 0);
  let f = fontCache.get(k);
  if (!f) fontCache.set(k, (f = `${weight} ${Math.round(px * 4) / 4}px ${FONT_MONO}`));
  return f;
}

export function sansFont(px: number, weight = 500): string {
  const k = fontKey(px, weight, 1);
  let f = fontCache.get(k);
  if (!f) fontCache.set(k, (f = `${weight} ${Math.round(px * 4) / 4}px ${FONT_SANS}`));
  return f;
}

/** 1280x720 기준 배율. 너무 작은 창에서도 글자가 뭉개지지 않도록 하한을 둔다 */
export function hudScale(width: number, height: number): number {
  const s = Math.min(width / 1280, height / 720);
  return Math.max(0.72, Math.min(2.6, s));
}

/** 깜빡임 (duty = 켜진 비율) */
export function blink(time: number, hz: number, duty = 0.62): boolean {
  const ph = time * hz;
  return ph - Math.floor(ph) < duty;
}
