import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FT, KT, NM, quatFromHeadingPitch } from '../src/core/math';
import { Projector, bearingToCanvasAngle, edgeArrow, makeScreenPoint, type EdgeArrow } from '../src/ui/hud/projection';
import { TickBuffer, cardinalLabel, computeHeadingTicks, computeTapeTicks, headingDiff } from '../src/ui/hud/tape';
import { computeDlz, niceCeil } from '../src/ui/hud/dlz';
import {
  altitudeIn,
  distanceIn,
  formatAspect,
  formatClock,
  formatHeading,
  formatRange,
  formatSigned,
  formatThousands,
  formatVerticalSpeed,
  speedIn,
  verticalSpeedIn,
} from '../src/ui/hud/units';
import { MAP_RANGES, autoMapRange, worldToMap, type MapPoint } from '../src/ui/hud/mapMath';
import { aspectInfo, closureRate, markerShape, type AspectInfo } from '../src/ui/hud/targeting';
import { evaluateWarnings, pullUpRequired } from '../src/ui/hud/warnings';
import type { FlightTelemetry, LaunchZone } from '../src/core/contracts';

describe('hud units', () => {
  it('converts SI to display units', () => {
    expect(speedIn(100 * KT, 'nato')).toBeCloseTo(100, 6);
    expect(speedIn(100, 'metric')).toBeCloseTo(360, 6);
    expect(altitudeIn(1000 * FT, 'nato')).toBeCloseTo(1000, 6);
    expect(altitudeIn(1234, 'metric')).toBe(1234);
    expect(verticalSpeedIn(FT, 'nato')).toBeCloseTo(60, 6); // 1 ft/s = 60 ft/min
    expect(distanceIn(2 * NM, 'nato')).toBeCloseTo(2, 6);
    expect(distanceIn(2500, 'metric')).toBeCloseTo(2.5, 6);
  });

  it('formats numbers for the HUD', () => {
    expect(formatThousands(0)).toBe('0');
    expect(formatThousands(999)).toBe('999');
    expect(formatThousands(1000)).toBe('1,000');
    expect(formatThousands(1234567)).toBe('1,234,567');
    expect(formatThousands(-12500)).toBe('-12,500');
    expect(formatSigned(12)).toBe('+12');
    expect(formatSigned(-3.4)).toBe('-3');
    expect(formatSigned(0.2)).toBe('0');
    expect(formatSigned(1.25, 1)).toBe('+1.3');
    expect(formatRange(0.5 * NM, 'nato')).toBe('0.5');
    expect(formatRange(12.4 * NM, 'nato')).toBe('12');
    expect(formatRange(9500, 'metric')).toBe('9.5');
    expect(formatRange(99_960, 'metric')).toBe('100');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(75.9)).toBe('01:15');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-5)).toBe('00:00');
    expect(formatHeading(0)).toBe('000');
    expect(formatHeading(359.6)).toBe('000');
    expect(formatHeading(-10)).toBe('350');
    expect(formatHeading(87)).toBe('087');
    expect(formatAspect(35.4, 'R')).toBe('35R');
    expect(formatAspect(180, 'L')).toBe('180');
    expect(formatAspect(0, 'L')).toBe('0');
  });

  it('formats vertical speed per unit system', () => {
    expect(formatVerticalSpeed(10, 'nato')).toBe('+1,970'); // 10 m/s ≈ 1968.5 ft/min → 10 단위 반올림
    expect(formatVerticalSpeed(-0.01, 'nato')).toBe('0');
    expect(formatVerticalSpeed(-12.34, 'metric')).toBe('-12.3');
  });
});

