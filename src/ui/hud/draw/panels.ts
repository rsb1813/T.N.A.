// 패널: 무장(오른쪽 아래), 미션(왼쪽 위), 피해(미니맵 옆), 무전 자막(아래 가운데).
import type { MissionState, ObjectiveState } from '../../../core/services';
import type { RadarMode } from '../../../core/contracts';
import { HUD_COLORS, RADIO_SIDE_COLORS, blink, monoFont, sansFont } from '../style';
import { formatClock, formatThousands } from '../units';
import type { RadioQueue, RadioEntry } from '../radioQueue';
import type { HudFrame } from '../frame';
import { addLine, addRect, panel, text } from './primitives';

const RADAR_MODE_LABEL: Record<RadarMode, string> = { off: 'OFF', rws: 'RWS', tws: 'TWS', stt: 'STT', ag: 'A/G' };
const MAX_GROUP_ROWS = 8;

export const MARGIN = 16;

/** 무장 패널: 기관포 탄수, 무장 묶음(선택 강조), 플레어/채프, 레이더 모드, 재머 */
export function drawWeaponPanel(f: HudFrame): void {
  const p = f.player;
  if (!p) return;
  const { ctx, s, W, H, time } = f;
  const st = p.stores;
  const groups = st.groups;
  const rows = Math.min(MAX_GROUP_ROWS, groups.length);
  const pw = 236 * s;
  const rh = 20 * s;
  const pad = 8 * s;
  const ph = pad * 2 + rh * (rows + 1) + 8 * s + 17 * s * 2;
  const x0 = W - MARGIN * s - pw;
  const y0 = H - MARGIN * s - ph;
  panel(ctx, x0, y0, pw, ph, HUD_COLORS.panel, HUD_COLORS.panelEdge, s);

  const lx = x0 + pad + 4 * s;
  const rx = x0 + pw - pad;
  let y = y0 + pad + rh / 2;

  // 기관포
  const gun = st.gun;
  ctx.font = monoFont(13 * s, 700);
  if (gun) {
    const low = gun.rounds < Math.max(1, (p.stats?.gun?.rounds ?? 500) * 0.15);
    if (gun.firing) {
      ctx.fillStyle = HUD_COLORS.mainFaint;
      ctx.fillRect(x0 + 3 * s, y - rh / 2 + 1 * s, pw - 6 * s, rh - 2 * s);
    }
    ctx.fillStyle = HUD_COLORS.main;
    text(ctx, 'GUN', lx, y, 'left');
    ctx.font = monoFont(11 * s, 500);
    ctx.fillStyle = HUD_COLORS.mainDim;
    text(ctx, gun.def.id, lx + 40 * s, y + 1 * s, 'left');
    ctx.font = monoFont(14 * s, 700);
    ctx.fillStyle = gun.rounds <= 0 ? HUD_COLORS.warn : low ? HUD_COLORS.caution : HUD_COLORS.main;
    text(ctx, `${gun.rounds}`, rx, y, 'right');
  } else {
    ctx.fillStyle = HUD_COLORS.mainDim;
    text(ctx, 'GUN ---', lx, y, 'left');
  }
  y += rh;

  // 무장 묶음
  if (rows === 0) {
    ctx.font = sansFont(12 * s, 600);
    ctx.fillStyle = HUD_COLORS.mainDim;
    text(ctx, '장착 무장 없음', lx, y, 'left');
  }
  for (let i = 0; i < rows; i++) {
    const g = groups[i];
    const sel = i === st.selected;
    const empty = g.count <= 0;
    if (sel) {
      ctx.fillStyle = empty ? HUD_COLORS.caution : HUD_COLORS.main;
      ctx.fillRect(x0 + 3 * s, y - rh / 2 + 1 * s, pw - 6 * s, rh - 2 * s);
    }
    const col = sel ? HUD_COLORS.inverse : empty ? HUD_COLORS.textDim : HUD_COLORS.main;
    ctx.fillStyle = col;
    ctx.font = monoFont(sel ? 14 * s : 13 * s, sel ? 800 : 600);
    text(ctx, sel ? '▶' : ' ', lx - 2 * s, y, 'left');
    const label = f.metrics.truncate(ctx, ctx.font, g.def.id, pw - 92 * s);
    text(ctx, label, lx + 14 * s, y, 'left');
    ctx.font = monoFont(14 * s, 800);
    text(ctx, `×${g.count}`, rx, y, 'right');
    y += rh;
  }

  // 구분선
  y += 2 * s;
  ctx.beginPath();
  addLine(ctx, x0 + pad, y - rh / 2 + 4 * s, x0 + pw - pad, y - rh / 2 + 4 * s);
  ctx.strokeStyle = HUD_COLORS.panelEdge;
  ctx.lineWidth = 1 * s;
  ctx.stroke();
  y += 6 * s;

  const lh = 17 * s;
  ctx.font = monoFont(12 * s, 600);
  ctx.fillStyle = st.flares <= 0 ? HUD_COLORS.warn : st.flares < 6 ? HUD_COLORS.caution : HUD_COLORS.main;
  text(ctx, `FLR ${st.flares}`, lx, y, 'left');
  ctx.fillStyle = st.chaff <= 0 ? HUD_COLORS.warn : st.chaff < 6 ? HUD_COLORS.caution : HUD_COLORS.main;
  text(ctx, `CHF ${st.chaff}`, lx + 86 * s, y, 'left');
  y += lh;

  const av = p.avionics;
  const hasRadar = !!p.stats?.radar;
  ctx.fillStyle = !hasRadar || av.radarMode === 'off' ? HUD_COLORS.mainDim : HUD_COLORS.main;
  text(ctx, `RDR ${hasRadar ? RADAR_MODE_LABEL[av.radarMode] : '---'}`, lx, y, 'left');
  const hasEw = !!p.stats?.ew;
  if (!hasEw) {
    ctx.fillStyle = HUD_COLORS.mainDim;
    text(ctx, 'JAM ---', lx + 86 * s, y, 'left');
  } else if (av.jammerActive) {
    ctx.fillStyle = blink(time, 1, 0.85) ? HUD_COLORS.caution : HUD_COLORS.mainDim;
    text(ctx, 'JAM ON', lx + 86 * s, y, 'left');
  } else {
    ctx.fillStyle = HUD_COLORS.mainDim;
    text(ctx, 'JAM STBY', lx + 86 * s, y, 'left');
  }
}

