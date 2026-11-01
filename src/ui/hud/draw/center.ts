// 중앙 조준부: 보어사이트, 비행경로 표시기(FPM), 피치 래더(±90°, 수평선 아래 점선), 롤 눈금, 마우스 에임 조준원.
// 피치 래더는 카메라로 투영한 실제 방향이라 추적/조종석 시점 모두 실제 수평선과 일치한다.
import * as THREE from 'three';
import { DEG } from '../../../core/math';
import { HUD_COLORS, monoFont } from '../style';
import { makeScreenPoint } from '../projection';
import type { HudFrame } from '../frame';
import { addArrowHead, addCircle, addLine, text } from './primitives';

const _a = makeScreenPoint();
const _b = makeScreenPoint();
const _d = new THREE.Vector3();

const LADDER_STEP = 5;
const LADDER_MAX = 85;

export function drawBoresight(f: HudFrame): void {
  if (!f.boreOk) return;
  const { ctx, s } = f;
  const x = f.bore.x;
  const y = f.bore.y;
  ctx.beginPath();
  addLine(ctx, x - 17 * s, y, x - 6 * s, y);
  addLine(ctx, x + 6 * s, y, x + 17 * s, y);
  addLine(ctx, x, y - 6 * s, x, y - 12 * s);
  addLine(ctx, x, y + 6 * s, x, y + 11 * s);
  ctx.strokeStyle = HUD_COLORS.main;
  ctx.lineWidth = 1.6 * s;
  ctx.stroke();
}

export function drawFlightPathMarker(f: HudFrame): void {
  if (!f.fpmOk) return;
  const { ctx, s } = f;
  const x = f.fpm.x;
  const y = f.fpm.y;
  const r = 6.5 * s;
  ctx.beginPath();
  addCircle(ctx, x, y, r);
  addLine(ctx, x - r, y, x - r - 12 * s, y);
  addLine(ctx, x + r, y, x + r + 12 * s, y);
  addLine(ctx, x, y - r, x, y - r - 7 * s);
  ctx.strokeStyle = HUD_COLORS.main;
  ctx.lineWidth = 1.6 * s;
  ctx.stroke();
}

