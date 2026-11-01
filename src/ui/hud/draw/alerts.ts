// DLZ 막대, 미사일 경보(배너·방향 화살표·MAW 충돌시간), 비행 경고, 전과 알림, 미션 알림/종료 배너, 피격 섬광.
import type { Threat } from '../../../core/contracts';
import { HUD_COLORS, blink, monoFont, sansFont } from '../style';
import { computeDlz, makeDlzGeometry } from '../dlz';
import { bearingToCanvasAngle } from '../projection';
import { distanceIn, formatRange, metersPerDistanceUnit } from '../units';
import { FEED_LIFETIME, type EventFeed } from '../feed';
import type { HudFrame } from '../frame';
import { TAPE_HALF_H, TAPE_OFFSET_X } from './tapes';
import { addArrowHead, addLine, addRect, panel, text } from './primitives';

const _dlz = makeDlzGeometry();

/** 선택 무장의 DLZ: 고도 테이프 오른쪽 세로 막대 (Rmin / Rne / Rmax + 현재 거리 캐럿) */
export function drawDlz(f: HudFrame): void {
  const p = f.player;
  const def = f.selected;
  if (!p || !def) return;
  const target = f.lock.target ?? f.designated?.entity ?? null;
  if (!target) return;
  const zone = p.stores.launchZone(target, f.sim);
  if (!zone || !(zone.rMax > 0)) return;
  const { ctx, s, cx, cy, units } = f;
  computeDlz(zone, metersPerDistanceUnit(units), _dlz);
  // 고도 상자(오른쪽 끝 = TAPE_OFFSET_X + 92) 와 캐럿 거리 글자가 겹치지 않는 위치
  const x = cx + (TAPE_OFFSET_X + 142) * s;
  const len = TAPE_HALF_H * 1.7 * s;
  const bottom = cy + len / 2;
  const yOf = (fr: number): number => bottom - fr * len;
  const w = 6 * s;

  // 축과 눈금 (0, 꼭대기)
  ctx.beginPath();
  addLine(ctx, x, bottom, x, yOf(1));
  addLine(ctx, x - 4 * s, bottom, x + w + 4 * s, bottom);
  addLine(ctx, x - 4 * s, yOf(1), x + w + 4 * s, yOf(1));
  ctx.strokeStyle = HUD_COLORS.mainDim;
  ctx.lineWidth = 1.2 * s;
  ctx.stroke();

  // Rmin..Rmax 막대 (테두리) + NEZ 구간 채움
  const yMax = yOf(_dlz.fMax);
  const yMin = yOf(_dlz.fMin);
  const yNez = yOf(_dlz.fNez);
  ctx.fillStyle = HUD_COLORS.mainFaint;
  ctx.fillRect(x, yMax, w, yMin - yMax);
  ctx.fillStyle = _dlz.state === 'nez' ? HUD_COLORS.warn : HUD_COLORS.main;
  ctx.fillRect(x, yNez, w, yMin - yNez);
  ctx.beginPath();
  addRect(ctx, x, yMax, w, yMin - yMax);
  ctx.strokeStyle = HUD_COLORS.main;
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();

  ctx.font = monoFont(10 * s, 600);
  ctx.fillStyle = HUD_COLORS.mainDim;
  const lx = x + w + 6 * s;
  text(ctx, `${Math.round(distanceIn(_dlz.scaleMax, units))}`, lx, yOf(1), 'left');
  ctx.fillStyle = HUD_COLORS.main;
  text(ctx, 'MAX', lx, yMax, 'left');
  if (yNez < yMin - 10 * s && yMax < yNez - 10 * s) text(ctx, 'NEZ', lx, yNez, 'left');
  if (yMin < bottom - 10 * s) text(ctx, 'MIN', lx, yMin, 'left');

  // 현재 거리 캐럿 (왼쪽)
  const yr = yOf(_dlz.fRange);
  const col =
    _dlz.state === 'nez' ? HUD_COLORS.warn : _dlz.state === 'inRange' ? HUD_COLORS.main : _dlz.state === 'tooClose' ? HUD_COLORS.caution : HUD_COLORS.text;
  ctx.beginPath();
  ctx.moveTo(x - 2 * s, yr);
  ctx.lineTo(x - 11 * s, yr - 6 * s);
  ctx.lineTo(x - 11 * s, yr + 6 * s);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  if (_dlz.clamped) {
    ctx.beginPath();
    addArrowHead(ctx, x - 6 * s, yr - 12 * s, -Math.PI / 2, 6 * s, 4 * s);
    ctx.fill();
  }
  ctx.font = monoFont(11 * s, 700);
  text(ctx, formatRange(zone.range, units), x - 14 * s, yr, 'right');

  // 상태 문구 (막대 아래)
  ctx.font = monoFont(11 * s, 800);
  const stateText = _dlz.state === 'nez' ? 'NEZ' : _dlz.state === 'inRange' ? 'IN RNG' : _dlz.state === 'tooClose' ? 'MIN RNG' : '';
  if (stateText && (_dlz.state !== 'nez' || blink(f.time, 2.5, 0.7))) text(ctx, stateText, x + w / 2, bottom + 13 * s, 'center');
  ctx.font = monoFont(10 * s, 600);
  ctx.fillStyle = HUD_COLORS.mainDim;
  text(ctx, def.id, x + w / 2, yOf(1) - 13 * s, 'center');
}

