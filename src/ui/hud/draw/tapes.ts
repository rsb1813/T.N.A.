// 속도 테이프(왼쪽) / 고도 테이프(오른쪽) / 방위 테이프(위) / 스로틀·연료·비행 수치.
import { headingOf } from '../../../core/math';
import { HUD_COLORS, monoFont, blink } from '../style';
import { ALTITUDE_TAPE, SPEED_TAPE, TickBuffer, cardinalLabel, computeHeadingTicks, computeTapeTicks, headingDiff } from '../tape';
import {
  altitudeIn,
  altitudeLabel,
  formatHeading,
  formatThousands,
  formatVerticalSpeed,
  speedIn,
  speedLabel,
  verticalSpeedLabel,
} from '../units';
import type { HudFrame } from '../frame';
import * as THREE from 'three';
import { addLine, addRect, panel, text } from './primitives';

const buf = new TickBuffer();
const _rel = new THREE.Vector3();

/** 숫자 → 문자열 캐시 (테이프 라벨은 같은 값이 반복된다) */
const labelCache = new Map<number, string>();
function intLabel(v: number): string {
  let s = labelCache.get(v);
  if (s === undefined) {
    if (labelCache.size > 2000) labelCache.clear();
    labelCache.set(v, (s = formatThousands(v)));
  }
  return s;
}

/** 테이프 중앙 x 오프셋 (기준 px) */
export const TAPE_OFFSET_X = 268;
export const TAPE_HALF_H = 118;

export function drawSpeedTape(f: HudFrame): void {
  const tel = f.tel;
  const p = f.player;
  if (!tel || !p) return;
  const { ctx, s, cx, cy, units } = f;
  const x = cx - TAPE_OFFSET_X * s;
  const hh = TAPE_HALF_H * s;
  const sc = SPEED_TAPE[units];
  const value = speedIn(tel.ias, units);
  const n = computeTapeTicks(value, sc.halfSpan, sc.minor, sc.major, buf, 0);
  const boxH = 15 * s;

  ctx.beginPath();
  addLine(ctx, x, cy - hh, x, cy + hh);
  for (let i = 0; i < n; i++) {
    const t = buf.ticks[i];
    const y = cy - t.offset * hh;
    addLine(ctx, x - (t.major ? 12 : 6) * s, y, x, y);
  }
  ctx.strokeStyle = HUD_COLORS.main;
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();

  ctx.font = monoFont(12 * s, 500);
  ctx.fillStyle = HUD_COLORS.main;
  for (let i = 0; i < n; i++) {
    const t = buf.ticks[i];
    if (!t.major) continue;
    const y = cy - t.offset * hh;
    if (Math.abs(y - cy) < boxH + 8 * s) continue;
    text(ctx, intLabel(t.value), x - 16 * s, y, 'right');
  }

  // 코너 속도 표식 (에너지 기동 기준)
  const corner = p.stats?.cornerSpeed;
  if (corner && corner > 0) {
    const off = (speedIn(corner, units) - value) / sc.halfSpan;
    if (Math.abs(off) <= 1) {
      const y = cy - off * hh;
      ctx.beginPath();
      ctx.moveTo(x + 1 * s, y);
      ctx.lineTo(x + 8 * s, y - 5 * s);
      ctx.lineTo(x + 8 * s, y + 5 * s);
      ctx.closePath();
      ctx.fillStyle = HUD_COLORS.target;
      ctx.fill();
    }
  }

  // 현재값 상자
  const bw = 76 * s;
  panel(ctx, x - bw - 6 * s, cy - boxH, bw, boxH * 2, HUD_COLORS.panel, null, s);
  ctx.beginPath();
  addRect(ctx, x - bw - 6 * s, cy - boxH, bw, boxH * 2);
  ctx.moveTo(x - 6 * s, cy - 5 * s);
  ctx.lineTo(x, cy);
  ctx.lineTo(x - 6 * s, cy + 5 * s);
  ctx.strokeStyle = HUD_COLORS.main;
  ctx.lineWidth = 1.6 * s;
  ctx.stroke();
  ctx.font = monoFont(18 * s, 700);
  ctx.fillStyle = HUD_COLORS.main;
  text(ctx, intLabel(Math.max(0, Math.round(value))), x - 12 * s, cy + 1 * s, 'right');

  ctx.font = monoFont(11 * s, 500);
  ctx.fillStyle = HUD_COLORS.mainDim;
  text(ctx, `IAS ${speedLabel(units)}`, x - 6 * s, cy - hh - 12 * s, 'right');

  // 아래 수치 열
  const lx = x - 82 * s;
  let ly = cy + hh + 18 * s;
  const lh = 17 * s;
  ctx.font = monoFont(13 * s, 600);
  ctx.fillStyle = HUD_COLORS.main;
  text(ctx, `M ${tel.mach.toFixed(2)}`, lx, ly, 'left');
  ly += lh;
  const gCol = tel.overG ? HUD_COLORS.warn : HUD_COLORS.main;
  ctx.fillStyle = gCol;
  text(ctx, `G ${tel.gLoad.toFixed(1)}`, lx, ly, 'left');
  ctx.font = monoFont(11 * s, 500);
  ctx.fillStyle = HUD_COLORS.mainDim;
  text(ctx, `MAX ${f.maxG.toFixed(1)}`, lx + 58 * s, ly + 1 * s, 'left');
  ly += lh;
  ctx.font = monoFont(13 * s, 600);
  const aoaMax = p.stats?.aoaMaxDeg ?? 30;
  ctx.fillStyle = tel.aoaDeg > aoaMax * 0.92 || tel.stalled ? HUD_COLORS.caution : HUD_COLORS.main;
  text(ctx, `α ${tel.aoaDeg.toFixed(1)}`, lx, ly, 'left');
  if (tel.sweepDeg !== null) {
    ctx.font = monoFont(11 * s, 500);
    ctx.fillStyle = HUD_COLORS.mainDim;
    text(ctx, `SWP ${Math.round(tel.sweepDeg)}°`, lx + 58 * s, ly + 1 * s, 'left');
  }

  drawThrottle(f, x - bw - 26 * s);
}