describe('hud tape math', () => {
  it('produces ticks inside the span with major every N', () => {
    const buf = new TickBuffer();
    const n = computeTapeTicks(347, 60, 10, 50, buf);
    const values = buf.ticks.slice(0, n).map((t) => t.value);
    expect(values).toEqual([290, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400]);
    const majors = buf.ticks.slice(0, n).filter((t) => t.major).map((t) => t.value);
    expect(majors).toEqual([300, 350, 400]);
    for (let i = 0; i < n; i++) {
      const t = buf.ticks[i];
      expect(t.offset).toBeCloseTo((t.value - 347) / 60, 9);
      expect(Math.abs(t.offset)).toBeLessThanOrEqual(1);
    }
  });

  it('respects the minimum value and negative majors', () => {
    const buf = new TickBuffer();
    const n = computeTapeTicks(20, 60, 10, 50, buf, 0);
    expect(buf.ticks[0].value).toBe(0);
    expect(buf.ticks[0].major).toBe(true);
    expect(buf.ticks[n - 1].value).toBe(80);
    const m = computeTapeTicks(-120, 100, 50, 100, buf);
    const majors = buf.ticks.slice(0, m).filter((t) => t.major).map((t) => t.value);
    expect(majors).toEqual([-200, -100]);
  });

  it('reuses tick objects between calls', () => {
    const buf = new TickBuffer();
    computeTapeTicks(500, 100, 10, 50, buf);
    const first = buf.ticks[0];
    computeTapeTicks(510, 100, 10, 50, buf);
    expect(buf.ticks[0]).toBe(first);
  });

  it('wraps heading ticks across north', () => {
    const buf = new TickBuffer();
    const n = computeHeadingTicks(355, 20, 5, 10, buf);
    const vals = buf.ticks.slice(0, n).map((t) => t.value);
    expect(vals).toEqual([335, 340, 345, 350, 355, 0, 5, 10, 15]);
    const north = buf.ticks.slice(0, n).find((t) => t.value === 0)!;
    expect(north.offset).toBeCloseTo(5 / 20, 9);
    expect(north.major).toBe(true);
    expect(cardinalLabel(0)).toBe('N');
    expect(cardinalLabel(270)).toBe('W');
    expect(cardinalLabel(30)).toBeNull();
  });

  it('computes signed heading differences', () => {
    expect(headingDiff(350, 10)).toBeCloseTo(20, 9);
    expect(headingDiff(10, 350)).toBeCloseTo(-20, 9);
    expect(headingDiff(90, 270)).toBeCloseTo(180, 9);
    expect(headingDiff(0, 0)).toBe(0);
  });
});

describe('hud projection', () => {
  const W = 1280;
  const H = 720;
  function setup(headingDeg = 0, pitchDeg = 0): { proj: Projector; cam: THREE.PerspectiveCamera } {
    const cam = new THREE.PerspectiveCamera(60, W / H, 0.5, 400_000);
    cam.position.set(100, 2000, -300);
    cam.quaternion.copy(quatFromHeadingPitch(headingDeg, pitchDeg));
    cam.updateMatrixWorld();
    const proj = new Projector();
    proj.update(cam, W, H);
    return { proj, cam };
  }

  it('projects the view axis to the screen centre and right/up correctly', () => {
    const { proj, cam } = setup();
    const sp = makeScreenPoint();
    expect(proj.projectXYZ(cam.position.x, cam.position.y, cam.position.z - 5000, sp)).toBe(true);
    expect(sp.x).toBeCloseTo(W / 2, 6);
    expect(sp.y).toBeCloseTo(H / 2, 6);
    expect(sp.depth).toBeCloseTo(5000, 3);
    proj.projectXYZ(cam.position.x + 500, cam.position.y + 300, cam.position.z - 5000, sp);
    expect(sp.x).toBeGreaterThan(W / 2);
    expect(sp.y).toBeLessThan(H / 2);
    // 세로 화각 60°: tan(30°) 지점 = 화면 위 끝
    proj.projectXYZ(cam.position.x, cam.position.y + Math.tan(Math.PI / 6) * 1000, cam.position.z - 1000, sp);
    expect(sp.y).toBeCloseTo(0, 4);
    expect(proj.focalPx).toBeCloseTo(H / 2 / Math.tan(Math.PI / 6), 6);
    expect(proj.pixelRadius(10, 1000)).toBeCloseTo((10 * proj.focalPx) / 1000, 9);
  });

  it('flags points behind the camera and handles directions at infinity', () => {
    const { proj, cam } = setup(90, 0); // 동쪽을 본다
    const sp = makeScreenPoint();
    expect(proj.projectXYZ(cam.position.x - 1000, cam.position.y, cam.position.z, sp)).toBe(false);
    expect(sp.front).toBe(false);
    expect(proj.projectDirection(1, 0, 0, sp)).toBe(true);
    expect(sp.x).toBeCloseTo(W / 2, 6);
    expect(sp.y).toBeCloseTo(H / 2, 6);
    // 방향 투영은 위치와 무관: 북쪽 10° 위로 기운 방향은 화면 왼쪽 위
    proj.projectDirection(0.9, 0.17, -0.4, sp);
    expect(sp.x).toBeLessThan(W / 2);
    expect(sp.y).toBeLessThan(H / 2);
    expect(proj.inside(sp)).toBe(true);
  });

  it('converts to camera space', () => {
    const { proj, cam } = setup(0, 0);
    const v = proj.toCamera(new THREE.Vector3(cam.position.x + 10, cam.position.y + 5, cam.position.z - 100), new THREE.Vector3());
    expect(v.x).toBeCloseTo(10, 6);
    expect(v.y).toBeCloseTo(5, 6);
    expect(v.z).toBeCloseTo(-100, 6);
  });

  it('places off-screen arrows on the ellipse pointing toward the target', () => {
    const out: EdgeArrow = { x: 0, y: 0, angle: 0 };
    edgeArrow(10, 0, 640, 360, 200, 150, out);
    expect(out.x).toBeCloseTo(840, 6);
    expect(out.y).toBeCloseTo(360, 6);
    expect(out.angle).toBeCloseTo(0, 9);
    edgeArrow(0, 5, 640, 360, 200, 150, out); // 위
    expect(out.y).toBeCloseTo(210, 6);
    expect(out.angle).toBeCloseTo(-Math.PI / 2, 9);
    edgeArrow(0, 0, 640, 360, 200, 150, out); // 정확히 뒤 → 아래
    expect(out.y).toBeCloseTo(510, 6);
    edgeArrow(3, -3, 640, 360, 200, 150, out);
    const ex = (out.x - 640) / 200;
    const ey = (out.y - 360) / 150;
    expect(ex * ex + ey * ey).toBeCloseTo(1, 9);
  });

  it('maps bearings to canvas angles (0 = up, 90 = right)', () => {
    expect(Math.cos(bearingToCanvasAngle(0))).toBeCloseTo(0, 9);
    expect(Math.sin(bearingToCanvasAngle(0))).toBeCloseTo(-1, 9);
    expect(Math.cos(bearingToCanvasAngle(90))).toBeCloseTo(1, 9);
    expect(Math.sin(bearingToCanvasAngle(180))).toBeCloseTo(1, 9);
  });
});

