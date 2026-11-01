import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { G0 } from '../src/core/math';
import type { WeaponDef } from '../src/data/schema';
import { ballisticBodyOf, computeGunLead, gunStreamPoint, isUnguidedBomb, predictBombImpact } from '../src/ui/hud/gunnery';
import { RadioQueue, radioDuration } from '../src/ui/hud/radioQueue';
import { EventFeed } from '../src/ui/hud/feed';

const flat = (): number => 0;

function bomb(over: Partial<WeaponDef> = {}): WeaponDef {
  return {
    id: 'Mk 82',
    name: 'Mk 82',
    category: 'bomb_dumb',
    description: '',
    users: ['NATO'],
    massKg: 241,
    dragArea: 0.03,
    rcsAdd: 0.05,
    unlock: { cost: 0 },
    body: { diameterM: 0.273, lengthM: 2.2, cd0: 0.25, maxG: 0 },
    ...over,
  };
}

describe('hud gun lead', () => {
  it('aims slightly high at a stationary target (gravity drop)', () => {
    const dir = new THREE.Vector3();
    const tof = computeGunLead(new THREE.Vector3(0, 1000, 0), new THREE.Vector3(), new THREE.Vector3(0, 1000, -1000), new THREE.Vector3(), 1000, dir);
    expect(tof).toBeGreaterThan(0.99);
    expect(tof).toBeLessThan(1.01);
    expect(dir.z).toBeLessThan(-0.99);
    expect(dir.y).toBeGreaterThan(0); // 위로 보정
    expect(dir.y).toBeCloseTo((0.5 * G0 * tof * tof) / 1000, 3);
  });

  it('leads a crossing target so the simulated bullet hits it', () => {
    const shooter = new THREE.Vector3(0, 3000, 0);
    const shooterVel = new THREE.Vector3(0, 0, -220);
    const target = new THREE.Vector3(80, 3050, -700);
    const targetVel = new THREE.Vector3(200, 10, -60);
    const mv = 1030;
    const dir = new THREE.Vector3();
    const tof = computeGunLead(shooter, shooterVel, target, targetVel, mv, dir);
    expect(tof).toBeGreaterThan(0);
    expect(dir.x).toBeGreaterThan(0.1); // 표적 진행 방향(동쪽)으로 리드
    // 탄 비행 시뮬레이션 (작은 간격, 중력)
    const p = shooter.clone();
    const v = shooterVel.clone().addScaledVector(dir, mv);
    const h = 1 / 2000;
    let t = 0;
    while (t < tof) {
      v.y -= G0 * h;
      p.addScaledVector(v, h);
      t += h;
    }
    const tp = target.clone().addScaledVector(targetVel, t);
    expect(p.distanceTo(tp)).toBeLessThan(1.5);
  });

  it('rejects invalid muzzle velocity', () => {
    const dir = new THREE.Vector3();
    expect(computeGunLead(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(0, 0, -100), new THREE.Vector3(), 0, dir)).toBe(-1);
  });

  it('computes stream points with drop', () => {
    const out = new THREE.Vector3();
    gunStreamPoint(new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, 0, -1), 1000, 1, out);
    expect(out.z).toBeCloseTo(-1000, 9);
    expect(out.y).toBeCloseTo(100 - 0.5 * G0, 9);
  });
});

describe('hud CCIP prediction', () => {
  it('matches the vacuum solution without drag', () => {
    const out = new THREE.Vector3();
    const body = { ...ballisticBodyOf(bomb()), cd0: 0 };
    const h = 2000;
    const v = 200;
    const t = predictBombImpact(new THREE.Vector3(0, h, 0), new THREE.Vector3(v, 0, 0), body, flat, out, { dt: 0.01 });
    const tv = Math.sqrt((2 * h) / G0);
    expect(t).toBeCloseTo(tv, 1);
    expect(out.x).toBeCloseTo(v * tv, -1); // ±5 m
    expect(out.y).toBe(0);
    expect(out.z).toBeCloseTo(0, 6);
  });

  it('falls shorter with drag and respects terrain height', () => {
    const vac = new THREE.Vector3();
    const drag = new THREE.Vector3();
    const body = ballisticBodyOf(bomb());
    predictBombImpact(new THREE.Vector3(0, 3000, 0), new THREE.Vector3(0, -20, -250), { ...body, cd0: 0 }, flat, vac);
    predictBombImpact(new THREE.Vector3(0, 3000, 0), new THREE.Vector3(0, -20, -250), body, flat, drag);
    expect(-drag.z).toBeLessThan(-vac.z);
    expect(-drag.z).toBeGreaterThan(-vac.z * 0.7);
    const hill = new THREE.Vector3();
    predictBombImpact(new THREE.Vector3(0, 3000, 0), new THREE.Vector3(0, -20, -250), body, () => 1000, hill);
    expect(hill.y).toBe(1000);
    expect(-hill.z).toBeLessThan(-drag.z);
  });

  it('returns -1 when no impact within maxTime and 0 below ground', () => {
    const out = new THREE.Vector3();
    const body = ballisticBodyOf(bomb());
    expect(predictBombImpact(new THREE.Vector3(0, 20_000, 0), new THREE.Vector3(), body, flat, out, { maxTime: 5 })).toBe(-1);
    expect(predictBombImpact(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), body, flat, out)).toBe(0);
  });

  it('identifies unguided bombs', () => {
    expect(isUnguidedBomb(bomb())).toBe(true);
    expect(isUnguidedBomb(bomb({ category: 'bomb_gps', guidance: { type: 'gps', seekerRangeKm: 0, gimbalDeg: 0, offBoresightDeg: 0, navConstant: 3, ccm: 1 } }))).toBe(false);
    expect(isUnguidedBomb(bomb({ category: 'nuke' }))).toBe(true);
    expect(isUnguidedBomb(bomb({ category: 'aam_ir' }))).toBe(false);
    expect(isUnguidedBomb(null)).toBe(false);
  });
});

