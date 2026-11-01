// 센서/항전 샌드박스: 위에서 내려다본 2D 시나리오.
//   왼쪽: 광역 (레이더 스캔 볼륨, 탐지/미탐지 표적과 이유 — 스텔스, 재밍/번스루, 노치, 지형 차폐, 데이터링크)
//   오른쪽 위: 근접 (육안 범위, RWR/MAW 위협 방위 링, 미사일, 견인 디코이)
//   오른쪽 아래: 항전 상태 (모드/방사/락/트랙/위협)
import * as THREE from 'three';
import type { AircraftAvionics } from '../src/combat/avionics/avionics';
import { shortLabel } from '../src/combat/avionics/geometry';
import { visualAirRange } from '../src/combat/avionics/sensorMath';
import {
  SAMPLE_DATALINK,
  SAMPLE_EW,
  SAMPLE_HELMET,
  SAMPLE_IRST,
  SAMPLE_MAW,
  SAMPLE_RADAR,
  SAMPLE_RWR,
  SAMPLE_WEAPONS,
  TestAircraft,
  TestMissile,
  TestUnit,
  createTestSim,
  mountainTerrain,
  polar,
  stepSim,
  testWeapon,
  type TestAircraftOptions,
} from '../src/combat/avionics/testkit';
import { TowedDecoy } from '../src/combat/avionics/towedDecoy';
import type { Threat, Track } from '../src/core/contracts';
import type { Entity } from '../src/core/entity';
import type { Faction } from '../src/core/types';

const FONT = '"WenQuanYi Zen Hei", "Noto Sans CJK KR", sans-serif';
const W = 1280;
const H = 720;

// ---------------------------------------------------------------- 시나리오

const peakPos = polar(-40, 40_000, 0);
const terrain = mountainTerrain([{ x: peakPos.x, z: peakPos.z, radius: 8000, height: 5000 }]);
const sim = createTestSim({ seed: 17, terrain });

const R73 = testWeapon({
  id: 'R-73',
  category: 'aam_ir',
  users: ['WARSAW'],
  guidance: { type: 'ir', seekerRangeKm: 15, gimbalDeg: 60, offBoresightDeg: 60, navConstant: 4, ccm: 0.4 },
  motor: { boostSec: 2, boostThrustN: 20_000, sustainSec: 1, sustainThrustN: 5000, smoke: 'medium' },
});
const R77 = testWeapon({
  id: 'R-77',
  category: 'aam_radar',
  users: ['WARSAW'],
  guidance: { type: 'active_radar', seekerRangeKm: 15, gimbalDeg: 60, offBoresightDeg: 60, navConstant: 4, ccm: 0.4, datalink: true },
});

const player = new TestAircraft(sim, {
  faction: 'NATO',
  isPlayer: true,
  name: 'F-15EX Eagle II',
  position: [0, 9000, 0],
  heading: 0,
  speed: 250,
  sensors: {
    // ECCM 이 낮은 AESA (APG-63(V)3 급) — 재밍 효과가 잘 보이도록
    radar: { ...SAMPLE_RADAR.aesa, eccm: 0.25 },
    irst: SAMPLE_IRST,
    rwr: SAMPLE_RWR.modern,
    maw: SAMPLE_MAW.full,
    ew: SAMPLE_EW.towed,
    datalink: SAMPLE_DATALINK,
    helmet: SAMPLE_HELMET,
  },
  weapon: SAMPLE_WEAPONS.aim120d,
});
player.callsign = 'Vanguard 1';
player.moving = false;

interface Actor {
  e: Entity;
  /** 시나리오 역할 (화면 설명) */
  role: string;
}
const actors: Actor[] = [];

function air(role: string, name: string, faction: Faction, bearing: number, rangeKm: number, alt: number, heading: number, o: Partial<TestAircraftOptions> = {}): TestAircraft {
  const ac = new TestAircraft(sim, { faction, name, position: polar(bearing, rangeKm * 1000, alt), heading, speed: 250, ...o });
  ac.moving = false;
  actors.push({ e: ac, role });
  return ac;
}