/** 피치 래더 */
export function drawPitchLadder(f: HudFrame): void {
  const p = f.player;
  const tel = f.tel;
  if (!p || !tel) return;
  const { ctx, s, cx, cy } = f;

  // 래더 중심 방위: 속도 방향 (저속이면 기수)
  const v = p.velocity;
  const horiz = Math.hypot(v.x, v.z);
  let hx: number;
  let hz: number;
  if (horiz > 30) {
    hx = v.x / horiz;
    hz = v.z / horiz;
  } else {
    const h = tel.headingDeg * DEG;
    hx = Math.sin(h);
    hz = -Math.cos(h);
  }
  // 수평 오른쪽 = (-hz, hx)
  const rx = -hz;
  const rz = hx;

  const clipW = 236 * s;
  const clipH = 206 * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - clipW, cy - clipH, clipW * 2, clipH * 2);
  ctx.clip();

  const gap = 20 * s;
  const half = 64 * s;
  const tick = 8 * s;
  const horizonHalf = 260 * s;
  ctx.font = monoFont(11 * s, 500);
  ctx.fillStyle = HUD_COLORS.main;

  // 1차: 수평선·양의 피치(실선), 2차: 음의 피치(점선)
  const hasNegative = ladderPass(f, hx, hz, rx, rz, gap, half, tick, horizonHalf, clipW, clipH, false);
  ctx.strokeStyle = HUD_COLORS.main;
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();
  if (hasNegative) {
    ladderPass(f, hx, hz, rx, rz, gap, half, tick, horizonHalf, clipW, clipH, true);
    ctx.setLineDash([7 * s, 5 * s]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/** 래더 한 번 그리기: dashed=false 면 수평선·양의 피치, true 면 음의 피치. 라벨은 바로 쓴다 */
function ladderPass(
  f: HudFrame,
  hx: number,
  hz: number,
  rx: number,
  rz: number,
  gap: number,
  half: number,
  tick: number,
  horizonHalf: number,
  clipW: number,
  clipH: number,
  dashed: boolean,
): boolean {
  const { ctx, s, cx, cy, proj } = f;
  ctx.beginPath();
  let anyNegative = false;
  for (let pitch = -90; pitch <= 90; pitch += LADDER_STEP) {
    if (dashed !== pitch < 0) {
      if (pitch < 0) anyNegative = true;
      continue;
    }
    const pr = pitch * DEG;
    const cp = Math.cos(pr);
    const sp = Math.sin(pr);
    if (Math.abs(pitch) > LADDER_MAX) {
      // 천정/천저 기호
      if (!proj.projectDirection(0, Math.sign(pitch), 0, _a)) continue;
      if (Math.abs(_a.x - cx) > clipW + 20 * s || Math.abs(_a.y - cy) > clipH + 20 * s) continue;
      addCircle(ctx, _a.x, _a.y, 9 * s);
      if (pitch < 0) {
        addLine(ctx, _a.x - 6 * s, _a.y - 6 * s, _a.x + 6 * s, _a.y + 6 * s);
        addLine(ctx, _a.x + 6 * s, _a.y - 6 * s, _a.x - 6 * s, _a.y + 6 * s);
      }
      continue;
    }
    const dx = hx * cp;
    const dy = sp;
    const dz = hz * cp;
    if (!proj.projectDirection(dx, dy, dz, _a)) continue;
    if (Math.abs(_a.x - cx) > clipW + half + 40 * s || Math.abs(_a.y - cy) > clipH + 40 * s) continue;
    if (!proj.projectDirection(dx + rx * 0.02, dy, dz + rz * 0.02, _b)) continue;
    let ux = _b.x - _a.x;
    let uy = _b.y - _a.y;
    const ul = Math.hypot(ux, uy);
    if (ul < 1e-6) continue;
    ux /= ul;
    uy /= ul;
    // 래더 위쪽(천정 방향) 법선
    const nx = uy;
    const ny = -ux;
    const x = _a.x;
    const y = _a.y;
    if (pitch === 0) {
      addLine(ctx, x - ux * horizonHalf, y - uy * horizonHalf, x - ux * gap * 1.6, y - uy * gap * 1.6);
      addLine(ctx, x + ux * gap * 1.6, y + uy * gap * 1.6, x + ux * horizonHalf, y + uy * horizonHalf);
      continue;
    }
    // 끝 눈금은 수평선 쪽을 향한다
    const tdir = pitch > 0 ? -1 : 1;
    const lx0 = x - ux * half;
    const ly0 = y - uy * half;
    const rx0 = x + ux * half;
    const ry0 = y + uy * half;
    addLine(ctx, lx0, ly0, x - ux * gap, y - uy * gap);
    addLine(ctx, x + ux * gap, y + uy * gap, rx0, ry0);
    addLine(ctx, lx0, ly0, lx0 + nx * tick * tdir, ly0 + ny * tick * tdir);
    addLine(ctx, rx0, ry0, rx0 + nx * tick * tdir, ry0 + ny * tick * tdir);
    const label = LADDER_LABELS[Math.abs(pitch) / LADDER_STEP];
    const lo = half + 14 * s;
    text(ctx, label, x - ux * lo, y - uy * lo, 'center');
    text(ctx, label, x + ux * lo, y + uy * lo, 'center');
  }
  return anyNegative;
}

const LADDER_LABELS: string[] = [];
for (let i = 0; i <= 90 / LADDER_STEP; i++) LADDER_LABELS.push(`${i * LADDER_STEP}`);

const ROLL_TICKS = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];

/**
 * 롤 눈금: 화면 위쪽 호 (추적 시점에서 기체에 가리지 않게). 지시침은 하늘(천정) 방향을 가리킨다
 * — 오른쪽 롤이면 하늘이 화면에서 반시계로 돌아가므로 왼쪽으로 이동.
 */
export function drawRollScale(f: HudFrame): void {
  const tel = f.tel;
  if (!tel) return;
  const { ctx, s, cx, cy } = f;
  const R = 150 * s;
  ctx.beginPath();
  for (const t of ROLL_TICKS) {
    const a = (-90 + t) * DEG;
    const major = t === 0 || Math.abs(t) === 30 || Math.abs(t) === 60;
    const l = major ? 11 * s : 6 * s;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    addLine(ctx, cx + c * R, cy + sn * R, cx + c * (R + l), cy + sn * (R + l));
  }
  ctx.strokeStyle = HUD_COLORS.mainDim;
  ctx.lineWidth = 1.3 * s;
  ctx.stroke();

  const roll = tel.rollDeg;
  const clamped = Math.max(-64, Math.min(64, roll));
  const a = (-90 - clamped) * DEG;
  const px = cx + Math.cos(a) * (R - 2 * s);
  const py = cy + Math.sin(a) * (R - 2 * s);
  ctx.beginPath();
  addArrowHead(ctx, px, py, a, 10 * s, 5 * s);
  ctx.fillStyle = Math.abs(roll) > 64 ? HUD_COLORS.caution : HUD_COLORS.main;
  ctx.fill();
  if (Math.abs(roll) > 64) {
    ctx.font = monoFont(11 * s, 600);
    text(ctx, `${Math.round(Math.abs(roll))}${roll > 0 ? 'R' : 'L'}`, px - Math.cos(a) * 24 * s, py - Math.sin(a) * 24 * s, 'center');
  }
}

/** 마우스 에임: 마우스가 가리키는 방향 조준원 + 보어사이트까지 안내선 */
export function drawMouseAim(f: HudFrame, aimDir: THREE.Vector3): void {
  const { ctx, s, proj } = f;
  _d.copy(aimDir);
  if (_d.lengthSq() < 1e-9) return;
  _d.normalize();
  if (!proj.projectDirection(_d.x, _d.y, _d.z, _a)) return;
  const x = _a.x;
  const y = _a.y;
  const r = 11 * s;
  ctx.beginPath();
  addCircle(ctx, x, y, r);
  addLine(ctx, x - r - 5 * s, y, x - r + 2 * s, y);
  addLine(ctx, x + r - 2 * s, y, x + r + 5 * s, y);
  addLine(ctx, x, y - r - 5 * s, x, y - r + 2 * s);
  addLine(ctx, x, y + r - 2 * s, x, y + r + 5 * s);
  ctx.strokeStyle = HUD_COLORS.text;
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();
  if (f.boreOk) {
    const dx = x - f.bore.x;
    const dy = y - f.bore.y;
    const d = Math.hypot(dx, dy);
    if (d > 34 * s) {
      ctx.beginPath();
      addLine(ctx, f.bore.x + (dx / d) * 20 * s, f.bore.y + (dy / d) * 20 * s, x - (dx / d) * r, y - (dy / d) * r);
      ctx.setLineDash([3 * s, 5 * s]);
      ctx.strokeStyle = HUD_COLORS.textDim;
      ctx.lineWidth = 1 * s;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
