// 표적 표시: 트랙 마커(공중 = 상자, 지상/구조물 = 마름모, 함정 = 오각형), 지정 표적 락 브래킷·정보,
// 화면 밖 표적 화살표, 기관포 리드 조준점/탄도 깔때기, 무유도 폭탄 CCIP, 격파 점수 팝업.
import * as THREE from 'three';
import type { AircraftLike } from '../../../core/contracts';
import type { Entity } from '../../../core/entity';
import type { WeaponDef } from '../../../data/schema';
import { HUD_COLORS, monoFont, sansFont, blink } from '../style';
import { edgeArrow, makeScreenPoint, type EdgeArrow } from '../projection';
import { aspectInfo, closureRate, markerShape, type AspectInfo, type MarkerShape } from '../targeting';
import { formatAspect, formatRange, formatSigned, formatThousands, speedIn } from '../units';
import { ballisticBodyOf, computeGunLead, gunStreamPoint, isUnguidedBomb, predictBombImpact, type BallisticBody } from '../gunnery';
import { POPUP_LIFETIME, type EventFeed } from '../feed';
import type { HudFrame } from '../frame';
import { addArrowHead, addBrackets, addCircle, addDiamond, addLine, addRect, addShip, text } from './primitives';

const _sp = makeScreenPoint();
const _sp2 = makeScreenPoint();
const _cam = new THREE.Vector3();
const _arrow: EdgeArrow = { x: 0, y: 0, angle: 0 };
const _aspect: AspectInfo = { deg: 0, side: 'R' };
const _gunPos = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _impact = new THREE.Vector3();

/** 이름 없는/미식별 표적 표시 */
const UNKNOWN = 'UNK';
/** 지상 표적 라벨을 붙이는 거리 (m) */
const GROUND_LABEL_RANGE = 9000;
const AIR_LABEL_RANGE = 45_000;
/** 미탐지 미션 표적을 시각 정보로 표시하는 거리 (m) */
const VISUAL_TARGET_RANGE = 15_000;
const FRIENDLY_SHOW_RANGE = 40_000;
const GUN_LEAD_RANGE = 2200;

export interface TargetDrawState {
  /** 이번 프레임 트랙에 있는 엔티티 id */
  readonly tracked: Set<number>;
}

export function createTargetDrawState(): TargetDrawState {
  return { tracked: new Set() };
}

function sideColor(player: AircraftLike, e: Entity, hostile: boolean): string {
  const friendly = e.faction === player.faction;
  if (e.tags.has('target') && !friendly) return HUD_COLORS.target;
  if (hostile) return HUD_COLORS.hostile;
  if (friendly) return HUD_COLORS.friendly;
  return HUD_COLORS.neutral;
}

function addShape(ctx: CanvasRenderingContext2D, shape: MarkerShape, x: number, y: number, r: number): void {
  if (shape === 'box') addRect(ctx, x - r, y - r, r * 2, r * 2);
  else if (shape === 'ship') addShip(ctx, x, y, r * 1.15);
  else addDiamond(ctx, x, y, r * 1.2);
}

function markerRadius(f: HudFrame, e: Entity, depth: number): number {
  const s = f.s;
  const min = e.targetClass === 'air' ? 9 * s : 8 * s;
  return Math.min(64 * s, Math.max(min, f.proj.pixelRadius(e.radius * 1.2, depth)));
}

