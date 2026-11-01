// RWR 스코프(오른쪽 위)와 레이더 미니맵(왼쪽 아래, heading-up, 자동 범위).
import type { AircraftLike, Threat } from '../../../core/contracts';
import type { Entity } from '../../../core/entity';
import { DEG, RAD } from '../../../core/math';
import { HUD_COLORS, blink, monoFont, sansFont } from '../style';
import { bearingToCanvasAngle } from '../projection';
import { MAP_RANGES, autoMapRange, worldToMap, type MapPoint } from '../mapMath';
import { distanceIn, distanceLabel } from '../units';
import type { HudFrame } from '../frame';
import { addCircle, addDiamond, addLine, addRect, text } from './primitives';
import { MARGIN } from './panels';

const RWR_RADIAL: Record<Threat['kind'], number> = { missile: 0.24, launch: 0.42, track: 0.62, search: 0.84 };

export interface ScopeLayout {
  rwrX: number;
  rwrY: number;
  rwrR: number;
  mapX: number;
  mapY: number;
  mapR: number;
}

export function scopeLayout(f: HudFrame, out: ScopeLayout): ScopeLayout {
  const s = f.s;
  out.rwrR = 50 * s;
  out.rwrX = f.W - MARGIN * s - out.rwrR - 6 * s;
  out.rwrY = MARGIN * s + out.rwrR + 6 * s;
  out.mapR = 88 * s;
  out.mapX = MARGIN * s + out.mapR + 4 * s;
  out.mapY = f.H - MARGIN * s - out.mapR - 4 * s;
  return out;
}

function threatColor(t: Threat): string {
  if (t.kind === 'missile' || t.kind === 'launch') return HUD_COLORS.warn;
  if (t.kind === 'track') return HUD_COLORS.caution;
  return HUD_COLORS.main;
}

export function drawRwr(f: HudFrame, L: ScopeLayout): void {
  const p = f.player;
  if (!p) return;
  const { ctx, s, time } = f;
  const x = L.rwrX;
  const y = L.rwrY;
  const R = L.rwrR;
  ctx.beginPath();
  addCircle(ctx, x, y, R);
  ctx.fillStyle = HUD_COLORS.panel;
  ctx.fill();
  ctx.beginPath();
  addCircle(ctx, x, y, R);
  ctx.strokeStyle = HUD_COLORS.mainDim;
  ctx.lineWidth = 1.3 * s;
  ctx.stroke();
  ctx.beginPath();
  addCircle(ctx, x, y, R * 0.5);
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    const l = i % 3 === 0 ? 7 * s : 4 * s;
    addLine(ctx, x + Math.cos(a) * R, y + Math.sin(a) * R, x + Math.cos(a) * (R - l), y + Math.sin(a) * (R - l));
  }
  ctx.strokeStyle = HUD_COLORS.mainFaint;
  ctx.lineWidth = 1 * s;
  ctx.stroke();
  // 자기 기체
  ctx.beginPath();
  addLine(ctx, x, y - 5 * s, x, y + 5 * s);
  addLine(ctx, x - 5 * s, y, x + 5 * s, y);
  ctx.strokeStyle = HUD_COLORS.main;
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();

  const hasRwr = !!p.stats?.rwr;
  const threats = p.avionics.threats;
  ctx.font = monoFont(9 * s, 700);
  for (let i = 0; i < threats.length; i++) {
    const t = threats[i];
    const a = bearingToCanvasAngle(t.bearingDeg);
    const r = R * RWR_RADIAL[t.kind];
    const tx = x + Math.cos(a) * r;
    const ty = y + Math.sin(a) * r;
    const col = threatColor(t);
    const flashing = t.kind === 'launch' || t.kind === 'missile';
    if (flashing && !blink(time, 4, 0.6)) continue;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1.3 * s;
    if (t.kind === 'missile') {
      ctx.beginPath();
      addDiamond(ctx, tx, ty, 4.5 * s);
      ctx.fill();
      continue;
    }
    const label = t.label.length > 6 ? t.label.slice(0, 6) : t.label;
    text(ctx, label, tx, ty, 'center');
    if (t.kind === 'launch') {
      ctx.beginPath();
      addCircle(ctx, tx, ty, 9 * s);
      ctx.stroke();
    } else if (t.kind === 'track') {
      ctx.beginPath();
      ctx.moveTo(tx - 9 * s, ty - 5 * s);
      ctx.lineTo(tx, ty - 10 * s);
      ctx.lineTo(tx + 9 * s, ty - 5 * s);
      ctx.stroke();
    }
  }

  // 아래 상태 줄: RWR / MAW
  const ly = y + R + 10 * s;
  ctx.font = monoFont(10 * s, 700);
  ctx.fillStyle = hasRwr ? HUD_COLORS.main : HUD_COLORS.mainDim;
  text(ctx, hasRwr ? 'RWR' : 'RWR ---', x - 14 * s, ly, 'right');
  const hasMaw = !!p.stats?.maw;
  if (hasMaw) {
    ctx.fillStyle = HUD_COLORS.main;
    text(ctx, 'MAW', x + 14 * s, ly, 'left');
  } else {
    ctx.font = sansFont(10 * s, 600);
    ctx.fillStyle = HUD_COLORS.caution;
    text(ctx, 'MAW 없음', x + 14 * s, ly, 'left');
  }
}

