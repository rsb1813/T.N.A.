// 캠페인 구성: 4막 21미션 (m00 튜토리얼 포함).
import type { GameDatabase } from '../data/schema';
import type { Campaign, MissionDef } from './missionTypes';
import { M00 } from './missions/m00';
import { M01 } from './missions/m01';
import { M02 } from './missions/m02';
import { M03 } from './missions/m03';
import { M04, M05, M06, M07, M08, M09, M10, M11, M12, M13, M14, M15, M16, M17, M18, M19, M20 } from './missions/planned';

export const CAMPAIGN: Campaign = {
  acts: [
    { id: 1, title: '제1막 · 대리인의 땅', subtitle: '동아프리카, 2000년 3~4월', missions: [M00, M01, M02, M03, M04, M05] },
    { id: 2, title: '제2막 · 모래 위의 휴전', subtitle: '중동, 2000년 6~7월', missions: [M06, M07, M08, M09, M10] },
    { id: 3, title: '제3막 · 완충지대', subtitle: '한반도 북부, 2000년 8~10월', missions: [M11, M12, M13, M14, M15] },
    { id: 4, title: '제4막 · 대관식', subtitle: '독일, 2000년 11~12월', missions: [M16, M17, M18, M19, M20] },
  ],
};

/** 캠페인 순서대로 모든 미션 */
export const ALL_MISSIONS: readonly MissionDef[] = CAMPAIGN.acts.flatMap((a) => a.missions);

export function getMission(id: string): MissionDef | null {
  return ALL_MISSIONS.find((m) => m.id === id) ?? null;
}

/** 플레이 가능한(개발 완료) 미션 */
export function availableMissions(): MissionDef[] {
  return ALL_MISSIONS.filter((m) => m.available);
}

/** 미션 다음 순서 (마지막이면 null) */
export function nextMission(id: string): MissionDef | null {
  const i = ALL_MISSIONS.findIndex((m) => m.id === id);
  return i >= 0 && i + 1 < ALL_MISSIONS.length ? ALL_MISSIONS[i + 1] : null;
}

/** 미션에 등장하는 기체 id (윙맨 + roster) */
export function missionAircraftIds(def: MissionDef): string[] {
  return [...new Set([...def.wingmen.map((w) => w.aircraftId), ...(def.roster?.aircraft ?? [])])];
}

/** preloadModels() 에 넘길 모델 id (플레이어 기체·무장 모델은 통합 쪽에서 추가) */
export function missionModelIds(def: MissionDef, db: GameDatabase): string[] {
  const out = new Set<string>();
  for (const id of missionAircraftIds(def)) out.add(db.aircraft[id]?.model ?? id);
  for (const id of def.roster?.units ?? []) out.add(db.units[id]?.model ?? id);
  return [...out];
}