/** 모든 트랙 + 아군기 + 미탐지 미션 표적 마커 */
export function drawTrackMarkers(f: HudFrame, st: TargetDrawState): void {
  const p = f.player;
  if (!p) return;
  const { s, proj } = f;
  const tracks = p.avionics.tracks;
  const designatedEntity = f.designated?.entity ?? null;
  const lockEntity = f.lock.target;
  st.tracked.clear();

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const e = t.entity;
    st.tracked.add(e.id);
    if (e === p || e.removed || e.targetClass === 'weapon') continue;
    if (!proj.projectPoint(t.position, _sp) || !proj.inside(_sp, -30 * s)) continue;
    const dist = p.position.distanceTo(t.position);
    const isDesignated = e === designatedEntity || e === lockEntity;
    drawMarker(f, e, dist, sideColor(p, e, t.hostile), isDesignated, t.identified, t.source === 'datalink' || t.quality < 0.35);
  }

  // 트랙에 없는 아군기 / 가까운 미션 표적 (육안·정보)
  const ents = f.sim.world.entities;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e === p || !e.alive || e.removed || st.tracked.has(e.id)) continue;
    const friendlyAir = e.kind === 'aircraft' && e.faction === p.faction;
    const target = e.tags.has('target') && e.faction !== p.faction;
    if (!friendlyAir && !target) continue;
    const dist = p.position.distanceTo(e.position);
    if (dist > (friendlyAir ? FRIENDLY_SHOW_RANGE : VISUAL_TARGET_RANGE)) continue;
    if (!proj.projectPoint(e.position, _sp) || !proj.inside(_sp, -30 * s)) continue;
    drawMarker(f, e, dist, friendlyAir ? HUD_COLORS.friendly : HUD_COLORS.target, false, friendlyAir, true);
  }
}

/** _sp 에 투영된 위치에 마커 하나 */
function drawMarker(
  f: HudFrame,
  e: Entity,
  dist: number,
  color: string,
  designated: boolean,
  identified: boolean,
  dashed: boolean,
): void {
  const { ctx, s, units } = f;
  const x = _sp.x;
  const y = _sp.y;
  const r = markerRadius(f, e, _sp.depth);
  const shape = markerShape(e.targetClass);
  ctx.beginPath();
  addShape(ctx, shape, x, y, r);
  ctx.strokeStyle = color;
  ctx.lineWidth = (designated ? 2.2 : 1.4) * s;
  if (dashed) ctx.setLineDash([4 * s, 3 * s]);
  ctx.stroke();
  if (dashed) ctx.setLineDash([]);

  const isTarget = e.tags.has('target') && e.faction !== f.player!.faction;
  const air = e.targetClass === 'air';
  const labelled = designated || isTarget || (air ? dist < AIR_LABEL_RANGE : dist < GROUND_LABEL_RANGE);
  if (!labelled) return;
  const friendly = e.faction === f.player!.faction;
  const name = identified ? (friendly ? e.label : e.name) : UNKNOWN;
  ctx.fillStyle = color;
  ctx.font = monoFont(11 * s, 600);
  const top = y - r - (shape === 'box' ? 4 : 7) * s;
  if (isTarget) {
    ctx.font = monoFont(11 * s, 700);
    text(ctx, 'TGT', x, top - 13 * s, 'center', 'bottom');
    ctx.font = monoFont(11 * s, 600);
  }
  text(ctx, name, x, top, 'center', 'bottom');
  if (!designated) text(ctx, formatRange(dist, units), x, y + r + (shape === 'box' ? 4 : 7) * s, 'center', 'top');
}