/** 미사일 경보 배너 + 위협 화살표 + RWR 락 경고 */
export function drawThreatWarnings(f: HudFrame): void {
  const p = f.player;
  if (!p) return;
  const { ctx, s, cx, cy, time } = f;
  const threats = p.avionics.threats;
  const missile = f.missileThreats > 0 || p.avionics.missileWarning;
  if (missile) {
    const on = blink(time, 3.2, 0.68);
    const bw = 206 * s;
    const bh = 54 * s;
    const by = 84 * s;
    panel(ctx, cx - bw / 2, by, bw, bh, on ? 'rgba(70, 0, 0, 0.62)' : 'rgba(30, 0, 0, 0.45)', null, s);
    ctx.beginPath();
    addRect(ctx, cx - bw / 2, by, bw, bh);
    ctx.strokeStyle = HUD_COLORS.warn;
    ctx.lineWidth = (on ? 2.4 : 1.2) * s;
    ctx.stroke();
    if (on) {
      ctx.font = monoFont(26 * s, 800);
      ctx.fillStyle = HUD_COLORS.warn;
      text(ctx, f.missileThreats > 1 ? `MISSILE ×${f.missileThreats}` : 'MISSILE', cx, by + 20 * s, 'center');
    }
    ctx.font = sansFont(12.5 * s, 700);
    ctx.fillStyle = '#ffd0d0';
    text(ctx, '미사일 접근 — 회피하라', cx, by + 42 * s, 'center');
  } else if (f.lockThreats > 0) {
    const bw = 150 * s;
    const bh = 42 * s;
    const by = 88 * s;
    panel(ctx, cx - bw / 2, by, bw, bh, 'rgba(40, 24, 0, 0.5)', null, s);
    if (blink(time, 1.6, 0.7)) {
      ctx.font = monoFont(18 * s, 800);
      ctx.fillStyle = HUD_COLORS.caution;
      text(ctx, 'WARNING', cx, by + 15 * s, 'center');
    }
    ctx.font = sansFont(12 * s, 700);
    ctx.fillStyle = '#ffe2b0';
    text(ctx, '적 레이더 락온', cx, by + 32 * s, 'center');
  }

  if (!f.sim.settings.assists.threatArrows) return;
  // 기수 기준 방위로 중앙 주변 화살표 (위 = 정면)
  const R = 112 * s;
  for (let i = 0; i < threats.length; i++) {
    const t = threats[i];
    if (t.kind !== 'missile' && t.kind !== 'launch') continue;
    drawThreatArrow(f, t, R, cx, cy);
  }
}