describe('hud DLZ geometry', () => {
  it('rounds the scale to nice numbers', () => {
    expect(niceCeil(41.8)).toBe(50);
    expect(niceCeil(72)).toBe(80);
    expect(niceCeil(1)).toBe(1);
    expect(niceCeil(1.01)).toBe(1.2);
    expect(niceCeil(0.023)).toBeCloseTo(0.025, 12);
    expect(niceCeil(0)).toBe(1);
  });

  it('maps Rmin/Rne/Rmax/range to bar fractions', () => {
    const zone: LaunchZone = { rMin: 1200, rMax: 62_000, rNez: 22_000, range: 31_000, inRange: true, inNez: false };
    const g = computeDlz(zone, NM);
    expect(g.scaleMax).toBeCloseTo(50 * NM, 6); // 62 km × 1.25 = 41.8 NM → 50 NM
    expect(g.fMin).toBeCloseTo(1200 / (50 * NM), 9);
    expect(g.fNez).toBeCloseTo(22_000 / (50 * NM), 9);
    expect(g.fMax).toBeCloseTo(62_000 / (50 * NM), 9);
    expect(g.fRange).toBeCloseTo(31_000 / (50 * NM), 9);
    expect(g.fMin).toBeLessThan(g.fNez);
    expect(g.fNez).toBeLessThan(g.fMax);
    expect(g.state).toBe('inRange');
    expect(g.clamped).toBe(false);
  });

  it('clamps far ranges and reports states', () => {
    const far = computeDlz({ rMin: 1000, rMax: 20_000, rNez: 8000, range: 90_000, inRange: false, inNez: false }, 1000);
    expect(far.scaleMax).toBe(25_000);
    expect(far.fRange).toBe(1);
    expect(far.clamped).toBe(true);
    expect(far.state).toBe('far');
    const close = computeDlz({ rMin: 1000, rMax: 20_000, rNez: 8000, range: 500, inRange: false, inNez: false }, 1000);
    expect(close.state).toBe('tooClose');
    const nez = computeDlz({ rMin: 1000, rMax: 20_000, rNez: 8000, range: 5000, inRange: true, inNez: true }, 1000);
    expect(nez.state).toBe('nez');
    // rNez < rMin 같은 이상값이어도 막대 순서 유지
    const odd = computeDlz({ rMin: 3000, rMax: 20_000, rNez: 1000, range: 5000, inRange: true, inNez: false }, 1000);
    expect(odd.fNez).toBeGreaterThanOrEqual(odd.fMin);
  });
});