/** 지정 표적: 락 브래킷(진행에 따라 수축, 락 시 빨간 실선), 거리/접근률/aspect, 화면 밖이면 화살표 */
export function drawDesignatedTarget(f: HudFrame): void {
  const p = f.player;
  if (!p) return;
  const lock = f.lock;
  const track = f.designated;
  const entity: Entity | null = lock.target ?? track?.entity ?? null;
  if (!entity || entity.removed) return;
  const pos = track && track.entity === entity ? track.position : entity.position;
  const vel = track && track.entity === entity ? track.velocity : entity.velocity;
  const { ctx, s, proj, units, time } = f;
  const dist = p.position.distanceTo(pos);
  const locked = lock.status === 'locked';
  const locking = lock.status === 'locking';
  const baseCol = sideColor(p, entity, track?.hostile ?? true);
  const lockCol = locked ? HUD_COLORS.warn : locking ? HUD_COLORS.caution : baseCol;

  const onScreen = proj.projectPoint(pos, _sp) && proj.inside(_sp, 12 * s);
  if (!onScreen) {
    proj.toCamera(pos, _cam);
    const rx = Math.min(f.W * 0.42, 230 * s);
    const ry = Math.min(f.H * 0.4, 178 * s);
    edgeArrow(_cam.x, _cam.y, f.cx, f.cy, rx, ry, _arrow);
    ctx.beginPath();
    addArrowHead(ctx, _arrow.x, _arrow.y, _arrow.angle, 20 * s, 10 * s);
    ctx.fillStyle = lockCol;
    ctx.fill();
    ctx.font = monoFont(12 * s, 700);
    ctx.fillStyle = lockCol;
    const tx = _arrow.x - Math.cos(_arrow.angle) * 34 * s;
    const ty = _arrow.y - Math.sin(_arrow.angle) * 26 * s;
    text(ctx, formatRange(dist, units), tx, ty, 'center');
    return;
  }

  const x = _sp.x;
  const y = _sp.y;
  const r = markerRadius(f, entity, _sp.depth);
  const base = r + 7 * s;
  let half = base;
  let alpha = 1;
  if (lock.status === 'searching') {
    half = base + 22 * s;
    alpha = 0.45 + 0.35 * Math.sin(time * 6);
  } else if (locking) {
    const pr = Math.max(0, Math.min(1, lock.progress));
    half = base + (1 - pr) * 36 * s;
  }
  if (lock.status !== 'none') {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    addBrackets(ctx, x, y, half, half, Math.max(6 * s, half * 0.42));
    ctx.strokeStyle = lockCol;
    ctx.lineWidth = (locked ? 3 : 2) * s;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (locking) {
      // 락 진행 원호
      ctx.beginPath();
      ctx.arc(x, y, half + 6 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, lock.progress)));
      ctx.strokeStyle = HUD_COLORS.caution;
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();
    }
  }
  if (locked) {
    ctx.font = monoFont(12 * s, 800);
    ctx.fillStyle = HUD_COLORS.warn;
    if (blink(time, 3, 0.75)) text(ctx, 'LOCK', x, y + half + 6 * s, 'center', 'top');
  }

  // 정보 블록 (오른쪽)
  const ix = x + half + 10 * s;
  let iy = y - half + 2 * s;
  const lh = 14 * s;
  ctx.font = monoFont(13 * s, 700);
  ctx.fillStyle = baseCol;
  text(ctx, formatRange(dist, units), ix, iy, 'left', 'top');
  iy += lh + 1 * s;
  ctx.font = monoFont(11 * s, 600);
  const vc = closureRate(p.position, p.velocity, pos, vel);
  text(ctx, `Vc ${formatSigned(speedIn(vc, units))}`, ix, iy, 'left', 'top');
  iy += lh;
  if (entity.targetClass === 'air') {
    aspectInfo(p.position, pos, vel, _aspect);
    text(ctx, `ASP ${formatAspect(_aspect.deg, _aspect.side)}`, ix, iy, 'left', 'top');
    iy += lh;
  }
  const om = f.ownMissiles;
  if (om.count > 0) {
    ctx.fillStyle = HUD_COLORS.text;
    text(ctx, om.timeToGo >= 0 ? `MSL ${om.count} · ${Math.ceil(om.timeToGo)}s` : `MSL ${om.count}`, ix, iy, 'left', 'top');
  }
}

// ---------------------------------------------------------------- 기관포

const FUNNEL_N = 8;
const _fx = new Float64Array(FUNNEL_N);
const _fy = new Float64Array(FUNNEL_N);
const _fw = new Float64Array(FUNNEL_N);