const su35 = air('STT 로 우리를 추적', 'Su-35S Flanker-E', 'WARSAW', -20, 120, 9000, 160, { sensors: { radar: SAMPLE_RADAR.pesa } });
const su27 = air('윙맨이 탐지 → 데이터링크', 'Su-27S Flanker-B', 'WARSAW', -5, 235, 9000, 175);
const wing = air('아군 (Link 16)', 'F-16P Viper', 'NATO', 0, 130, 9000, 0, { sensors: { radar: { ...SAMPLE_RADAR.aesa, rangeKm: 120 }, datalink: SAMPLE_DATALINK } });
wing.callsign = 'Vanguard 2';
const xfFar = air('스텔스 (40 km)', 'XF-1 Lampyris', 'PAX', 25, 40, 9000, 205, { rcs: 0.0005 });
const xfNear = air('스텔스 (9 km)', 'XF-1 Lampyris', 'PAX', -35, 9, 9000, 145, { rcs: 0.0005 });
const jamFar = air('재밍 중 (120 km)', 'Su-30MKK Flanker-G', 'WARSAW', 30, 120, 9000, 210, { sensors: { ew: SAMPLE_EW.strong } });
const jamNear = air('재밍 중 (70 km, 번스루)', 'Su-30MKK Flanker-G', 'WARSAW', 42, 70, 9000, 222, { sensors: { ew: SAMPLE_EW.strong } });
jamFar.avionics.jammerActive = true;
jamNear.avionics.jammerActive = true;
const notcher = air('저고도 빔 기동 (노치)', 'MiG-29S Fulcrum-C', 'WARSAW', 10, 50, 400, 100);
const masked = air('산 뒤 저고도', 'Su-30MKK Flanker-G', 'WARSAW', -40, 60, 800, 140);

const sa10 = new TestUnit(sim, { faction: 'WARSAW', name: 'SA-10 레이더', position: polar(62, 80_000, 0), tags: ['target'] });
sa10.emission = { mode: 'search', rangeM: 150_000, azimuthDeg: 180, lpi: 0, trackedIds: [], label: 'SA-10' };
actors.push({ e: sa10, role: '미션 표적 · 탐색 레이더 방사' });

// 미사일 (정지시켜 두되 속도는 유지 — 접근 판정용)
function missile(role: string, def: typeof R73, bearing: number, rangeM: number, speed: number, o: Partial<ConstructorParameters<typeof TestMissile>[1]> = {}): TestMissile {
  const from = polar(bearing, rangeM, 9000);
  const v = new THREE.Vector3().subVectors(player.position, from).normalize().multiplyScalar(speed);
  const m = new TestMissile(sim, { def, shooter: null, target: player, position: from, velocity: v, faction: 'WARSAW', ...o });
  m.moving = false;
  actors.push({ e: m, role });
  return m;
}
const r77 = missile('R-77 능동 시커 (RWR)', R77, 35, 12_000, 1100, { seekerActive: true, timeOfFlight: 25, burnSec: 0 });
const r73Coast = missile('R-73 연소 종료 (MAW 미탐지)', R73, 100, 5000, 650, { timeOfFlight: 12, burnSec: 3 });

stepSim(sim, 2);
su35.avionics.designate(player);
su35.avionics.setRadarMode('stt');
const r73 = missile('R-73 연소 중 (MAW)', R73, 205, 4000, 700, { burnSec: 8 });
stepSim(sim, 2.5);

// ---------------------------------------------------------------- 그리기

const canvas = document.getElementById('view') as HTMLCanvasElement;
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d')!;
const av: AircraftAvionics = player.avionics;