/** 미션 패널: 제목, 시간, 점수, 목표 목록 */
export function drawMissionPanel(f: HudFrame, state: MissionState | null, changed: ReadonlyMap<string, number>): void {
  if (!state) return;
  const { ctx, s, time } = f;
  const x0 = MARGIN * s;
  const y0 = MARGIN * s;
  const pw = 312 * s;
  const pad = 9 * s;
  const rowH = 18 * s;
  let visible = 0;
  for (const o of state.objectives) if (o.status !== 'hidden') visible++;
  const rows = Math.min(6, visible);
  const ph = pad * 2 + 20 * s + 18 * s + (rows > 0 ? 6 * s + rows * rowH : 0);
  panel(ctx, x0, y0, pw, ph, HUD_COLORS.panel, HUD_COLORS.panelEdge, s);

  const lx = x0 + pad + 4 * s;
  const rx = x0 + pw - pad;
  let y = y0 + pad + 9 * s;
  ctx.font = sansFont(14 * s, 800);
  ctx.fillStyle = HUD_COLORS.text;
  const timeStr = state.timeLeft !== null ? formatClock(state.timeLeft) : formatClock(state.elapsed);
  ctx.font = monoFont(15 * s, 700);
  const timeLow = state.timeLeft !== null && state.timeLeft < 60;
  ctx.fillStyle = timeLow ? (blink(time, 2) ? HUD_COLORS.warn : HUD_COLORS.caution) : HUD_COLORS.main;
  text(ctx, timeStr, rx, y, 'right');
  const timeW = f.metrics.width(ctx, ctx.font, timeStr);
  ctx.font = sansFont(14 * s, 800);
  ctx.fillStyle = HUD_COLORS.text;
  text(ctx, f.metrics.truncate(ctx, ctx.font, state.title, pw - pad * 2 - timeW - 60 * s), lx, y, 'left');
  ctx.font = sansFont(10 * s, 600);
  ctx.fillStyle = HUD_COLORS.mainDim;
  text(ctx, state.timeLeft !== null ? '남은 시간' : '경과', rx - timeW - 6 * s, y + 1 * s, 'right');
  y += 20 * s;

  ctx.font = sansFont(11 * s, 600);
  ctx.fillStyle = HUD_COLORS.mainDim;
  text(ctx, '점수', lx, y, 'left');
  ctx.font = monoFont(14 * s, 800);
  ctx.fillStyle = HUD_COLORS.target;
  text(ctx, formatThousands(state.score), lx + 30 * s, y, 'left');
  ctx.font = sansFont(11 * s, 600);
  ctx.fillStyle = HUD_COLORS.mainDim;
  text(ctx, '격추', rx - 34 * s, y, 'right');
  ctx.font = monoFont(14 * s, 800);
  ctx.fillStyle = HUD_COLORS.main;
  text(ctx, `${state.kills}`, rx, y, 'right');
  y += 18 * s;

  if (rows === 0) return;
  y += 2 * s;
  ctx.beginPath();
  addLine(ctx, x0 + pad, y - 6 * s, x0 + pw - pad, y - 6 * s);
  ctx.strokeStyle = HUD_COLORS.panelEdge;
  ctx.lineWidth = 1 * s;
  ctx.stroke();
  y += 6 * s;
  let drawn = 0;
  for (const o of state.objectives) {
    if (o.status === 'hidden') continue;
    if (drawn >= rows) break;
    drawObjective(f, o, lx, rx, y, rowH, changed.get(o.id));
    y += rowH;
    drawn++;
  }
}