function drawThrottle(f: HudFrame, x: number): void {
  const tel = f.tel!;
  const { ctx, s, cy } = f;
  const w = 7 * s;
  const h = 96 * s;
  const top = cy - h / 2 + 10 * s;
  const thr = Math.max(0, Math.min(1, tel.throttle));
  ctx.fillStyle = HUD_COLORS.mainFaint;
  ctx.fillRect(x, top, w, h);
  ctx.fillStyle = HUD_COLORS.main;
  ctx.fillRect(x, top + h * (1 - thr), w, h * thr);
  // 애프터버너 칸
  const abTop = top - 15 * s;
  ctx.beginPath();
  addRect(ctx, x, top, w, h);
  addRect(ctx, x, abTop, w, 11 * s);
  ctx.strokeStyle = HUD_COLORS.main;
  ctx.lineWidth = 1.1 * s;
  ctx.stroke();
  if (tel.afterburner) {
    ctx.fillStyle = HUD_COLORS.caution;
    ctx.fillRect(x, abTop, w, 11 * s);
  }
  ctx.font = monoFont(10 * s, 600);
  ctx.fillStyle = tel.afterburner ? HUD_COLORS.caution : HUD_COLORS.mainDim;
  text(ctx, 'AB', x + w / 2, abTop - 8 * s, 'center');
  ctx.fillStyle = HUD_COLORS.mainDim;
  text(ctx, 'THR', x + w / 2, top + h + 10 * s, 'center');
  ctx.fillStyle = HUD_COLORS.main;
  text(ctx, `${Math.round(thr * 100)}`, x + w / 2, top + h + 22 * s, 'center');

  // 연료
  const ff = Math.max(0, tel.fuelFraction);
  const low = f.warnings.bingo;
  ctx.font = monoFont(10 * s, 600);
  ctx.fillStyle = low ? HUD_COLORS.warn : HUD_COLORS.mainDim;
  text(ctx, 'FUEL', x + w / 2, top + h + 40 * s, 'center');
  ctx.font = monoFont(12 * s, 700);
  ctx.fillStyle = low && !blink(f.time, 2) ? HUD_COLORS.warn : low ? HUD_COLORS.caution : HUD_COLORS.main;
  text(ctx, `${Math.round(ff * 100)}%`, x + w / 2, top + h + 53 * s, 'center');
}