describe('hud radio queue', () => {
  it('derives durations from text length within bounds', () => {
    expect(radioDuration('짧다')).toBe(2.6);
    expect(radioDuration('가'.repeat(400))).toBe(9);
    expect(radioDuration('가'.repeat(60))).toBeCloseTo(1.6 + 60 * 0.075, 9);
  });

  it('shows messages in order and advances after duration + fade', () => {
    const q = new RadioQueue();
    q.push({ speaker: 'A', text: 'one', duration: 2 }, 0);
    q.push({ speaker: 'B', text: 'two', duration: 2 }, 0.5);
    expect(q.current?.speaker).toBe('A');
    q.update(2.1);
    expect(q.current?.speaker).toBe('A');
    q.update(2.3);
    expect(q.current?.speaker).toBe('B');
    expect(q.currentStart).toBe(2.3);
    q.update(10);
    expect(q.current).toBeNull();
  });

  it('interrupts with higher priority and orders the queue by priority', () => {
    const q = new RadioQueue();
    q.push({ speaker: 'chatter', text: 'x', priority: 0 }, 0);
    q.push({ speaker: 'low', text: 'x', priority: 0 }, 0.1);
    q.push({ speaker: 'mid', text: 'x', priority: 1 }, 0.2); // 현재(0)보다 높음 → 즉시
    expect(q.current?.speaker).toBe('mid');
    q.push({ speaker: 'mid2', text: 'x', priority: 1 }, 0.3); // 같음 → 대기
    q.push({ speaker: 'top', text: 'x', priority: 3 }, 0.4); // 끊고 즉시, 'mid'(≥1) 는 다시 대기열로
    expect(q.current?.speaker).toBe('top');
    expect(q.queue.map((e) => e.speaker)).toEqual(['mid2', 'mid', 'low']);
  });

  it('drops stale chatter and caps the queue', () => {
    const q = new RadioQueue({ maxQueued: 3, staleAfter: 5 });
    q.push({ speaker: 'long', text: 'x', duration: 20, priority: 5 }, 0);
    q.push({ speaker: 'c1', text: 'x', priority: 0 }, 0);
    q.push({ speaker: 'imp', text: 'x', priority: 2 }, 0);
    q.push({ speaker: 'c2', text: 'x', priority: 0 }, 1);
    q.push({ speaker: 'c3', text: 'x', priority: 0 }, 2);
    expect(q.queue.length).toBe(3);
    expect(q.queue.map((e) => e.speaker)).toEqual(['imp', 'c2', 'c3']); // 가장 오래된 c1 버림
    q.update(20.3); // long 종료 → imp (중요, 오래돼도 표시)
    expect(q.current?.speaker).toBe('imp');
    q.update(40); // imp 종료 → c2, c3 는 오래된 잡담이라 버림
    expect(q.current).toBeNull();
    expect(q.queue.length).toBe(0);
  });

  it('fades in and out', () => {
    const q = new RadioQueue();
    q.push({ speaker: 'A', text: 'x', duration: 3 }, 10);
    expect(q.alpha(10)).toBe(0);
    expect(q.alpha(10.125)).toBeCloseTo(0.5, 6);
    expect(q.alpha(11)).toBe(1);
    expect(q.alpha(13.125)).toBeCloseTo(0.5, 6);
  });
});

describe('hud event feed', () => {
  it('merges rapid hits on the same entity and replaces them with a kill', () => {
    const f = new EventFeed();
    f.push('hit', 'HIT', '', 7, 0);
    f.push('hit', 'HIT', '', 7, 0.3);
    expect(f.items.length).toBe(1);
    expect(f.items[0].count).toBe(2);
    f.push('hit', 'HIT', '', 8, 0.4);
    expect(f.items.length).toBe(2);
    f.push('kill', '격파', 'Su-35S', 7, 0.5);
    expect(f.items.map((i) => `${i.kind}:${i.entityId}`)).toEqual(['kill:7', 'hit:8']);
    f.update(10);
    expect(f.items.length).toBe(0);
  });

  it('attributes score deltas to the latest unscored popup', () => {
    const f = new EventFeed();
    const pos = new THREE.Vector3(1, 2, 3);
    f.addPopup(pos, 'MiG-29S', false, 0);
    f.addPopup(pos, 'Su-27S', true, 0.2);
    pos.set(0, 0, 0);
    expect(f.popups[0].position.x).toBe(1); // 복사본 보관
    expect(f.attributeScore(1200, 0.3)).toBe(true);
    expect(f.popups[1].score).toBe(1200);
    expect(f.attributeScore(800, 0.4)).toBe(true);
    expect(f.popups[0].score).toBe(800);
    expect(f.attributeScore(500, 0.5)).toBe(false);
    f.update(5);
    expect(f.popups.length).toBe(0);
  });
});