const COLORS = {
  bg: '#070b10',
  grid: '#1b2633',
  gridText: '#4d6275',
  hostile: '#ff5a4f',
  friendly: '#5aa8ff',
  neutral: '#c8c8c8',
  undetected: '#5b6570',
  radar: '#4dff88',
  irst: '#ffae3d',
  visual: '#4de8ff',
  datalink: '#8f8cff',
  text: '#d7e2ec',
  dim: '#8796a5',
  warn: '#ff4a4a',
  mountain: '#5a4630',
};
const SOURCE_COLOR: Record<Track['source'], string> = { radar: COLORS.radar, irst: COLORS.irst, visual: COLORS.visual, datalink: COLORS.datalink };
const SOURCE_NAME: Record<Track['source'], string> = { radar: '레이더', irst: 'IRST', visual: '육안', datalink: '데이터링크' };
const KIND_NAME: Record<Threat['kind'], string> = { search: '탐색', track: '추적', launch: '발사', missile: '미사일' };
const KIND_COLOR: Record<Threat['kind'], string> = { search: '#ffe066', track: '#ff9b3d', launch: '#ff4a4a', missile: '#ff3dd0' };

function font(px: number, bold = false): string {
  return `${bold ? 'bold ' : ''}${px}px ${FONT}`;
}
const km = (m: number) => (m / 1000).toFixed(m < 10_000 ? 1 : 0);

interface View {
  cx: number;
  cy: number;
  /** px per m */
  s: number;
  clip: [number, number, number, number];
}
const wide: View = { cx: 360, cy: 655, s: 2.55 / 1000, clip: [0, 0, 720, H] };
const close: View = { cx: 1000, cy: 238, s: 12.5 / 1000, clip: [722, 0, 558, 478] };

function toScreen(v: View, p: THREE.Vector3): [number, number] {
  return [v.cx + (p.x - player.position.x) * v.s, v.cy + (p.z - player.position.z) * v.s];
}

function headingOfEntity(e: Entity): number {
  const f = e.getForward(new THREE.Vector3());
  if (e.kind === 'missile') f.copy(e.velocity).normalize();
  return Math.atan2(f.x, -f.z);
}

function drawAircraftIcon(x: number, y: number, headingRad: number, color: string, size = 7): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(headingRad);
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.3);
  ctx.lineTo(size * 0.85, size);
  ctx.lineTo(0, size * 0.45);
  ctx.lineTo(-size * 0.85, size);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawMissileIcon(x: number, y: number, headingRad: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(headingRad);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(0, 6);
  ctx.moveTo(-3, 5);
  ctx.lineTo(3, 5);
  ctx.stroke();
  ctx.restore();
}

function drawBracket(x: number, y: number, r: number, color: string, double = false): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  const k = r * 0.45;
  const box = (rr: number) => {
    const kk = rr * 0.45;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x + sx * rr, y + sy * (rr - kk));
      ctx.lineTo(x + sx * rr, y + sy * rr);
      ctx.lineTo(x + sx * (rr - kk), y + sy * rr);
      ctx.stroke();
    }
  };
  void k;
  box(r);
  if (double) box(r + 4);
}

function label(x: number, y: number, lines: Array<[string, string]>, size = 12): void {
  ctx.font = font(size);
  ctx.textBaseline = 'top';
  let yy = y;
  for (const [text, color] of lines) {
    ctx.fillStyle = 'rgba(7,11,16,0.75)';
    const w = ctx.measureText(text).width;
    ctx.fillRect(x - 2, yy - 1, w + 4, size + 3);
    ctx.fillStyle = color;
    ctx.fillText(text, x, yy);
    yy += size + 3;
  }
}

function factionColor(e: Entity): string {
  if (e.faction === player.faction) return COLORS.friendly;
  return sim.relations.isHostile(player.faction, e.faction) ? COLORS.hostile : COLORS.neutral;
}