function drawObjective(f: HudFrame, o: ObjectiveState, lx: number, rx: number, y: number, rowH: number, changedAt: number | undefined): void {
  const { ctx, s, time } = f;
  const flash = changedAt !== undefined && time - changedAt < 2;
  if (flash && blink(time, 4, 0.5)) {
    ctx.fillStyle = HUD_COLORS.mainFaint;
    ctx.fillRect(lx - 6 * s, y - rowH / 2 + 1 * s, rx - lx + 10 * s, rowH - 2 * s);
  }
  const col = o.status === 'failed' ? HUD_COLORS.warn : o.status === 'complete' ? HUD_COLORS.mainDim : o.primary ? HUD_COLORS.main : HUD_COLORS.friendly;
  const k = 4.5 * s;
  const ix = lx + k;
  ctx.beginPath();
  if (o.status === 'complete') {
    ctx.moveTo(ix - k, y);
    ctx.lineTo(ix - 1 * s, y + k);
    ctx.lineTo(ix + k + 1 * s, y - k);
  } else if (o.status === 'failed') {
    addLine(ctx, ix - k, y - k, ix + k, y + k);
    addLine(ctx, ix + k, y - k, ix - k, y + k);
  } else {
    addRect(ctx, ix - k, y - k, k * 2, k * 2);
  }
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.6 * s;
  ctx.stroke();

  let prog = '';
  if (o.progress && o.progress.total > 1) prog = `${o.progress.current}/${o.progress.total}`;
  ctx.font = monoFont(12 * s, 700);
  ctx.fillStyle = col;
  if (prog) text(ctx, prog, rx, y, 'right');
  const progW = prog ? f.metrics.width(ctx, ctx.font, prog) + 8 * s : 0;
  ctx.font = sansFont(12 * s, o.primary ? 600 : 500);
  const label = o.primary ? o.text : `(보조) ${o.text}`;
  text(ctx, f.metrics.truncate(ctx, ctx.font, label, rx - lx - 16 * s - progW), lx + 16 * s, y, 'left');
}

/** 피해 패널: 기체 손상률 + 부위(엔진/날개/조종) + 연료 누출/화재 */
export function drawDamagePanel(f: HudFrame, x0: number, bottom: number): void {
  const p = f.player;
  if (!p) return;
  const { ctx, s, time } = f;
  const dmg = p.maxHp > 0 ? Math.max(0, Math.min(1, 1 - p.hp / p.maxHp)) : 0;
  const ds = p.damageState;
  const extra = (ds.fuelLeak ? 1 : 0) + (ds.onFire ? 1 : 0);
  const rowH = 15 * s;
  const pw = 128 * s;
  const ph = 10 * s + 22 * s + rowH * 3 + extra * rowH + 6 * s;
  const y0 = bottom - ph;
  panel(ctx, x0, y0, pw, ph, HUD_COLORS.panel, HUD_COLORS.panelEdge, s);
  const lx = x0 + 10 * s;
  let y = y0 + 8 * s + 10 * s;
  const dcol = dmg >= 0.7 ? HUD_COLORS.warn : dmg >= 0.35 ? HUD_COLORS.caution : HUD_COLORS.main;
  ctx.font = sansFont(11 * s, 600);
  ctx.fillStyle = HUD_COLORS.mainDim;
  text(ctx, '손상', lx, y, 'left');
  ctx.font = monoFont(17 * s, 800);
  ctx.fillStyle = dmg >= 0.7 && !blink(time, 2) ? HUD_COLORS.caution : dcol;
  text(ctx, `${Math.round(dmg * 100)}%`, x0 + pw - 10 * s, y, 'right');
  y += 22 * s;
  componentRow(f, '엔진', ds.engine, lx, x0 + pw - 10 * s, y);
  y += rowH;
  componentRow(f, '날개', ds.wings, lx, x0 + pw - 10 * s, y);
  y += rowH;
  componentRow(f, '조종', ds.control, lx, x0 + pw - 10 * s, y);
  y += rowH;
  const on = blink(time, 2.5, 0.65);
  ctx.font = sansFont(11 * s, 800);
  if (ds.fuelLeak) {
    ctx.fillStyle = on ? HUD_COLORS.caution : HUD_COLORS.mainDim;
    text(ctx, '연료 누출', lx, y, 'left');
    y += rowH;
  }
  if (ds.onFire) {
    ctx.fillStyle = on ? HUD_COLORS.warn : HUD_COLORS.mainDim;
    text(ctx, '화재 발생', lx, y, 'left');
  }
}

