// 견인 디코이 (ALE-50/55 계열). 기체 뒤로 케이블에 끌려가며 레이더 미사일을 유인한다.
// 레이더 시커 쪽(무장 모듈)은 decoyType === 'towed' 인 디코이를 strength 로 기만 판정하면 된다.
import * as THREE from 'three';
import { Entity } from '../../core/entity';
import type { AircraftLike, DecoyLike } from '../../core/contracts';
import type { Sim } from '../../core/sim';
import { TOWED_DECOY } from './constants';

const bodyGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.9, 6).rotateX(Math.PI / 2);
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.7, metalness: 0.3, name: 'metal' });
const cableMat = new THREE.LineBasicMaterial({ color: 0x1c1f22, transparent: true, opacity: 0.6 });

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _goal = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _local = new THREE.Vector3();

export class TowedDecoy extends Entity implements DecoyLike {
  readonly kind = 'decoy' as const;
  readonly decoyType = 'towed' as const;
  strength: number = TOWED_DECOY.strength;
  private readonly cable: THREE.Line;
  private readonly cableAttr: THREE.BufferAttribute;

  constructor(readonly owner: AircraftLike) {
    super(owner.faction, 'TOWED DECOY');
    this.targetClass = 'weapon';
    this.hp = this.maxHp = 1;
    this.radius = 1.5;
    this.irSignature = 0.05;
    this.rcs = Math.max(owner.rcs * TOWED_DECOY.rcsGain, TOWED_DECOY.rcsMin);

    const g = new THREE.Group();
    g.add(new THREE.Mesh(bodyGeo, bodyMat));
    const geo = new THREE.BufferGeometry();
    this.cableAttr = new THREE.BufferAttribute(new Float32Array(6), 3);
    geo.setAttribute('position', this.cableAttr);
    this.cable = new THREE.Line(geo, cableMat);
    this.cable.frustumCulled = false;
    g.add(this.cable);
    this.object3d = g;

    this.goalPosition(_goal);
    this.position.copy(_goal);
    this.velocity.copy(owner.velocity);
    this.quaternion.copy(owner.quaternion);
  }

  private goalPosition(out: THREE.Vector3): THREE.Vector3 {
    const o = this.owner;
    o.getForward(_fwd);
    o.getUp(_up);
    return out.copy(o.position).addScaledVector(_fwd, -TOWED_DECOY.cableM).addScaledVector(_up, -TOWED_DECOY.dropM);
  }

  update(dt: number, _sim: Sim): void {
    if (!this.alive) return;
    const o = this.owner;
    if (o.removed || !o.alive) {
      // 케이블 절단 — 파괴 이벤트 없이 사라진다
      this.removed = true;
      return;
    }
    this.goalPosition(_goal);
    this.position.lerp(_goal, 1 - Math.exp(-3 * dt));
    this.velocity.copy(o.velocity);
    this.quaternion.slerp(o.quaternion, 1 - Math.exp(-4 * dt));
    this.rcs = Math.max(o.rcs * TOWED_DECOY.rcsGain, TOWED_DECOY.rcsMin);
  }

  onTerrainCollision(): void {
    this.removed = true;
  }

  override syncObject(): void {
    super.syncObject();
    // 케이블: 디코이(로컬 원점) → 기체 꼬리
    this.owner.getForward(_fwd);
    _local.copy(this.owner.position).addScaledVector(_fwd, -8).sub(this.position);
    _invQ.copy(this.quaternion).invert();
    _local.applyQuaternion(_invQ);
    const a = this.cableAttr.array as Float32Array;
    a[3] = _local.x;
    a[4] = _local.y;
    a[5] = _local.z;
    this.cableAttr.needsUpdate = true;
  }

  override dispose(): void {
    this.cable.geometry.dispose();
  }
}
