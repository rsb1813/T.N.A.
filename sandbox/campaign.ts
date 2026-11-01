// 캠페인 샌드박스: 플레이 가능한 미션마다 브리핑 마커, 스크립트가 실제로 스폰한 위치(헤드리스 완주),
// 런타임 마커(웨이포인트·보급 구역)를 맵 반경 위에 2D 로 그려 배치를 점검한다.
import { headingToDir } from '../src/core/math';
import type { Faction } from '../src/core/types';
import { availableMissions, createSkirmish, type LiveMarker, type MarkerKind, type MissionDef } from '../src/campaign';
import { dryRunMission } from '../src/campaign/headless';

const SIZE = 640;
const HEADER = 54;
const FONT = "'WenQuanYi Zen Hei', 'Noto Sans KR', sans-serif";

const FACTION_COLOR: Record<Faction, string> = {
  NATO: '#4da3ff',
  PAX: '#ff5a5a',
  WARSAW: '#ff9f40',
  WON: '#45d483',
  NEUTRAL: '#b8b8b8',
};
const MARKER_COLOR: Record<MarkerKind, string> = {
  friendly: '#4da3ff',
  enemy: '#ff5a5a',
  target: '#ffd84d',
  objective: '#c590ff',
};

interface Report {
  id: string;
  success: boolean;
  rank: string;
  score: number;
  kills: number;
  timeSec: number;
  radioLines: number;
  aircraft: number;
  units: number;
  outsideMap: number;
}