function componentRow(f: HudFrame, label: string, v: number, lx: number, rx: number, y: number): void {
  const { ctx, s } = f;
  const val = Math.max(0, Math.min(1, v));
  const col = val >= 0.7 ? HUD_COLORS.warn : val >= 0.3 ? HUD_COLORS.caution : HUD_COLORS.main;
  ctx.font = sansFont(10 * s, 600);
  ctx.fillStyle = HUD_COLORS.mainDim;
  text(ctx, label, lx, y, 'left');
  const bx = lx + 32 * s;
  const bw = rx - bx;
  const bh = 5 * s;
  ctx.fillStyle = HUD_COLORS.mainFaint;
  ctx.fillRect(bx, y - bh / 2, bw, bh);
  // 남은 건전성 비율로 채운다
  ctx.fillStyle = col;
  ctx.fillRect(bx, y - bh / 2, bw * (1 - val), bh);
}

export interface RadioLayoutCache {
  entry: RadioEntry | null;
  width: number;
  lines: string[];
}

export function createRadioLayout(): RadioLayoutCache {
  return { entry: null, width: 0, lines: [] };
}

/** 무전 자막: 화자(진영 색) + 본문 (줄바꿈 캐시) */
export function drawRadio(f: HudFrame, radio: RadioQueue, cache: RadioLayoutCache, leftLimit: number, rightLimit: number): void {
  const cur = radio.current;
  if (!cur) return;
  const a = radio.alpha(f.time);
  if (a <= 0) return;
  const { ctx, s, cx, H } = f;
  const halfAvail = Math.max(120 * s, Math.min(cx - leftLimit, rightLimit - cx) - 12 * s);
  const maxW = Math.min(620 * s, halfAvail * 2);
  const bodyFont = sansFont(15 * s, 500);
  if (cache.entry !== cur || Math.abs(cache.width - maxW) > 0.5) {
    cache.entry = cur;
    cache.width = maxW;
    cache.lines = f.metrics.wrap(ctx, bodyFont, cur.text, maxW - 28 * s, 3);
  }
  const lines = cache.lines;
  const lh = 20 * s;
  const ph = 14 * s + 18 * s + lines.length * lh + 6 * s;
  const y0 = H - MARGIN * s - ph - 4 * s;
  let w = 0;
  for (const l of lines) w = Math.max(w, f.metrics.width(ctx, bodyFont, l));
  const speakerFont = monoFont(12 * s, 700);
  w = Math.max(w, f.metrics.width(ctx, speakerFont, cur.speaker) + 20 * s);
  const pw = Math.min(maxW, w + 28 * s);
  const x0 = cx - pw / 2;
  ctx.globalAlpha = a;
  const sideCol = RADIO_SIDE_COLORS[cur.side];
  panel(ctx, x0, y0, pw, ph, 'rgba(2, 8, 6, 0.62)', sideCol, s);
  ctx.font = speakerFont;
  ctx.fillStyle = sideCol;
  text(ctx, cur.speaker, x0 + 14 * s, y0 + 7 * s + 9 * s, 'left');
  ctx.font = bodyFont;
  ctx.fillStyle = HUD_COLORS.text;
  let y = y0 + 7 * s + 18 * s + lh / 2 + 2 * s;
  for (const l of lines) {
    text(ctx, l, x0 + 14 * s, y, 'left');
    y += lh;
  }
  // 대기 중 메시지 수
  if (radio.queue.length > 0) {
    ctx.font = monoFont(10 * s, 600);
    ctx.fillStyle = HUD_COLORS.textDim;
    text(ctx, `+${radio.queue.length}`, x0 + pw - 10 * s, y0 + 7 * s + 9 * s, 'right');
  }
  ctx.globalAlpha = 1;
}
