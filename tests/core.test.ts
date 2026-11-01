import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { atmosphere, attitudeOf, forwardOf, headingOf, headingToDir, quatFromHeadingPitch, relativeBearing, interceptPoint } from '../src/core/math';
import { Relations } from '../src/core/factions';
import { Entity } from '../src/core/entity';
import { World } from '../src/core/world';
import { Rng } from '../src/core/rng';

describe('atmosphere', () => {
  it('ISA 해면/11km 값', () => {
    const a0 = atmosphere(0);
    expect(a0.rho).toBeCloseTo(1.225, 3);
    expect(a0.speedOfSound).toBeCloseTo(340.3, 0);
    const a11 = atmosphere(11000);
    expect(a11.temperature).toBeCloseTo(216.65, 1);
    expect(a11.rho).toBeCloseTo(0.3639, 2);
    expect(atmosphere(20000).rho).toBeCloseTo(0.0889, 2);
  });
});

describe('방향 규칙', () => {
  it('heading 0 = 북(-Z), 90 = 동(+X)', () => {
    expect(headingToDir(0).z).toBeCloseTo(-1);
    expect(headingToDir(90).x).toBeCloseTo(1);
    expect(headingOf(new THREE.Vector3(1, 0, 0))).toBeCloseTo(90);
    expect(headingOf(new THREE.Vector3(0, 0, 1))).toBeCloseTo(180);
  });
  it('자세 쿼터니언 왕복', () => {
    const q = quatFromHeadingPitch(135, 20, -30);
    const a = attitudeOf(q);
    expect(a.heading).toBeCloseTo(135, 3);
    expect(a.pitch).toBeCloseTo(20, 3);
    expect(a.roll).toBeCloseTo(-30, 3);
    const f = forwardOf(quatFromHeadingPitch(90, 0));
    expect(f.x).toBeCloseTo(1);
    expect(forwardOf(quatFromHeadingPitch(0, 30)).y).toBeCloseTo(Math.sin(Math.PI / 6));
  });
  it('롤 양수 = 오른쪽 날개 내려감', () => {
    const q = quatFromHeadingPitch(0, 0, 30);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(right.y).toBeLessThan(0);
  });
  it('상대 방위: 오른쪽 = 양수', () => {
    const q = quatFromHeadingPitch(0, 0);
    const r = relativeBearing(q, new THREE.Vector3(), new THREE.Vector3(100, 0, -100));
    expect(r.bearing).toBeCloseTo(45);
  });
  it('요격점', () => {
    const p = interceptPoint(new THREE.Vector3(), 100, new THREE.Vector3(0, 0, -1000), new THREE.Vector3(50, 0, 0));
    expect(p).not.toBeNull();
    expect(p!.distanceTo(new THREE.Vector3()) / 100).toBeCloseTo(p!.x / 50, 3);
  });
});

class Dummy extends Entity {
  readonly kind = 'ground' as const;
  update(): void {}
}

describe('World', () => {
  it('질의/적대 관계', () => {
    const rel = new Relations();
    const w = new World(new THREE.Scene(), rel);
    const a = w.add(new Dummy('NATO', 'a'));
    const b = w.add(new Dummy('WARSAW', 'b'));
    const c = w.add(new Dummy('WON', 'c'));
    b.position.set(100, 0, 0);
    expect(w.query({ hostileTo: 'NATO' })).toEqual([b]);
    expect(rel.isHostile('WON', 'PAX')).toBe(true);
    expect(rel.isHostile('WON', 'NATO')).toBe(false);
    expect(w.nearest(new THREE.Vector3(90, 0, 0), { exclude: b })).toBe(a);
    c.removed = true;
    w.step(1 / 60, { services: { terrain: { heightAt: () => 0 } } } as never);
    expect(w.entities.length).toBe(2);
  });
});

describe('Rng', () => {
  it('결정적', () => {
    const r1 = new Rng(42), r2 = new Rng(42);
    expect([r1.next(), r1.next()]).toEqual([r2.next(), r2.next()]);
  });
});