/** 기관포 리드 조준점 (표적 2 km 이내 + assists.gunLead) 과 탄도 깔때기 */
export function drawGunSight(f: HudFrame): void {
  const p = f.player;
  if (!p || !f.sim.settings.assists.gunLead) return;
  const gun = p.stores.gun;
  if (!gun || gun.rounds <= 0) return;
  const track = f.designated;
  const entity = track?.entity ?? null;
  if (!track || !entity || entity.targetClass !== 'air' || entity.removed) return;
  const dist = p.position.distanceTo(track.position);
  const gunRange = Math.min(GUN_LEAD_RANGE, gun.def.gun?.rangeM ?? GUN_LEAD_RANGE);
  if (dist > gunRange) return;
  const mv = gun.def.gun?.muzzleVelocity ?? 1030;
  const { ctx, s, proj } = f;
  p.getGunWorldPosition(_gunPos);

  // 탄도 깔때기: 반폭 = 전투기 반 날개폭(약 6 m)이 그 거리에서 보이는 크기
  let n = 0;
  for (let i = 0; i < FUNNEL_N; i++) {
    const range = 250 + (i * (gunRange - 250)) / (FUNNEL_N - 1);
    gunStreamPoint(_gunPos, f.fwd, mv, range / mv, _tmp);
    if (!proj.projectPoint(_tmp, _sp2)) break;
    _fx[n] = _sp2.x;
    _fy[n] = _sp2.y;
    _fw[n] = Math.max(2 * s, proj.pixelRadius(6, _sp2.depth));
    n++;
  }
  if (n >= 2) {
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < n; i++) {
        const j = i < n - 1 ? i + 1 : i;
        const k = i < n - 1 ? i : i - 1;
        let dx = _fx[j] - _fx[k];
        let dy = _fy[j] - _fy[k];
        const l = Math.hypot(dx, dy) || 1;
        dx /= l;
        dy /= l;
        const px = _fx[i] - dy * _fw[i] * side;
        const py = _fy[i] + dx * _fw[i] * side;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
    }
    ctx.strokeStyle = HUD_COLORS.mainDim;
    ctx.lineWidth = 1.2 * s;
    ctx.stroke();
  }

  const tof = computeGunLead(_gunPos, p.velocity, track.position, track.velocity, mv, _aim);
  if (tof < 0 || !proj.projectDirection(_aim.x, _aim.y, _aim.z, _sp)) return;
  const x = _sp.x;
  const y = _sp.y;
  const r = 13 * s;
  const onTarget = f.boreOk && Math.hypot(f.bore.x - x, f.bore.y - y) < r * 0.8;
  const col = onTarget ? HUD_COLORS.warn : HUD_COLORS.main;
  ctx.beginPath();
  addCircle(ctx, x, y, r);
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.6 * s;
  ctx.stroke();
  // 거리 원호: 남은 거리 비율 (12시 방향부터 시계방향)
  ctx.beginPath();
  ctx.arc(x, y, r + 4 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, dist / gunRange));
  ctx.lineWidth = 2.6 * s;
  ctx.stroke();
  ctx.beginPath();
  addCircle(ctx, x, y, 2 * s);
  ctx.fillStyle = col;
  ctx.fill();
  // 표적 → 조준점 안내선
  if (proj.projectPoint(track.position, _sp2)) {
    const dx = x - _sp2.x;
    const dy = y - _sp2.y;
    const d = Math.hypot(dx, dy);
    if (d > r * 2) {
      ctx.beginPath();
      addLine(ctx, _sp2.x + (dx / d) * 12 * s, _sp2.y + (dy / d) * 12 * s, x - (dx / d) * (r + 5 * s), y - (dy / d) * (r + 5 * s));
      ctx.setLineDash([2 * s, 4 * s]);
      ctx.strokeStyle = HUD_COLORS.mainDim;
      ctx.lineWidth = 1 * s;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if (onTarget) {
    ctx.font = monoFont(12 * s, 800);
    ctx.fillStyle = HUD_COLORS.warn;
    text(ctx, 'SHOOT', x, y + r + 9 * s, 'center', 'top');
  }
}

// ---------------------------------------------------------------- CCIP

const bodyCache = new WeakMap<WeaponDef, BallisticBody>();

/** 무유도 폭탄 연속 계산 탄착점(CCIP) + 낙하선 */
export function drawCcip(f: HudFrame): void {
  const p = f.player;
  const def = f.selected;
  if (!p || !isUnguidedBomb(def)) return;
  let body = bodyCache.get(def!);
  if (!body) bodyCache.set(def!, (body = ballisticBodyOf(def!)));
  const terrain = f.sim.services.terrain;
  const tti = predictBombImpact(p.position, p.velocity, body, (x, z) => terrain.heightAt(x, z), _impact, { dt: 0.1, maxTime: 80 });
  const { ctx, s, proj, W, H } = f;
  if (tti < 0) return;
  const front = proj.projectPoint(_impact, _sp);
  const anchorX = f.fpmOk ? f.fpm.x : f.cx;
  const anchorY = f.fpmOk ? f.fpm.y : f.cy;
  const r = 10 * s;
  ctx.strokeStyle = HUD_COLORS.main;
  ctx.fillStyle = HUD_COLORS.main;
  ctx.lineWidth = 1.5 * s;
  if (front && proj.inside(_sp, 8 * s)) {
    ctx.beginPath();
    const dx = _sp.x - anchorX;
    const dy = _sp.y - anchorY;
    const d = Math.hypot(dx, dy);
    if (d > r + 20 * s) addLine(ctx, anchorX + (dx / d) * 14 * s, anchorY + (dy / d) * 14 * s, _sp.x - (dx / d) * r, _sp.y - (dy / d) * r);
    addCircle(ctx, _sp.x, _sp.y, r);
    ctx.stroke();
    ctx.beginPath();
    addCircle(ctx, _sp.x, _sp.y, 2 * s);
    ctx.fill();
    ctx.font = monoFont(11 * s, 700);
    text(ctx, 'CCIP', _sp.x + r + 6 * s, _sp.y - 6 * s, 'left');
    ctx.font = monoFont(11 * s, 500);
    text(ctx, `${tti.toFixed(1)}s`, _sp.x + r + 6 * s, _sp.y + 7 * s, 'left');
    return;
  }
  // 탄착점이 화면 밖: 낙하선을 화면 가장자리까지 긋고 표시
  let dx = _sp.x - anchorX;
  let dy = _sp.y - anchorY;
  if (!front) {
    dx = 0;
    dy = 1;
  }
  const d = Math.hypot(dx, dy) || 1;
  dx /= d;
  dy /= d;
  const maxT = Math.min(dx > 0 ? (W - 20 * s - anchorX) / dx : dx < 0 ? (20 * s - anchorX) / dx : Infinity, dy > 0 ? (H - 20 * s - anchorY) / dy : dy < 0 ? (20 * s - anchorY) / dy : Infinity);
  const len = Math.min(maxT, 220 * s);
  ctx.beginPath();
  addLine(ctx, anchorX + dx * 14 * s, anchorY + dy * 14 * s, anchorX + dx * len, anchorY + dy * len);
  ctx.setLineDash([6 * s, 4 * s]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  addArrowHead(ctx, anchorX + dx * (len + 10 * s), anchorY + dy * (len + 10 * s), Math.atan2(dy, dx), 10 * s, 5 * s);
  ctx.fill();
  ctx.font = monoFont(11 * s, 700);
  text(ctx, 'CCIP', anchorX + dx * len + 14 * s, anchorY + dy * len, 'left');
}

// ---------------------------------------------------------------- 격파 팝업

export function drawKillPopups(f: HudFrame, feed: EventFeed): void {
  const { ctx, s, proj, time } = f;
  for (const pop of feed.popups) {
    const age = time - pop.time;
    if (!proj.projectPoint(pop.position, _sp) || !proj.inside(_sp, -40 * s)) continue;
    const a = age < 0.15 ? age / 0.15 : Math.max(0, 1 - Math.max(0, age - POPUP_LIFETIME * 0.6) / (POPUP_LIFETIME * 0.4));
    if (a <= 0) continue;
    const rise = Math.min(1, age / 1.2) * 26 * s;
    const x = _sp.x;
    const y = _sp.y - 18 * s - rise;
    ctx.globalAlpha = a;
    // 격파 표식: X
    ctx.beginPath();
    const k = 7 * s;
    addLine(ctx, _sp.x - k, _sp.y - k, _sp.x + k, _sp.y + k);
    addLine(ctx, _sp.x + k, _sp.y - k, _sp.x - k, _sp.y + k);
    ctx.strokeStyle = HUD_COLORS.hostile;
    ctx.lineWidth = 2 * s;
    ctx.stroke();
    if (pop.score !== null && pop.score > 0) {
      ctx.font = monoFont(15 * s, 800);
      ctx.fillStyle = HUD_COLORS.target;
      text(ctx, `+${formatThousands(pop.score)}`, x, y, 'center', 'bottom');
    }
    ctx.font = sansFont(11 * s, 600);
    ctx.fillStyle = HUD_COLORS.text;
    text(ctx, pop.label, x, y + 2 * s, 'center', 'top');
    ctx.globalAlpha = 1;
  }
}
