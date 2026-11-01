// 맵 환경 정의. src/world 가 구현하고 src/campaign 의 미션이 사용한다.
import type { System } from './game';
import type { TerrainService } from './services';
import type { Faction } from './types';
import type * as THREE from 'three';

export type BiomeId =
  | 'desert' // 사하라/중동 사막
  | 'savanna' // 동아프리카
  | 'jungle' // 서아프리카/중부
  | 'mountains' // 한반도/알프스 산악
  | 'temperate' // 독일 평원/숲
  | 'arctic' // 북극/스칸디나비아
  | 'ocean' // 대양 (섬 약간)
  | 'wasteland'; // 핵으로 폐허가 된 동남아

export type Weather = 'clear' | 'scattered' | 'overcast' | 'storm';

export interface EnvironmentOptions {
  biome: BiomeId;
  seed: number;
  /** 시각 0..24 (태양 위치/하늘색) */
  timeOfDay: number;
  weather: Weather;
  /** 플레이 영역 반경 (m). 기본 100km. 밖은 경계 경고 */
  mapRadius?: number;
  /** 지형 기복 배율 (0.2 = 평탄 ~ 2 = 험준). 기본 1 */
  relief?: number;
  /** 해안선: 해당 방향 distanceM 너머는 바다 */
  coast?: { side: 'north' | 'south' | 'east' | 'west'; distanceM: number };
  /** 평탄화 구역 (기지, 표적 지역) */
  flatten?: Array<{ x: number; z: number; radius: number; height?: number }>;
  /** 장식용 비행장 (활주로/격납고 시각 요소) */
  airbases?: Array<{ x: number; z: number; heading: number; faction: Faction; name?: string }>;
  /** 장식용 도시 (건물 인스턴싱) */
  cities?: Array<{ x: number; z: number; radius: number; density?: number }>;
}

export interface Environment extends TerrainService, System {
  readonly options: EnvironmentOptions;
  /** 태양 방향 (월드, 정규화) — 섬광/플레어 기만 계산에도 사용 */
  readonly sunDirection: THREE.Vector3;
  dispose(): void;
}
