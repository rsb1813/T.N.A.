// 캔버스 그리기 도우미. 경로를 쌓기만 하는 함수(add*)와 바로 그리는 함수로 나눈다.

export type Ctx = CanvasRenderingContext2D;

export function addLine(ctx: Ctx, x1: number, y1: number, x2: number, y2: number): void {
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
}

export function addRect(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.rect(x, y, w, h);
}

export function addCircle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

export function addDiamond(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

/** 함정 기호: 아래가 납작한 오각형 */
export function addShip(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.moveTo(x - r, y - r * 0.2);
  ctx.lineTo(x, y - r);
  ctx.lineTo(x + r, y - r * 0.2);
  ctx.lineTo(x + r * 0.7, y + r * 0.6);
  ctx.lineTo(x - r * 0.7, y + r * 0.6);
  ctx.closePath();
}

/** 네 모서리 브래킷 (반폭 hw, 반높이 hh, 모서리 길이 len) */
export function addBrackets(ctx: Ctx, x: number, y: number, hw: number, hh: number, len: number): void {
  const l = Math.min(len, hw, hh);
  ctx.moveTo(x - hw, y - hh + l);
  ctx.lineTo(x - hw, y - hh);
  ctx.lineTo(x - hw + l, y - hh);
  ctx.moveTo(x + hw - l, y - hh);
  ctx.lineTo(x + hw, y - hh);
  ctx.lineTo(x + hw, y - hh + l);
  ctx.moveTo(x + hw, y + hh - l);
  ctx.lineTo(x + hw, y + hh);
  ctx.lineTo(x + hw - l, y + hh);
  ctx.moveTo(x - hw + l, y + hh);
  ctx.lineTo(x - hw, y + hh);
  ctx.lineTo(x - hw, y + hh - l);
}

/** (x, y) 끝점에서 angle 방향을 가리키는 채운 삼각형 화살표 */
export function addArrowHead(ctx: Ctx, x: number, y: number, angle: number, len: number, halfWidth: number): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const bx = x - c * len;
  const by = y - s * len;
  ctx.moveTo(x, y);
  ctx.lineTo(bx - s * halfWidth, by + c * halfWidth);
  ctx.lineTo(bx + s * halfWidth, by - c * halfWidth);
  ctx.closePath();
}

export function addRoundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** 반투명 패널 배경 + 왼쪽 강조선 */
export function panel(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, edge: string | null, s: number): void {
  ctx.beginPath();
  addRoundRect(ctx, x, y, w, h, 3 * s);
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge) {
    ctx.fillStyle = edge;
    ctx.fillRect(x, y + 2 * s, 2 * s, h - 4 * s);
  }
}

export function text(ctx: Ctx, str: string, x: number, y: number, align: CanvasTextAlign, baseline: CanvasTextBaseline = 'middle'): void {
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(str, x, y);
}

/** measureText 결과 캐시 (font|text → 폭). 크기 제한으로 오래된 항목 비움 */
export class TextMetricsCache {
  private map = new Map<string, number>();
  constructor(private readonly limit = 600) {}

  width(ctx: Ctx, font: string, str: string): number {
    const key = font + '\u0000' + str;
    let w = this.map.get(key);
    if (w === undefined) {
      if (this.map.size >= this.limit) this.map.clear();
      const prev = ctx.font;
      ctx.font = font;
      w = ctx.measureText(str).width;
      ctx.font = prev;
      this.map.set(key, w);
    }
    return w;
  }

  /** 폭 제한에 맞게 말줄임 */
  truncate(ctx: Ctx, font: string, str: string, maxWidth: number): string {
    if (this.width(ctx, font, str) <= maxWidth) return str;
    let lo = 0;
    let hi = str.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.width(ctx, font, str.slice(0, mid) + '…') <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return str.slice(0, lo) + '…';
  }

  /** 단어(공백) 단위 줄바꿈, 단어가 너무 길면 글자 단위. 한국어 공백 기준 */
  wrap(ctx: Ctx, font: string, str: string, maxWidth: number, maxLines: number): string[] {
    const lines: string[] = [];
    const words = str.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (this.width(ctx, font, cand) <= maxWidth) {
        line = cand;
        continue;
      }
      if (line) lines.push(line);
      if (this.width(ctx, font, w) <= maxWidth) {
        line = w;
      } else {
        let chunk = '';
        for (const ch of w) {
          if (this.width(ctx, font, chunk + ch) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else chunk += ch;
        }
        line = chunk;
      }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = this.truncate(ctx, font, `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, maxWidth);
      return kept;
    }
    return lines;
  }

  clear(): void {
    this.map.clear();
  }
}