export interface MinimapState {
  rangeIdx: number;
}

export function createMinimapState(): MinimapState {
  return { rangeIdx: 1 };
}

export interface MapMarkerLike {
  x: number;
  z: number;
  label: string;
  kind: string;
  radius?: number;
}

const _mp: MapPoint = { x: 0, y: 0 };

function markerKindColor(kind: string): string {
  switch (kind) {
    case 'friendly':
      return HUD_COLORS.friendly;
    case 'enemy':
      return HUD_COLORS.hostile;
    case 'target':
      return HUD_COLORS.target;
    default:
      return HUD_COLORS.main;
  }
}

/** 관심 거리: 지정 표적 → 가장 가까운 적 트랙 → 가장 가까운 미션 표적 */
function focusDistance(f: HudFrame, p: AircraftLike): number | null {
  const d = f.designated;
  if (d) return p.position.distanceTo(d.position);
  let best = Infinity;
  for (const t of p.avionics.tracks) if (t.hostile && t.entity.targetClass !== 'weapon') best = Math.min(best, p.position.distanceTo(t.position));
  if (best < Infinity) return best;
  const ents = f.sim.world.entities;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.alive && !e.removed && e.tags.has('target') && e.faction !== p.faction) best = Math.min(best, p.position.distanceTo(e.position));
  }
  return best < Infinity ? best : null;
}

export function drawMinimap(
  f: HudFrame,
  L: ScopeLayout,
  st: MinimapState,
  tracked: ReadonlySet<number>,
  markers: readonly MapMarkerLike[] | null,
): void {
  const p = f.player;
  const tel = f.tel;
  if (!p || !tel) return;
  const { ctx, s, units } = f;
  const x = L.mapX;
  const y = L.mapY;
  const R = L.mapR;
  const ranges = MAP_RANGES[units];
  st.rangeIdx = autoMapRange(focusDistance(f, p), ranges, st.rangeIdx);
  const range = ranges[st.rangeIdx];
  const scale = R / range;
  const hdg = tel.headingDeg;
  const px = p.position.x;
  const pz = p.position.z;

  ctx.beginPath();
  addCircle(ctx, x, y, R);
  ctx.fillStyle = 'rgba(3, 14, 9, 0.55)';
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.clip();

  // 레이더 탐지 원뿔
  const radar = p.stats?.radar;
  if (radar && p.avionics.radarMode !== 'off') {
    const rr = Math.min(R * 1.05, radar.rangeKm * 1000 * scale);
    const az = Math.min(80, radar.azimuthDeg) * DEG;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, rr, -Math.PI / 2 - az, -Math.PI / 2 + az);
    ctx.closePath();
    ctx.fillStyle = p.avionics.radarMode === 'ag' ? 'rgba(255, 210, 74, 0.10)' : 'rgba(125, 255, 176, 0.10)';
    ctx.fill();
    ctx.strokeStyle = HUD_COLORS.mainFaint;
    ctx.lineWidth = 1 * s;
    ctx.stroke();
  }

  // 거리 고리
  ctx.beginPath();
  addCircle(ctx, x, y, R * 0.5);
  ctx.strokeStyle = HUD_COLORS.mainFaint;
  ctx.lineWidth = 1 * s;
  ctx.stroke();

  // 작전 구역 경계
  const mapRadius = f.sim.services.terrain.mapRadius;
  if (mapRadius > 0) {
    worldToMap(-px, -pz, hdg, scale, _mp);
    const br = mapRadius * scale;
    const dc = Math.hypot(_mp.x, _mp.y);
    if (dc + R > br) {
      ctx.beginPath();
      ctx.arc(x + _mp.x, y + _mp.y, br, 0, Math.PI * 2);
      ctx.setLineDash([5 * s, 4 * s]);
      ctx.strokeStyle = HUD_COLORS.warn;
      ctx.lineWidth = 1.4 * s;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // 미션 지도 마커 (보급 구역/목표 지점)
  if (markers) {
    ctx.font = sansFont(9 * s, 600);
    for (const m of markers) {
      worldToMap(m.x - px, m.z - pz, hdg, scale, _mp);
      const col = markerKindColor(m.kind);
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 1 * s;
      if (m.radius && m.radius > 0) {
        ctx.beginPath();
        ctx.arc(x + _mp.x, y + _mp.y, Math.max(3 * s, m.radius * scale), 0, Math.PI * 2);
        ctx.setLineDash([3 * s, 3 * s]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (Math.hypot(_mp.x, _mp.y) > R) continue;
      ctx.beginPath();
      addLine(ctx, x + _mp.x - 3 * s, y + _mp.y - 3 * s, x + _mp.x + 3 * s, y + _mp.y + 3 * s);
      addLine(ctx, x + _mp.x + 3 * s, y + _mp.y - 3 * s, x + _mp.x - 3 * s, y + _mp.y + 3 * s);
      ctx.stroke();
      if (m.label) text(ctx, m.label, x + _mp.x + 6 * s, y + _mp.y, 'left');
    }
  }

  // 트랙
  const designatedEntity = f.designated?.entity ?? null;
  for (const t of p.avionics.tracks) {
    const e = t.entity;
    if (e === p || e.removed || e.targetClass === 'weapon') continue;
    const friendly = e.faction === p.faction;
    const col = e.tags.has('target') && !friendly ? HUD_COLORS.target : t.hostile ? HUD_COLORS.hostile : friendly ? HUD_COLORS.friendly : HUD_COLORS.neutral;
    drawMapEntity(f, x, y, R, e, t.position.x - px, t.position.z - pz, t.velocity.x, t.velocity.z, hdg, scale, col, e === designatedEntity, false);
  }
  // 미탐지 미션 표적(정보) / 아군기
  const ents = f.sim.world.entities;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e === p || !e.alive || e.removed || tracked.has(e.id)) continue;
    const friendlyAir = e.kind === 'aircraft' && e.faction === p.faction;
    const target = e.tags.has('target') && e.faction !== p.faction;
    if (!friendlyAir && !target) continue;
    drawMapEntity(
      f,
      x,
      y,
      R,
      e,
      e.position.x - px,
      e.position.z - pz,
      e.velocity.x,
      e.velocity.z,
      hdg,
      scale,
      friendlyAir ? HUD_COLORS.friendly : HUD_COLORS.target,
      false,
      !friendlyAir,
    );
  }
  ctx.restore();

  // 테두리, 자기 기체, 북쪽, 범위
  ctx.beginPath();
  addCircle(ctx, x, y, R);
  ctx.strokeStyle = HUD_COLORS.mainDim;
  ctx.lineWidth = 1.4 * s;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - 7 * s);
  ctx.lineTo(x + 5 * s, y + 5 * s);
  ctx.lineTo(x, y + 2 * s);
  ctx.lineTo(x - 5 * s, y + 5 * s);
  ctx.closePath();
  ctx.fillStyle = HUD_COLORS.main;
  ctx.fill();

  worldToMap(0, -1, hdg, 1, _mp);
  const nl = Math.hypot(_mp.x, _mp.y) || 1;
  ctx.font = monoFont(10 * s, 800);
  ctx.fillStyle = HUD_COLORS.main;
  text(ctx, 'N', x + (_mp.x / nl) * (R - 9 * s), y + (_mp.y / nl) * (R - 9 * s), 'center');

  ctx.font = monoFont(10 * s, 600);
  ctx.fillStyle = HUD_COLORS.mainDim;
  text(ctx, `${Math.round(distanceIn(range, units))} ${distanceLabel(units)}`, x + R * 0.72, y - R * 0.86, 'left');
}