export function drawAltitudeTape(f: HudFrame): void {
  const tel = f.tel;
  if (!tel) return;
  const { ctx, s, cx, cy, units } = f;
  const x = cx + TAPE_OFFSET_X * s;
  const hh = TAPE_HALF_H * s;
  const sc = ALTITUDE_TAPE[units];
  const value = altitudeIn(tel.altitude, units);
  const n = computeTapeTicks(value, sc.halfSpan, sc.minor, sc.major, buf);
  const boxH = 15 * s;

  ctx.beginPath();
  addLine(ctx, x, cy - hh, x, cy + hh);
  for (let i = 0; i < n; i++) {
    const t = buf.ticks[i];
    const y = cy - t.offset * hh;
    addLine(ctx, x, y, x + (t.major ? 12 : 6) * s, y);
  }
  ctx.strokeStyle = HUD_COLORS.main;
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();

  // 지면 높이 띠
  const groundAlt = altitudeIn(tel.altitude - tel.agl, units);
  const gOff = (groundAlt - value) / sc.halfSpan;
  if (gOff < 1) {
    const gy = Math.min(cy + hh, cy - gOff * hh);
    const bottom = cy + hh;
    if (gy < bottom) {
      ctx.beginPath();
      for (let yy = gy; yy < bottom; yy += 6 * s) addLine(ctx, x + 1 * s, yy + 6 * s, x + 9 * s, yy);
      addLine(ctx, x, gy, x + 14 * s, gy);
      ctx.strokeStyle = HUD_COLORS.caution;
      ctx.lineWidth = 1.2 * s;
      ctx.stroke();
    }
  }

  ctx.font = monoFont(12 * s, 500);
  ctx.fillStyle = HUD_COLORS.main;
  for (let i = 0; i < n; i++) {
    const t = buf.ticks[i];
    if (!t.major) continue;
    const y = cy - t.offset * hh;
    if (Math.abs(y - cy) < boxH + 8 * s) continue;
    text(ctx, intLabel(t.value), x + 16 * s, y, 'left');
  }

  const bw = 86 * s;
  panel(ctx, x + 6 * s, cy - boxH, bw, boxH * 2, HUD_COLORS.panel, null, s);
  ctx.beginPath();
  addRect(ctx, x + 6 * s, cy - boxH, bw, boxH * 2);
  ctx.moveTo(x + 6 * s, cy - 5 * s);
  ctx.lineTo(x, cy);
  ctx.lineTo(x + 6 * s, cy + 5 * s);
  ctx.strokeStyle = HUD_COLORS.main;
  ctx.lineWidth = 1.6 * s;
  ctx.stroke();
  ctx.font = monoFont(18 * s, 700);
  ctx.fillStyle = HUD_COLORS.main;
  text(ctx, intLabel(Math.round(value / 10) * 10), x + 12 * s + bw - 12 * s, cy + 1 * s, 'right');

  ctx.font = monoFont(11 * s, 500);
  ctx.fillStyle = HUD_COLORS.mainDim;
  text(ctx, `ALT ${altitudeLabel(units)}`, x + 6 * s, cy - hh - 12 * s, 'left');

  const lx = x + 8 * s;
  let ly = cy + hh + 18 * s;
  const lh = 17 * s;
  ctx.font = monoFont(13 * s, 600);
  ctx.fillStyle = HUD_COLORS.main;
  text(ctx, `VS ${formatVerticalSpeed(tel.verticalSpeed, units)}`, lx, ly, 'left');
  ctx.font = monoFont(10 * s, 500);
  ctx.fillStyle = HUD_COLORS.mainDim;
  text(ctx, verticalSpeedLabel(units), lx + 100 * s, ly + 1 * s, 'left');
  ly += lh;
  // 전파 고도: 낮을 때만 (1500 m 이하)
  if (tel.agl < 1500) {
    ctx.font = monoFont(13 * s, 600);
    ctx.fillStyle = tel.agl < 150 ? HUD_COLORS.caution : HUD_COLORS.main;
    text(ctx, `R ${intLabel(Math.round(altitudeIn(Math.max(0, tel.agl), units) / 10) * 10)}`, lx, ly, 'left');
    ly += lh;
  }
}