/** 우리 레이더가 이 표적을 왜 보거나 못 보는지 */
function radarReason(e: Entity): string {
  if (e.kind === 'missile') return '';
  if (e.kind !== 'aircraft') return '공중 모드: 지상 탐지 안 함';
  if (e.faction === player.faction) return '';
  const a = av.assessRadar(e, sim);
  if (!a.inVolume) return '스캔 범위 밖';
  if (a.masked) return '지형 차폐';
  if (a.notched) return '도플러 노치';
  if (a.jammed && a.distanceM > a.rangeM) return `재밍: 번스루 ${km(a.rangeM)} km (원래 ${km(a.unjammedRangeM)} km)`;
  if (a.jammed) return `재밍 중이나 번스루 (${km(a.rangeM)} km 안)`;
  if (a.distanceM > a.rangeM) return e.rcs < 0.05 ? `스텔스: 탐지거리 ${km(a.rangeM)} km` : `거리 밖: 탐지거리 ${km(a.rangeM)} km`;
  return `탐지 가능 (탐지거리 ${km(a.rangeM)} km)`;
}

function drawGridWide(): void {
  const v = wide;
  ctx.save();
  ctx.beginPath();
  ctx.rect(...v.clip);
  ctx.clip();
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.font = font(11);
  ctx.fillStyle = COLORS.gridText;
  for (let r = 50; r <= 250; r += 50) {
    ctx.beginPath();
    ctx.arc(v.cx, v.cy, r * 1000 * v.s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(`${r} km`, v.cx + 4, v.cy - r * 1000 * v.s + 2);
  }
  for (let b = -90; b <= 90; b += 30) {
    const t = (b * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(v.cx, v.cy);
    ctx.lineTo(v.cx + Math.sin(t) * 700, v.cy - Math.cos(t) * 700);
    ctx.stroke();
  }

  // 산
  const [mx, my] = toScreen(v, peakPos);
  ctx.fillStyle = COLORS.mountain;
  ctx.beginPath();
  ctx.arc(mx, my, 8000 * v.s, 0, Math.PI * 2);
  ctx.fill();
  label(mx - 34, my + 22, [['산 (5000 m)', '#b89b74']], 11);

  // 레이더 스캔 볼륨 (TWS, 5 m² 공칭 탐지거리)
  const radar = player.stats.radar!;
  const R = av.radarRangeM * v.s;
  const a0 = -Math.PI / 2 - (radar.azimuthDeg * Math.PI) / 180;
  const a1 = -Math.PI / 2 + (radar.azimuthDeg * Math.PI) / 180;
  ctx.fillStyle = 'rgba(77,255,136,0.07)';
  ctx.strokeStyle = 'rgba(77,255,136,0.5)';
  ctx.beginPath();
  ctx.moveTo(v.cx, v.cy);
  ctx.arc(v.cx, v.cy, R, a0, a1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 현재 빔 방위
  const scan = av.scanAzimuthDeg;
  if (scan !== null) {
    const t = (scan * Math.PI) / 180;
    ctx.strokeStyle = 'rgba(77,255,136,0.9)';
    ctx.beginPath();
    ctx.moveTo(v.cx, v.cy);
    ctx.lineTo(v.cx + Math.sin(t) * R, v.cy - Math.cos(t) * R);
    ctx.stroke();
  }
  label(v.cx + Math.sin(a1 + Math.PI / 2) * R - 150, v.cy - R - 18, [[`레이더 ${av.radarMode.toUpperCase()} · 5㎡ 탐지 ${km(av.radarRangeM)} km`, COLORS.radar]], 12);

  // 스텔스 탐지거리 (0.0005 ㎡)
  const stealthR = av.assessRadar(xfFar, sim).rangeM * v.s;
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(255,90,79,0.6)';
  ctx.beginPath();
  ctx.arc(v.cx, v.cy, stealthR, a0, a1);
  ctx.stroke();
  // 재밍 번스루 거리
  const jamR = av.assessRadar(jamFar, sim).rangeM * v.s;
  ctx.strokeStyle = 'rgba(255,174,61,0.7)';
  ctx.beginPath();
  ctx.arc(v.cx, v.cy, jamR, -Math.PI / 2 + (15 * Math.PI) / 180, -Math.PI / 2 + (55 * Math.PI) / 180);
  ctx.stroke();
  ctx.setLineDash([]);
  label(v.cx + Math.sin((50 * Math.PI) / 180) * jamR + 4, v.cy - Math.cos((50 * Math.PI) / 180) * jamR - 4, [['번스루 거리', COLORS.irst]], 11);
  ctx.restore();
}

function trackFor(e: Entity): Track | null {
  return av.trackOf(e);
}

function drawEntitiesWide(): void {
  const v = wide;
  ctx.save();
  ctx.beginPath();
  ctx.rect(...v.clip);
  ctx.clip();

  // 데이터링크: 윙맨 → 윙맨이 공유한 트랙
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(143,140,255,0.55)';
  for (const t of wing.avionics.tracks) {
    if (t.source === 'datalink' || t.entity === player) continue;
    const mine = trackFor(t.entity);
    if (!mine || mine.source !== 'datalink') continue;
    const [ax, ay] = toScreen(v, wing.position);
    const [bx, by] = toScreen(v, t.entity.position);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const { e, role } of actors) {
    if (e.kind === 'missile') continue;
    const [x, y] = toScreen(v, e.position);
    const t = trackFor(e);
    const col = t ? factionColor(e) : COLORS.undetected;
    if (e.kind === 'aircraft') drawAircraftIcon(x, y, headingOfEntity(e), col);
    else {
      ctx.fillStyle = col;
      ctx.fillRect(x - 5, y - 5, 10, 10);
    }
    if (t) drawBracket(x, y, 11, SOURCE_COLOR[t.source], av.target?.entity === e);
    else {
      ctx.strokeStyle = COLORS.undetected;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const lines: Array<[string, string]> = [[`${shortLabel(e.name)}${e.callsign ? ` ${e.callsign}` : ''} — ${role}`, factionColor(e)]];
    lines.push(t ? [`트랙: ${SOURCE_NAME[t.source]} · 품질 ${t.quality.toFixed(2)}${t.identified ? ' · 식별' : ''}`, SOURCE_COLOR[t.source]] : ['트랙 없음', COLORS.undetected]);
    const why = radarReason(e);
    if (why) lines.push([`레이더: ${why}`, COLORS.dim]);
    if (av.target?.entity === e) {
      const lk = av.lockState(SAMPLE_WEAPONS.aim120d, sim);
      lines.push([`지정 표적 · AIM-120D ${lk.status === 'locked' ? '락 완료' : `락 ${Math.round(lk.progress * 100)}%`}`, COLORS.warn]);
    }
    const lx = x > 520 ? x - 225 : x + 15;
    label(lx, y - 10, lines, 11);
  }

  // 플레이어
  drawAircraftIcon(v.cx, v.cy, 0, '#ffffff', 8);
  label(v.cx + 12, v.cy - 6, [['Vanguard 1 (F-15EX)', '#ffffff']], 12);
  ctx.restore();
}

function drawClose(): void {
  const v = close;
  const [x0, y0, w, h] = v.clip;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.fillStyle = '#0a1018';
  ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = COLORS.grid;
  ctx.font = font(11);
  ctx.fillStyle = COLORS.gridText;
  for (const r of [5, 10, 15]) {
    ctx.beginPath();
    ctx.arc(v.cx, v.cy, r * 1000 * v.s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(`${r} km`, v.cx + 3, v.cy - r * 1000 * v.s + 2);
  }
  // 육안 탐지 범위 (전반구 7 km, 후반구 3 km)
  ctx.beginPath();
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const r = visualAirRange(Math.cos(a), 8) * v.s;
    const px = v.cx + Math.sin(a) * r;
    const py = v.cy - Math.cos(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.fillStyle = 'rgba(77,232,255,0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(77,232,255,0.45)';
  ctx.stroke();
  label(v.cx + 6, v.cy - 7000 * v.s - 16, [['육안 7 km (후방 3 km)', COLORS.visual]], 11);

  // 엔티티
  for (const { e, role } of actors) {
    const d = e.position.distanceTo(player.position);
    if (d > 17_000) continue;
    const [x, y] = toScreen(v, e.position);
    const threat = av.threats.find((t) => t.source === e);
    if (e.kind === 'missile') {
      drawMissileIcon(x, y, headingOfEntity(e), threat ? KIND_COLOR.missile : COLORS.undetected);
      const lines: Array<[string, string]> = [[role, threat ? COLORS.text : COLORS.undetected]];
      if (threat) {
        const parts = [`${threat.detectedBy.toUpperCase()} 감지`];
        if (threat.rangeM !== null) parts.push(`거리 ≈${km(threat.rangeM)} km`);
        if (threat.timeToImpact !== null) parts.push(`충돌 ${threat.timeToImpact.toFixed(1)} s`);
        lines.push([parts.join(' · '), KIND_COLOR.missile]);
      } else lines.push(['경고 없음', COLORS.undetected]);
      label(x > v.cx ? x + 10 : x - 190, y - 8, lines, 11);
    } else if (e.kind === 'aircraft') {
      const t = trackFor(e);
      drawAircraftIcon(x, y, headingOfEntity(e), t ? factionColor(e) : COLORS.undetected);
      if (t) drawBracket(x, y, 10, SOURCE_COLOR[t.source]);
      label(x + 12, y - 8, [[`${shortLabel(e.name)} — ${role}`, factionColor(e)], [t ? `트랙: ${SOURCE_NAME[t.source]}` : '트랙 없음', t ? SOURCE_COLOR[t.source] : COLORS.undetected]], 11);
    }
  }
  // 견인 디코이
  for (const e of sim.world.entities) {
    if (!(e instanceof TowedDecoy) || e.removed) continue;
    const [x, y] = toScreen(v, e.position);
    const [px, py] = toScreen(v, player.position);
    ctx.strokeStyle = '#9aa7b4';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = '#ffd34d';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  drawAircraftIcon(v.cx, v.cy, 0, '#ffffff', 8);

  // RWR/MAW 링: 기수 위쪽 기준 상대 방위
  const ringR = 16_200 * v.s;
  ctx.strokeStyle = '#33465a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(v.cx, v.cy, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  for (const t of av.threats) {
    const a = (t.bearingDeg * Math.PI) / 180;
    const px = v.cx + Math.sin(a) * ringR;
    const py = v.cy - Math.cos(a) * ringR;
    ctx.fillStyle = KIND_COLOR[t.kind];
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = font(11, true);
    const txt = `${KIND_NAME[t.kind]} ${t.label}`;
    const tw = ctx.measureText(txt).width;
    const lx = Math.sin(a) >= 0 ? px + 9 : px - 9 - tw;
    label(lx, py - 6, [[txt, KIND_COLOR[t.kind]]], 11);
  }
  label(x0 + 8, y0 + 6, [['근접 (반경 16 km) · RWR/MAW 위협 방위 링', COLORS.text]], 12);
  ctx.restore();
}

function drawStatus(): void {
  const x = 732;
  let y = 488;
  ctx.fillStyle = '#0b121b';
  ctx.fillRect(722, 480, 558, 240);
  const line = (text: string, color = COLORS.text, size = 12) => {
    ctx.font = font(size);
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.fillText(text, x, y);
    y += size + 4;
  };
  const em = player.emission;
  const lk = av.lockState(SAMPLE_WEAPONS.aim120d, sim);
  line(`레이더 ${av.radarMode.toUpperCase()} · 방사 ${em ? `${em.mode} (${em.label}, LPI ${em.lpi})` : '없음'} · 견인 디코이 ${av.towedDecoysRemaining}/${SAMPLE_EW.towed.towedDecoys}${av.towedDecoyDeployed ? ' (전개)' : ''}`, COLORS.text, 13);
  line(`지정: ${av.target ? `${shortLabel(av.target.entity.name)} ${km(av.target.rangeM)} km` : '없음'} · AIM-120D 락: ${lk.status} ${Math.round(lk.progress * 100)}% · 미사일 경보: ${av.missileWarning ? '예' : '아니오'}`, av.missileWarning ? COLORS.warn : COLORS.text, 13);
  y += 2;
  line(`트랙 ${av.tracks.length}개`, COLORS.dim);
  const tracks = [...av.tracks].sort((a, b) => a.rangeM - b.rangeM).slice(0, 7);
  for (const t of tracks) {
    line(
      `  ${SOURCE_NAME[t.source].padEnd(5, ' ')} ${shortLabel(t.entity.name).padEnd(10, ' ')} ${km(t.rangeM).padStart(5, ' ')} km  품질 ${t.quality.toFixed(2)} ${t.hostile ? '적' : '아군/중립'}${t.identified ? ' 식별' : ''}`,
      SOURCE_COLOR[t.source],
      11,
    );
  }
  line(`위협 ${av.threats.length}개`, COLORS.dim);
  for (const t of av.threats) {
    const extra = [t.rangeM !== null ? `${km(t.rangeM)} km` : '', t.timeToImpact !== null ? `TTI ${t.timeToImpact.toFixed(1)} s` : ''].filter(Boolean).join(' ');
    line(`  ${KIND_NAME[t.kind]} ${t.label.padEnd(8, ' ')} 방위 ${t.bearingDeg.toFixed(0).padStart(4, ' ')}°  ${t.detectedBy.toUpperCase()} ${extra}`, KIND_COLOR[t.kind], 11);
  }
}

function drawLegend(): void {
  const items: Array<[string, string]> = [
    ['레이더', COLORS.radar],
    ['IRST', COLORS.irst],
    ['육안', COLORS.visual],
    ['데이터링크', COLORS.datalink],
    ['미탐지', COLORS.undetected],
  ];
  let x = 10;
  ctx.font = font(12);
  ctx.textBaseline = 'top';
  for (const [name, c] of items) {
    ctx.strokeStyle = c;
    ctx.strokeRect(x, 10, 12, 12);
    ctx.fillStyle = c;
    ctx.fillText(name, x + 16, 9);
    x += ctx.measureText(name).width + 34;
  }
  ctx.fillStyle = COLORS.text;
  ctx.font = font(14, true);
  ctx.fillText('T.N.A. 센서 샌드박스 — 광역 (북쪽 위)', 10, 30);
}

function render(): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  drawGridWide();
  drawEntitiesWide();
  drawLegend();
  drawClose();
  drawStatus();
}

render();

// ---------------------------------------------------------------- 검증 보고 (tools/shot.mjs 가 stdout 으로 출력)

const report = {
  time: +sim.time.toFixed(2),
  radarMode: av.radarMode,
  emission: player.emission ? { mode: player.emission.mode, trackedIds: [...player.emission.trackedIds] } : null,
  designated: av.target ? shortLabel(av.target.entity.name) : null,
  lock: av.lockState(SAMPLE_WEAPONS.aim120d, sim).status,
  missileWarning: av.missileWarning,
  towedDecoysRemaining: av.towedDecoysRemaining,
  actors: actors.map(({ e, role }) => ({
    role,
    track: trackFor(e)?.source ?? null,
    radar: radarReason(e),
    threat: av.threats.find((t) => t.source === e)?.kind ?? null,
  })),
  threats: av.threats.map((t) => ({ kind: t.kind, label: t.label, bearing: Math.round(t.bearingDeg), by: t.detectedBy, range: t.rangeM && Math.round(t.rangeM), tti: t.timeToImpact && +t.timeToImpact.toFixed(1) })),
  enemyStt: su35.emission?.mode,
  ids: { su27: su27.id, wing: wing.id, xfNear: xfNear.id, jamNear: jamNear.id, notcher: notcher.id, masked: masked.id, r77: r77.id, r73: r73.id, r73Coast: r73Coast.id },
};
(window as unknown as { __report: unknown }).__report = report;
(window as unknown as { __ready: boolean }).__ready = true;