describe('hud minimap math', () => {
  const p: MapPoint = { x: 0, y: 0 };
  it('is heading-up', () => {
    worldToMap(0, -1000, 0, 0.01, p); // 북쪽, 기수 북
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(-10, 9);
    worldToMap(1000, 0, 0, 0.01, p); // 동쪽 → 오른쪽
    expect(p.x).toBeCloseTo(10, 9);
    expect(p.y).toBeCloseTo(0, 9);
    worldToMap(1000, 0, 90, 0.01, p); // 기수 동쪽: 동쪽 표적은 위
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(-10, 9);
    worldToMap(0, -1000, 90, 0.01, p); // 기수 동쪽: 북쪽 표적은 왼쪽
    expect(p.x).toBeCloseTo(-10, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });

  it('auto-ranges with hysteresis', () => {
    const r = MAP_RANGES.nato;
    expect(autoMapRange(5 * NM, r, 1)).toBe(0);
    expect(autoMapRange(15 * NM, r, 0)).toBe(1);
    expect(autoMapRange(30 * NM, r, 0)).toBe(2);
    expect(autoMapRange(300 * NM, r, 0)).toBe(3);
    // 20 NM 범위에서 8 NM (10 NM 의 80%) 은 아직 줄이지 않는다
    expect(autoMapRange(8 * NM, r, 1)).toBe(1);
    expect(autoMapRange(6.5 * NM, r, 1)).toBe(0);
    expect(autoMapRange(null, r, 2)).toBe(2);
  });
});

describe('hud targeting', () => {
  it('computes closure rate', () => {
    const own = new THREE.Vector3(0, 0, 0);
    const tgt = new THREE.Vector3(0, 0, -10_000);
    expect(closureRate(own, new THREE.Vector3(0, 0, -300), tgt, new THREE.Vector3(0, 0, 250))).toBeCloseTo(550, 9);
    expect(closureRate(own, new THREE.Vector3(0, 0, -300), tgt, new THREE.Vector3(0, 0, -400))).toBeCloseTo(-100, 9);
    expect(closureRate(own, new THREE.Vector3(), tgt, new THREE.Vector3(250, 0, 0))).toBeCloseTo(0, 9);
  });

  it('computes aspect angle and side', () => {
    const out: AspectInfo = { deg: 0, side: 'R' };
    const tgt = new THREE.Vector3(0, 0, 0);
    const northbound = new THREE.Vector3(0, 0, -200);
    aspectInfo(new THREE.Vector3(0, 0, -5000), tgt, northbound, out); // 표적 앞쪽에 있음
    expect(out.deg).toBeCloseTo(180, 6);
    aspectInfo(new THREE.Vector3(0, 0, 5000), tgt, northbound, out); // 꼬리
    expect(out.deg).toBeCloseTo(0, 6);
    aspectInfo(new THREE.Vector3(5000, 0, 0), tgt, northbound, out); // 표적 오른쪽(동쪽)
    expect(out.deg).toBeCloseTo(90, 6);
    expect(out.side).toBe('R');
    aspectInfo(new THREE.Vector3(-5000, 0, -5000), tgt, northbound, out);
    expect(out.deg).toBeCloseTo(135, 6);
    expect(out.side).toBe('L');
  });

  it('picks marker shapes by class', () => {
    expect(markerShape('air')).toBe('box');
    expect(markerShape('ground')).toBe('diamond');
    expect(markerShape('structure')).toBe('diamond');
    expect(markerShape('sea')).toBe('ship');
  });
});

describe('hud warnings', () => {
  it('requires pull up when terrain impact is imminent', () => {
    expect(pullUpRequired(300, -100, 250)).toBe(true); // 3 s
    expect(pullUpRequired(3000, -100, 250)).toBe(false); // 너무 높음
    expect(pullUpRequired(1000, -100, 250)).toBe(false); // 10 s
    expect(pullUpRequired(500, 5, 250)).toBe(false); // 상승 중
    expect(pullUpRequired(50, -10, 150)).toBe(true); // 아주 낮게 하강
    expect(pullUpRequired(0, 0, 100)).toBe(true);
  });

  it('evaluates flags from telemetry and map radius', () => {
    const tel = {
      stalled: true,
      overG: false,
      agl: 5000,
      verticalSpeed: 0,
      speed: 200,
      fuelFraction: 0.1,
    } as FlightTelemetry;
    const w = evaluateWarnings(tel, 95_000, 0, 100_000);
    expect(w.stall).toBe(true);
    expect(w.overG).toBe(false);
    expect(w.pullUp).toBe(false);
    expect(w.bingo).toBe(true);
    expect(w.outOfArea).toBe(false);
    expect(w.nearBoundary).toBe(true);
    evaluateWarnings(tel, 80_000, 70_000, 100_000, w);
    expect(w.outOfArea).toBe(true);
    expect(w.nearBoundary).toBe(false);
  });
});