const HEADING_HALF_DEG = 30;

export function drawHeadingTape(f: HudFrame): void {
  const tel = f.tel;
  const p = f.player;
  if (!tel || !p) return;
  const { ctx, s, cx } = f;
  const halfW = 176 * s;
  const base = 36 * s;
  const n = computeHeadingTicks(tel.headingDeg, HEADING_HALF_DEG, 5, 10, buf);

  ctx.beginPath();
  addLine(ctx, cx - halfW, base, cx + halfW, base);
  for (let i = 0; i < n; i++) {
    const t = buf.ticks[i];
    const x = cx + t.offset * halfW;
    addLine(ctx, x, base, x, base + (t.major ? 9 : 5) * s);
  }
  ctx.strokeStyle = HUD_COLORS.main;
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();

  for (let i = 0; i < n; i++) {
    const t = buf.ticks[i];
    if (!t.major) continue;
    const x = cx + t.offset * halfW;
    if (Math.abs(x - cx) < 26 * s) continue;
    const card = cardinalLabel(t.value);
    ctx.font = card ? monoFont(13 * s, 700) : monoFont(11 * s, 500);
    ctx.fillStyle = card ? HUD_COLORS.main : HUD_COLORS.mainDim;
    text(ctx, card ?? formatHeading(t.value), x, base - 10 * s, 'center');
  }

  // 지정 표적 방위 표식
  const tgt = f.designated;
  if (tgt) {
    _rel.subVectors(tgt.position, p.position);
    const brg = headingOf(_rel);
    const d = headingDiff(tel.headingDeg, brg);
    const col = HUD_COLORS.target;
    ctx.fillStyle = col;
    ctx.beginPath();
    if (Math.abs(d) <= HEADING_HALF_DEG) {
      const x = cx + (d / HEADING_HALF_DEG) * halfW;
      ctx.moveTo(x, base - 1 * s);
      ctx.lineTo(x + 5 * s, base - 7 * s);
      ctx.lineTo(x, base - 13 * s);
      ctx.lineTo(x - 5 * s, base - 7 * s);
      ctx.closePath();
    } else {
      const dir = Math.sign(d);
      const x = cx + dir * (halfW + 4 * s);
      ctx.moveTo(x + dir * 9 * s, base);
      ctx.lineTo(x, base - 6 * s);
      ctx.lineTo(x, base + 6 * s);
      ctx.closePath();
    }
    ctx.fill();
  }

  // 현재 방위 상자
  const bw = 46 * s;
  const by = base + 14 * s;
  panel(ctx, cx - bw / 2, by, bw, 20 * s, HUD_COLORS.panel, null, s);
  ctx.beginPath();
  addRect(ctx, cx - bw / 2, by, bw, 20 * s);
  ctx.moveTo(cx - 5 * s, by);
  ctx.lineTo(cx, base + 9 * s);
  ctx.lineTo(cx + 5 * s, by);
  ctx.strokeStyle = HUD_COLORS.main;
  ctx.lineWidth = 1.5 * s;
  ctx.stroke();
  ctx.font = monoFont(15 * s, 700);
  ctx.fillStyle = HUD_COLORS.main;
  text(ctx, formatHeading(tel.headingDeg), cx, by + 10.5 * s, 'center');
}