function drawMapEntity(
  f: HudFrame,
  x: number,
  y: number,
  R: number,
  e: Entity,
  dx: number,
  dz: number,
  vx: number,
  vz: number,
  hdg: number,
  scale: number,
  col: string,
  designated: boolean,
  hollow: boolean,
): void {
  const { ctx, s } = f;
  worldToMap(dx, dz, hdg, scale, _mp);
  let mx = _mp.x;
  let my = _mp.y;
  const d = Math.hypot(mx, my);
  const edge = d > R - 3 * s;
  if (edge) {
    // 범위 밖: 지정 표적/미션 표적만 가장자리에 점으로
    if (!designated && !e.tags.has('target')) return;
    mx = (mx / d) * (R - 4 * s);
    my = (my / d) * (R - 4 * s);
  }
  const ex = x + mx;
  const ey = y + my;
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  if (edge) {
    addCircle(ctx, ex, ey, 2.5 * s);
    ctx.fill();
    return;
  }
  if (e.targetClass === 'air') {
    // 진행 방향 삼각형
    const vh = Math.hypot(vx, vz) > 5 ? Math.atan2(vx, -vz) * RAD - hdg : 0;
    const a = (vh * Math.PI) / 180;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const k = 4.5 * s;
    ctx.moveTo(ex + sn * k * 1.3, ey - c * k * 1.3);
    ctx.lineTo(ex - sn * k + c * k * 0.8, ey + c * k + sn * k * 0.8);
    ctx.lineTo(ex - sn * k - c * k * 0.8, ey + c * k - sn * k * 0.8);
    ctx.closePath();
  } else if (e.targetClass === 'sea') {
    addDiamond(ctx, ex, ey, 4 * s);
  } else {
    addRect(ctx, ex - 3 * s, ey - 3 * s, 6 * s, 6 * s);
  }
  if (hollow) ctx.stroke();
  else ctx.fill();
  if (designated) {
    ctx.beginPath();
    addCircle(ctx, ex, ey, 8 * s);
    ctx.stroke();
  }
}