function drawMission(def: MissionDef): Report {
  const live = new Map<number, LiveMarker>();
  const run = dryRunMission(def, {
    onStep: (runner) => {
      for (const m of runner.markers) live.set(m.id, m);
    },
  });
  const R = def.environment.mapRadius ?? 100_000;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE + HEADER;
  document.getElementById('grid')!.appendChild(canvas);
  const g = canvas.getContext('2d')!;
  const cx = SIZE / 2;
  const cy = HEADER + SIZE / 2;
  const s = (SIZE / 2 - 12) / R;
  const X = (x: number) => cx + x * s;
  const Y = (z: number) => cy + z * s;

  // 맵 원과 바다
  g.save();
  g.beginPath();
  g.arc(cx, cy, R * s, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = def.environment.biome === 'ocean' ? '#0d2a44' : '#1b2418';
  g.fillRect(0, HEADER, SIZE, SIZE);
  const c = def.environment.coast;
  if (c) {
    g.fillStyle = '#0d2a44';
    const d = c.distanceM;
    if (c.side === 'east') g.fillRect(X(d), HEADER, SIZE, SIZE);
    if (c.side === 'west') g.fillRect(0, HEADER, X(-d), SIZE);
    if (c.side === 'south') g.fillRect(0, Y(d), SIZE, SIZE);
    if (c.side === 'north') g.fillRect(0, HEADER, SIZE, Y(-d) - HEADER);
  }
  // 20 km 격자
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 1;
  for (let k = -R; k <= R; k += 20_000) {
    g.beginPath();
    g.moveTo(X(k), HEADER);
    g.lineTo(X(k), HEADER + SIZE);
    g.moveTo(0, Y(k));
    g.lineTo(SIZE, Y(k));
    g.stroke();
  }
  for (const city of def.environment.cities ?? []) {
    g.fillStyle = 'rgba(200,200,200,0.25)';
    g.beginPath();
    g.arc(X(city.x), Y(city.z), Math.max(2, city.radius * s), 0, Math.PI * 2);
    g.fill();
  }
  for (const f of def.environment.flatten ?? []) {
    g.setLineDash([2, 3]);
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.beginPath();
    g.arc(X(f.x), Y(f.z), Math.max(2, f.radius * s), 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  for (const ab of def.environment.airbases ?? []) {
    const dir = headingToDir(ab.heading);
    g.strokeStyle = FACTION_COLOR[ab.faction];
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(X(ab.x - dir.x * 1500), Y(ab.z - dir.z * 1500));
    g.lineTo(X(ab.x + dir.x * 1500), Y(ab.z + dir.z * 1500));
    g.stroke();
    g.lineWidth = 1;
  }
  g.restore();
  g.strokeStyle = '#3d5266';
  g.beginPath();
  g.arc(cx, cy, R * s, 0, Math.PI * 2);
  g.stroke();

  // 브리핑 마커 (위협 반경 포함)
  g.font = `11px ${FONT}`;
  for (const m of def.briefing.mapMarkers) {
    const col = MARKER_COLOR[m.kind];
    if (m.radius) {
      g.strokeStyle = col + '66';
      g.setLineDash([6, 4]);
      g.beginPath();
      g.arc(X(m.x), Y(m.z), m.radius * s, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(X(m.x), Y(m.z) - 6);
    g.lineTo(X(m.x) + 6, Y(m.z));
    g.lineTo(X(m.x), Y(m.z) + 6);
    g.lineTo(X(m.x) - 6, Y(m.z));
    g.closePath();
    g.fill();
    g.fillText(m.label, X(m.x) + 8, Y(m.z) - 6);
  }

  // 런타임 마커
  for (const m of live.values()) {
    g.strokeStyle = MARKER_COLOR[m.kind];
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(X(m.x), Y(m.z), Math.max(4, (m.radius ?? 500) * s), 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 1;
    g.fillStyle = MARKER_COLOR[m.kind];
    g.fillText(m.label, X(m.x) + 6, Y(m.z) + 14);
  }

  // 스폰 위치
  let outside = 0;
  for (const req of run.recorder.ground) {
    if (Math.hypot(req.position.x, req.position.z) > R) outside++;
    g.fillStyle = FACTION_COLOR[req.faction];
    const target = req.tags?.includes('target');
    const sz = target ? 4 : 3;
    g.fillRect(X(req.position.x) - sz / 2, Y(req.position.z) - sz / 2, sz, sz);
  }
  for (const req of run.recorder.aircraft) {
    if (Math.hypot(req.position.x, req.position.z) > R) outside++;
    const dir = headingToDir(req.heading);
    const px = X(req.position.x);
    const py = Y(req.position.z);
    const player = req.controller === 'player';
    const L = player ? 14 : 8;
    g.fillStyle = player ? '#ffffff' : FACTION_COLOR[req.faction];
    g.beginPath();
    g.moveTo(px + dir.x * L, py + dir.z * L);
    g.lineTo(px - dir.x * L * 0.5 - dir.z * L * 0.45, py - dir.z * L * 0.5 + dir.x * L * 0.45);
    g.lineTo(px - dir.x * L * 0.5 + dir.z * L * 0.45, py - dir.z * L * 0.5 - dir.x * L * 0.45);
    g.closePath();
    g.fill();
    if (req.callsign && /( 1$|^Regalia|^Kifaru 1|^Unknown|^Aggressor)/.test(req.callsign)) {
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.font = `10px ${FONT}`;
      g.fillText(req.callsign, px + 7, py + 3);
      g.font = `11px ${FONT}`;
    }
  }

  // 머리글
  const r = run.result;
  g.fillStyle = '#e8eef5';
  g.font = `bold 15px ${FONT}`;
  g.fillText(`${def.id.toUpperCase()}  ${def.title} — ${def.subtitle}`, 10, 20);
  g.font = `12px ${FONT}`;
  g.fillStyle = '#9fb3c6';
  const mm = Math.floor(r.timeSec / 60);
  const ss = String(Math.round(r.timeSec % 60)).padStart(2, '0');
  g.fillText(
    `${def.date} · ${def.location} · ${def.environment.biome} ${def.environment.timeOfDay}시 · 반경 ${R / 1000} km`,
    10,
    37,
  );
  g.fillStyle = r.success ? '#7ee08a' : '#ff7b7b';
  g.fillText(
    `헤드리스 완주: ${r.success ? '성공' : '실패'} ${r.rank} · ${r.score}점 · 격추 ${r.totalKills} · ${mm}:${ss} · 무전 ${run.radio.length}줄 · 스폰 기체 ${run.recorder.aircraft.length} / 지상 ${run.recorder.ground.length}${outside ? ` · 맵 밖 ${outside}` : ''}`,
    10,
    51,
  );
  return {
    id: def.id,
    success: r.success,
    rank: r.rank,
    score: r.score,
    kills: r.totalKills,
    timeSec: Math.round(r.timeSec),
    radioLines: run.radio.length,
    aircraft: run.recorder.aircraft.length,
    units: run.recorder.ground.length,
    outsideMap: outside,
  };
}

const params = new URLSearchParams(location.search);
const only = params.get('mission');
const defs = availableMissions().filter((m) => !only || m.id === only);
if (params.has('skirmish')) {
  defs.push(createSkirmish({ biome: 'desert', enemyFaction: 'WARSAW', enemyCount: 10, skill: 'veteran', includeGround: true, seed: Number(params.get('skirmish')) || 42 }));
}
const report = defs.map(drawMission);
(window as unknown as { __report: unknown }).__report = report;
(window as unknown as { __ready: boolean }).__ready = true;