function drawThreatArrow(f: HudFrame, t: Threat, R: number, cx: number, cy: number): void {
  const { ctx, s, time } = f;
  const a = bearingToCanvasAngle(t.bearingDeg);
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const imminent = t.timeToImpact !== null && t.timeToImpact < 4;
  const x = cx + c * R;
  const y = cy + sn * R;
  const len = (imminent ? 26 : 20) * s;
  ctx.beginPath();
  addArrowHead(ctx, x + c * len, y + sn * len, a, len, (imminent ? 11 : 8) * s);
  ctx.fillStyle = HUD_COLORS.warn;
  ctx.globalAlpha = imminent && !blink(time, 6, 0.6) ? 0.45 : 1;
  ctx.fill();
  ctx.globalAlpha = 1;
  // 상하 표시 (고각)
  if (Math.abs(t.elevationDeg) > 15) {
    ctx.font = monoFont(10 * s, 700);
    ctx.fillStyle = HUD_COLORS.warn;
    text(ctx, t.elevationDeg > 0 ? '▲' : '▼', x - c * 10 * s, y - sn * 10 * s, 'center');
  }
  if (t.timeToImpact !== null && t.timeToImpact >= 0) {
    ctx.font = monoFont(12 * s, 800);
    ctx.fillStyle = HUD_COLORS.warn;
    text(ctx, t.timeToImpact.toFixed(1), x + c * (len + 16 * s), y + sn * (len + 12 * s), 'center');
  }
}

interface WarnLine {
  text: string;
  sub: string;
  color: string;
  big: boolean;
}

const _lines: WarnLine[] = [];
for (let i = 0; i < 6; i++) _lines.push({ text: '', sub: '', color: '', big: false });

/** STALL / OVER-G / PULL UP / BINGO FUEL / 작전 구역 이탈 — 보어사이트 위쪽 (추적 시점에서 기체에 가리지 않게) */
export function drawFlightWarnings(f: HudFrame): void {
  const w = f.warnings;
  let n = 0;
  const add = (t: string, sub: string, color: string, big: boolean): void => {
    const l = _lines[n++];
    l.text = t;
    l.sub = sub;
    l.color = color;
    l.big = big;
  };
  if (w.pullUp) add('PULL UP', '기수 올려', HUD_COLORS.warn, true);
  if (w.stall) add('STALL', '실속', HUD_COLORS.warn, true);
  if (w.overG) add('OVER-G', '과하중', HUD_COLORS.warn, false);
  if (w.outOfArea) add('작전 구역 이탈', 'RETURN TO AO', HUD_COLORS.warn, false);
  else if (w.nearBoundary) add('작전 구역 경계', 'BOUNDARY', HUD_COLORS.caution, false);
  if (w.bingo) add('BINGO FUEL', '연료 부족', HUD_COLORS.caution, false);
  if (n === 0) return;
  const { ctx, s, cx, cy, time } = f;
  let y = cy - 52 * s;
  const on = blink(time, 2.4, 0.7);
  for (let i = 0; i < n && i < 3; i++) {
    const l = _lines[i];
    const size = l.big ? 22 : 16;
    const ty = y - (size / 2 + 8) * s;
    if (on || l.color !== HUD_COLORS.warn) {
      ctx.font = l.text.charCodeAt(0) > 0x3000 ? sansFont(size * s, 800) : monoFont(size * s, 800);
      ctx.fillStyle = l.color;
      text(ctx, l.text, cx, ty, 'center');
    }
    ctx.font = l.sub.charCodeAt(0) > 0x3000 ? sansFont(11 * s, 700) : monoFont(10 * s, 700);
    ctx.fillStyle = l.color;
    text(ctx, l.sub, cx, y, 'center');
    y -= (size + 20) * s;
  }
}

