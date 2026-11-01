// 모든 시뮬레이션 객체의 기반 클래스.
import * as THREE from 'three';
import type { Sim } from './sim';
import type { DamageInfo, EntityKind, Faction, RadarEmission, TargetClass } from './types';

let NEXT_ID = 1;

export abstract class Entity {
  readonly id: number = NEXT_ID++;
  abstract readonly kind: EntityKind;

  faction: Faction;
  /** 표시 이름 (예: 'Su-35S', 'SA-10 발사대') */
  name: string;
  /** 무전/HUD 용 콜사인 (예: 'Lancer 2'). 없으면 null */
  callsign: string | null = null;
  targetClass: TargetClass = 'air';

  readonly position = new THREE.Vector3();
  /** 월드 속도 m/s */
  readonly velocity = new THREE.Vector3();
  /** 자세. 기수 = 로컬 -Z */
  readonly quaternion = new THREE.Quaternion();
  /** 렌더링 객체. World.add 시 씬에 추가되고 syncObject() 로 위치/자세가 반영된다 */
  object3d: THREE.Object3D = new THREE.Group();

  /** false = 파괴됨 (잔해 연출 동안 월드에 남아 있을 수 있음) */
  alive = true;
  /** true 가 되면 World 가 다음 스텝에 제거한다 */
  removed = false;
  hp = 100;
  maxHp = 100;
  /** 충돌/근접신관 반경 (m) */
  radius = 5;
  /** 레이더 반사 면적 (m², 정면 기준) */
  rcs = 5;
  /** 적외선 신호 (1 = 전투기 군용추력, 애프터버너 ≈ 3~4) */
  irSignature = 1;
  /** 레이더 방사 중이면 정보, 아니면 null (RWR 이 읽음) */
  emission: RadarEmission | null = null;
  /** 미션 스크립트용 태그 (예: 'target', 'primary', 'wave2', 'escort') */
  readonly tags = new Set<string>();
  isPlayer = false;
  lastDamagedBy: Entity | null = null;
  /** 생성 시각 (sim.time) */
  spawnTime = 0;

  constructor(faction: Faction, name: string) {
    this.faction = faction;
    this.name = name;
  }

  /** 고정 스텝(기본 1/60s)마다 호출. 파괴된 뒤에도 removed 전까지 호출된다(잔해 연출용) */
  abstract update(dt: number, sim: Sim): void;

  applyDamage(info: DamageInfo, sim: Sim): void {
    if (!this.alive || info.amount <= 0) return;
    this.hp -= info.amount;
    if (info.source) this.lastDamagedBy = info.source;
    sim.events.emit('damaged', { entity: this, info });
    if (this.hp <= 0) {
      this.hp = 0;
      this.kill(sim, info);
    }
  }

  /** 파괴 처리. 이벤트를 한 번만 발생시키고 onDestroyed 를 호출한다 */
  kill(sim: Sim, info: DamageInfo | null = null): void {
    if (!this.alive) return;
    this.alive = false;
    sim.events.emit('destroyed', {
      entity: this,
      by: info?.source ?? this.lastDamagedBy,
      weaponId: info?.weaponId ?? null,
      cause: info?.kind ?? 'blast',
    });
    this.onDestroyed(sim, info);
  }

  /** 기본: 즉시 제거. 잔해/추락 연출이 필요하면 오버라이드 */
  protected onDestroyed(_sim: Sim, _info: DamageInfo | null): void {
    this.removed = true;
  }

  /** 위치가 지형 아래로 내려갔을 때 World 가 호출 (항공기/무기/디코이만). groundY = 지면 높이 */
  onTerrainCollision?(sim: Sim, groundY: number): void;

  syncObject(): void {
    this.object3d.position.copy(this.position);
    this.object3d.quaternion.copy(this.quaternion);
  }

  getForward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.quaternion);
  }
  getUp(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.quaternion);
  }
  getRight(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.quaternion);
  }
  get speed(): number {
    return this.velocity.length();
  }
  /** 표시용 이름: 콜사인 우선 */
  get label(): string {
    return this.callsign ?? this.name;
  }

  /** 월드에서 제거될 때 한 번 호출 (리소스 정리) */
  dispose?(): void;
}