/** HIT / MISSED / 격파 DESTROYED — 보어사이트 오른쪽 위, 최신이 아래 */
export function drawEventFeed(f: HudFrame, feed: EventFeed): void {
  if (!feed.items.length) return;
  const { ctx, s, cx, cy, time } = f;
  const x0 = cx + 58 * s;
  let y = cy - 34 * s;
  for (let i = 0; i < feed.items.length && i < 3; i++) {
    const it = feed.items[i];
    const age = time - it.time;
    const a = age < 0.1 ? age / 0.1 : Math.max(0, 1 - Math.max(0, age - FEED_LIFETIME * 0.65) / (FEED_LIFETIME * 0.35));
    if (a <= 0) continue;
    ctx.globalAlpha = a * (i === 0 ? 1 : 0.7);
    const pop = i === 0 && age < 0.2 ? 1 + (0.2 - age) * 1.2 : 1;
    if (it.kind === 'kill') {
      const kf = sansFont(19 * s * pop, 800);
      ctx.font = kf;
      ctx.fillStyle = HUD_COLORS.hostile;
      text(ctx, '격파', x0, y, 'left');
      ctx.font = monoFont(19 * s * pop, 800);
      text(ctx, 'DESTROYED', x0 + f.metrics.width(ctx, kf, '격파') + 7 * s, y, 'left');
      if (it.sub) {
        ctx.font = sansFont(11 * s, 600);
        ctx.fillStyle = HUD_COLORS.text;
        text(ctx, it.sub, x0, y + 17 * s, 'left');
      }
      y -= 44 * s;
    } else {
      ctx.font = monoFont(17 * s * pop, 800);
      ctx.fillStyle = it.kind === 'hit' ? HUD_COLORS.target : HUD_COLORS.neutral;
      text(ctx, it.count > 1 && it.kind === 'hit' ? `${it.text} ×${it.count}` : it.text, x0, y, 'left');
      y -= 26 * s;
    }
  }
  ctx.globalAlpha = 1;
}

export interface NoticeState {
  text: string;
  sub: string;
  color: string;
  time: number;
  duration: number;
}

/** 목표 갱신 알림 (MISSILE 배너 아래) */
export function drawNotice(f: HudFrame, n: NoticeState | null): void {
  if (!n) return;
  const age = f.time - n.time;
  if (age > n.duration) return;
  const { ctx, s, cx } = f;
  const a = age < 0.2 ? age / 0.2 : Math.min(1, (n.duration - age) / 0.5);
  ctx.globalAlpha = Math.max(0, a);
  const y = 168 * s;
  ctx.font = sansFont(15 * s, 800);
  ctx.fillStyle = n.color;
  text(ctx, n.text, cx, y, 'center');
  if (n.sub) {
    ctx.font = sansFont(12 * s, 500);
    ctx.fillStyle = HUD_COLORS.text;
    text(ctx, f.metrics.truncate(ctx, ctx.font, n.sub, 520 * s), cx, y + 19 * s, 'center');
  }
  ctx.globalAlpha = 1;
}

export interface MissionEndState {
  result: 'success' | 'failure';
  reason: string;
  time: number;
}

/** 임무 완료/실패 큰 배너 */
export function drawMissionEnd(f: HudFrame, m: MissionEndState | null): void {
  if (!m) return;
  const age = f.time - m.time;
  const { ctx, s, cx, cy, W } = f;
  const a = Math.min(1, age / 0.4);
  ctx.globalAlpha = a;
  const ok = m.result === 'success';
  const col = ok ? HUD_COLORS.target : HUD_COLORS.warn;
  const y = cy - 30 * s;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, y - 40 * s, W, 92 * s);
  ctx.fillStyle = col;
  ctx.fillRect(0, y - 40 * s, W, 2 * s);
  ctx.fillRect(0, y + 50 * s, W, 2 * s);
  ctx.font = sansFont(34 * s, 800);
  text(ctx, ok ? '임무 완료' : '임무 실패', cx, y - 2 * s, 'center');
  ctx.font = monoFont(13 * s, 700);
  text(ctx, ok ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED', cx, y + 26 * s, 'center');
  if (m.reason) {
    ctx.font = sansFont(12 * s, 500);
    ctx.fillStyle = HUD_COLORS.text;
    text(ctx, m.reason, cx, y + 42 * s, 'center');
  }
  ctx.globalAlpha = 1;
}

/** 피격 시 화면 가장자리 붉은 섬광 */
export function drawDamageFlash(f: HudFrame, gradient: CanvasGradient | null, hitTime: number): void {
  if (!gradient) return;
  const age = f.time - hitTime;
  if (age < 0 || age > 0.6) return;
  const { ctx, W, H } = f;
  ctx.globalAlpha = (1 - age / 0.6) * 0.8;
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
}
