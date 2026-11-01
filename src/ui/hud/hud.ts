// 전투 HUD (System). 전체 화면 2D 캔버스 오버레이 + 반해상도 발광(glow) 레이어.
//   const hud = new Hud(container);   game.addSystem(hud);   hud.setVisible(false);   hud.dispose();
// update(dt, sim) 이 sim 변경을 감지해 이벤트를 다시 구독한다. 플레이어가 없으면 무전/미션 정보만 그린다.
import * as THREE from 'three';
import type { AircraftController, AircraftLike, MissileLike } from '../../core/contracts';
import type { Entity } from '../../core/entity';
import type { System } from '../../core/game';
import type { ObjectiveState } from '../../core/services';
import type { GameEvents, Sim } from '../../core/sim';
import { HUD_COLORS, hudScale } from './style';
import { Projector } from './projection';
import { RadioQueue } from './radioQueue';
import { EventFeed } from './feed';
import { evaluateWarnings } from './warnings';
import { closureRate } from './targeting';
import { createFrame, type HudFrame } from './frame';
import { TextMetricsCache } from './draw/primitives';
import { drawBoresight, drawFlightPathMarker, drawMouseAim, drawPitchLadder, drawRollScale } from './draw/center';
import { drawAltitudeTape, drawHeadingTape, drawSpeedTape } from './draw/tapes';
import { createTargetDrawState, drawCcip, drawDesignatedTarget, drawGunSight, drawKillPopups, drawTrackMarkers } from './draw/targets';
import {
  drawDamageFlash,
  drawDlz,
  drawEventFeed,
  drawFlightWarnings,
  drawMissionEnd,
  drawNotice,
  drawThreatWarnings,
  type MissionEndState,
  type NoticeState,
} from './draw/alerts';
import { MARGIN, createRadioLayout, drawDamagePanel, drawMissionPanel, drawRadio, drawWeaponPanel } from './draw/panels';
import { createMinimapState, drawMinimap, drawRwr, scopeLayout, type MapMarkerLike, type ScopeLayout } from './draw/scopes';

/** 마우스 에임 컨트롤러(flight PlayerController)가 노출하는 조준 방향 (월드, 정규화) — 계약 외 선택 필드 */
type MouseAimController = AircraftController & { aimDirection?: THREE.Vector3 | null; mouseAimActive?: boolean };
/** MissionRunner 의 런타임 지도 마커 (선택) */
type MissionWithMarkers = { markers?: readonly MapMarkerLike[] };

const MAX_OWN_MISSILES = 24;
const DPR_CAP = 2;
/** 발광 레이어 해상도 배율 (CSS px 기준) */
const GLOW_RES = 0.5;

const _fwd = new THREE.Vector3();
const _vdir = new THREE.Vector3();

export class Hud implements System {
  readonly name = 'hud';
  readonly root: HTMLDivElement;
  /** 마지막 update 소요 시간 (ms) — 성능 확인용 */
  lastFrameMs = 0;

  private readonly canvas: HTMLCanvasElement;
  private readonly glow: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly glowCtx: CanvasRenderingContext2D | null;
  private readonly container: HTMLElement;
  private visible = true;
  private disposed = false;
  private sim: Sim | null = null;
  private offs: Array<() => void> = [];
  private dirty = true;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private ro: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => {
    this.dirty = true;
  };

  private clock = 0;
  private readonly proj = new Projector();
  private readonly metrics = new TextMetricsCache();
  private readonly frame: HudFrame;
  private readonly radio = new RadioQueue();
  private readonly radioLayout = createRadioLayout();
  private readonly feed = new EventFeed();
  private readonly targetState = createTargetDrawState();
  private readonly minimap = createMinimapState();
  private readonly scopes: ScopeLayout = { rwrX: 0, rwrY: 0, rwrR: 0, mapX: 0, mapY: 0, mapR: 0 };
  private readonly ownMissiles: Entity[] = [];
  private readonly objectiveSeen = new Map<string, ObjectiveState['status']>();
  private readonly objectiveChanged = new Map<string, number>();
  private notice: NoticeState | null = null;
  private missionEnd: MissionEndState | null = null;
  private lastScore: number | null = null;
  private hitTime = -10;
  private damageGradient: CanvasGradient | null = null;
  private maxG = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    const doc = container.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'tna-hud';
    const staticParent = doc.defaultView?.getComputedStyle(container).position === 'static' && container !== doc.body;
    Object.assign(this.root.style, {
      position: staticParent || container === doc.body ? 'fixed' : 'absolute',
      inset: '0',
      pointerEvents: 'none',
      overflow: 'hidden',
      userSelect: 'none',
      contain: 'strict',
    } satisfies Partial<CSSStyleDeclaration>);

    this.glow = doc.createElement('canvas');
    Object.assign(this.glow.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      filter: 'blur(3px) brightness(1.25)',
      opacity: '0.85',
    } satisfies Partial<CSSStyleDeclaration>);
    this.canvas = doc.createElement('canvas');
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      // 밝은 하늘 위 가독성: 얇은 어두운 테두리
      filter: 'drop-shadow(0 0 1px rgba(0, 0, 0, 0.95)) drop-shadow(0 0 2.5px rgba(0, 0, 0, 0.45))',
    } satisfies Partial<CSSStyleDeclaration>);
    this.root.append(this.glow, this.canvas);
    container.appendChild(this.root);

    const ctx = this.canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('[hud] 2D 캔버스를 만들 수 없다');
    this.ctx = ctx;
    this.glowCtx = this.glow.getContext('2d', { alpha: true });
    this.frame = createFrame(ctx, null as unknown as Sim, this.proj, this.metrics);

    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(this.onWindowResize);
      this.ro.observe(this.root);
    }
    doc.defaultView?.addEventListener('resize', this.onWindowResize);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.style.display = v ? '' : 'none';
  }

  get isVisible(): boolean {
    return this.visible;
  }

  update(dt: number, sim: Sim): void {
    if (this.disposed) return;
    const t0 = performance.now();
    if (sim !== this.sim) this.attach(sim);
    this.clock += Math.max(0, Number.isFinite(dt) ? dt : 0);
    const now = this.clock;
    this.radio.update(now);
    this.feed.update(now);
    this.trackMission(sim, now);
    if (!this.visible) return;

    const win = this.container.ownerDocument.defaultView;
    const dpr = Math.min(DPR_CAP, win?.devicePixelRatio || 1);
    if (this.dirty || dpr !== this.dpr) this.resize(dpr);
    if (this.W < 2 || this.H < 2) return;

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const f = this.prepareFrame(sim);
    if (f.player) this.drawPlayerHud(f);
    this.drawCommon(f, !!f.player);

    const g = this.glowCtx;
    if (g) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.glow.width, this.glow.height);
      g.drawImage(this.canvas, 0, 0, this.glow.width, this.glow.height);
    }
    this.lastFrameMs = performance.now() - t0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.ro?.disconnect();
    this.container.ownerDocument.defaultView?.removeEventListener('resize', this.onWindowResize);
    this.root.remove();
    this.metrics.clear();
  }

  // ---------------------------------------------------------------- 크기

  private resize(dpr: number): void {
    this.dirty = false;
    this.dpr = dpr;
    const rect = this.root.getBoundingClientRect();
    const win = this.container.ownerDocument.defaultView;
    const w = Math.round(rect.width || win?.innerWidth || 0);
    const h = Math.round(rect.height || win?.innerHeight || 0);
    this.W = w;
    this.H = h;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.glow.width = Math.max(1, Math.round(w * GLOW_RES));
    this.glow.height = Math.max(1, Math.round(h * GLOW_RES));
    this.metrics.clear();
    const ctx = this.ctx;
    const cx = w / 2;
    const cy = h / 2;
    const inner = Math.min(w, h) * 0.32;
    const outer = Math.hypot(cx, cy);
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0, 'rgba(255, 30, 30, 0)');
    grad.addColorStop(1, 'rgba(255, 30, 30, 0.6)');
    this.damageGradient = grad;
  }

  // ---------------------------------------------------------------- 이벤트

  private attach(sim: Sim | null): void {
    this.detach();
    this.sim = sim;
    this.resetState();
    if (!sim) return;
    const ev = sim.events;
    this.offs.push(
      ev.on('radio', (m) => this.radio.push(m, this.clock)),
      ev.on('damaged', (e) => this.onDamaged(e)),
      ev.on('destroyed', (e) => this.onDestroyed(e)),
      ev.on('weaponLaunched', (e) => this.onLaunched(e)),
      ev.on('weaponMissed', (e) => this.onMissed(e)),
      ev.on('missionEnded', (e) => {
        this.missionEnd = { result: e.result, reason: e.reason ?? '', time: this.clock };
      }),
      ev.on('objectiveChanged', (e) => this.onObjectiveChanged(e.id)),
    );
  }

  private detach(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }

  private resetState(): void {
    this.radio.clear();
    this.feed.clear();
    this.ownMissiles.length = 0;
    this.objectiveSeen.clear();
    this.objectiveChanged.clear();
    this.notice = null;
    this.missionEnd = null;
    this.lastScore = null;
    this.hitTime = -10;
    this.maxG = 0;
    this.minimap.rangeIdx = 1;
    this.radioLayout.entry = null;
  }

  private player(): AircraftLike | null {
    return this.sim?.world.player ?? null;
  }

  private onDamaged(e: GameEvents['damaged']): void {
    const p = this.player();
    if (!p) return;
    if (e.entity === p) {
      this.hitTime = this.clock;
      return;
    }
    if (e.info.source === p && e.entity.kind !== 'missile' && e.entity.kind !== 'decoy') this.feed.push('hit', 'HIT', '', e.entity.id, this.clock);
  }

  private onDestroyed(e: GameEvents['destroyed']): void {
    const i = this.ownMissiles.indexOf(e.entity);
    if (i >= 0) this.ownMissiles.splice(i, 1);
    const p = this.player();
    if (!p || e.by !== p || e.entity === p) return;
    const k = e.entity.kind;
    if (k === 'missile' || k === 'bomb' || k === 'decoy') return;
    const name = e.entity.name;
    this.feed.push('kill', '격파', name, e.entity.id, this.clock);
    this.feed.addPopup(e.entity.position, name, e.entity.tags.has('target'), this.clock);
  }

  private onLaunched(e: GameEvents['weaponLaunched']): void {
    const p = this.player();
    if (!p || e.shooter !== p) return;
    this.ownMissiles.push(e.weapon);
    if (this.ownMissiles.length > MAX_OWN_MISSILES) this.ownMissiles.shift();
  }

  private onMissed(e: GameEvents['weaponMissed']): void {
    const p = this.player();
    const i = this.ownMissiles.indexOf(e.weapon);
    const mine = i >= 0 || (!!p && (e.weapon as Partial<MissileLike>).shooter === p);
    if (i >= 0) this.ownMissiles.splice(i, 1);
    if (mine) this.feed.push('miss', 'MISSED', '', e.weapon.id, this.clock);
  }

  private onObjectiveChanged(id: string): void {
    const state = this.sim?.services.mission.state;
    if (!state) return;
    const o = state.objectives.find((x) => x.id === id);
    if (!o) return;
    this.objectiveChanged.set(id, this.clock);
    const prev = this.objectiveSeen.get(id);
    this.objectiveSeen.set(id, o.status);
    if (prev === o.status) return;
    if (o.status === 'complete') this.notice = { text: '목표 달성', sub: o.text, color: HUD_COLORS.target, time: this.clock, duration: 4 };
    else if (o.status === 'failed') this.notice = { text: '목표 실패', sub: o.text, color: HUD_COLORS.warn, time: this.clock, duration: 4.5 };
    else if (o.status === 'active') this.notice = { text: prev === undefined ? '새 목표' : '목표 갱신', sub: o.text, color: HUD_COLORS.main, time: this.clock, duration: 4 };
  }

  /** 점수 증가 → 격파 팝업에 붙이기, 목표 초기 상태 기록 */
  private trackMission(sim: Sim, now: number): void {
    const state = sim.services.mission.state;
    if (!state) {
      this.lastScore = null;
      return;
    }
    if (this.lastScore !== null && state.score > this.lastScore) this.feed.attributeScore(state.score - this.lastScore, now);
    this.lastScore = state.score;
    if (this.objectiveSeen.size === 0) for (const o of state.objectives) this.objectiveSeen.set(o.id, o.status);
  }

  // ---------------------------------------------------------------- 프레임 준비

  private prepareFrame(sim: Sim): HudFrame {
    const f = this.frame;
    f.sim = sim;
    f.time = this.clock;
    f.units = sim.settings.units;
    f.W = this.W;
    f.H = this.H;
    f.s = hudScale(this.W, this.H);
    f.cx = this.W / 2;
    f.cy = this.H / 2;
    const cam = sim.camera;
    cam.updateMatrixWorld();
    this.proj.update(cam, this.W, this.H);

    const p = sim.world.player;
    const alive = !!p && p.alive && !p.removed;
    f.player = alive ? p : null;
    f.tel = alive ? p!.telemetry : null;
    f.designated = null;
    f.selected = null;
    f.lock.status = 'none';
    f.lock.progress = 0;
    f.lock.target = null;
    f.missileThreats = 0;
    f.lockThreats = 0;
    f.ownMissiles.count = 0;
    f.ownMissiles.timeToGo = -1;
    f.boreOk = false;
    f.fpmOk = false;
    if (!alive) return f;
    const pl = p!;

    f.fwd.set(0, 0, -1).applyQuaternion(pl.quaternion);
    f.up.set(0, 1, 0).applyQuaternion(pl.quaternion);
    f.right.set(1, 0, 0).applyQuaternion(pl.quaternion);
    f.boreOk = this.proj.projectDirection(f.fwd.x, f.fwd.y, f.fwd.z, f.bore) && this.proj.inside(f.bore, -40 * f.s);
    const sp = pl.velocity.length();
    if (sp > 5) {
      _vdir.copy(pl.velocity).multiplyScalar(1 / sp);
      f.fpmOk = this.proj.projectDirection(_vdir.x, _vdir.y, _vdir.z, f.fpm) && this.proj.inside(f.fpm, 20 * f.s);
    }

    const av = pl.avionics;
    const st = pl.stores;
    f.selected = st.selectedDef();
    f.designated = av.target;
    const ls = av.lockState(f.selected, sim);
    f.lock.status = ls.status;
    f.lock.progress = ls.progress;
    f.lock.target = ls.target;

    evaluateWarnings(pl.telemetry, pl.position.x, pl.position.z, sim.services.terrain.mapRadius, f.warnings);
    let missiles = 0;
    let launches = 0;
    let locks = 0;
    for (const t of av.threats) {
      if (t.kind === 'missile') missiles++;
      else if (t.kind === 'launch') launches++;
      else if (t.kind === 'track') locks++;
    }
    f.missileThreats = Math.max(missiles, launches);
    f.lockThreats = locks;
    if (Number.isFinite(pl.telemetry.gLoad)) this.maxG = Math.max(this.maxG, pl.telemetry.gLoad);
    f.maxG = this.maxG;
    this.updateOwnMissiles(f);
    return f;
  }

  private updateOwnMissiles(f: HudFrame): void {
    const list = this.ownMissiles;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].removed || !list[i].alive) list.splice(i, 1);
    const tgt = f.designated;
    if (!tgt || !list.length) return;
    let best = Infinity;
    let n = 0;
    for (const m of list) {
      if ((m as Partial<MissileLike>).target !== tgt.entity) continue;
      n++;
      const dist = m.position.distanceTo(tgt.position);
      const vc = closureRate(m.position, m.velocity, tgt.position, tgt.velocity);
      best = Math.min(best, dist / Math.max(30, vc));
    }
    f.ownMissiles.count = n;
    f.ownMissiles.timeToGo = n > 0 && Number.isFinite(best) ? best : -1;
  }

  // ---------------------------------------------------------------- 그리기

  private drawPlayerHud(f: HudFrame): void {
    const p = f.player!;
    if (f.boreOk) drawPitchLadder(f);
    drawRollScale(f);
    drawHeadingTape(f);
    drawSpeedTape(f);
    drawAltitudeTape(f);
    drawTrackMarkers(f, this.targetState);
    drawDesignatedTarget(f);
    drawDlz(f);
    drawGunSight(f);
    drawCcip(f);
    drawFlightPathMarker(f);
    drawBoresight(f);
    if (f.sim.settings.controlMode === 'mouseAim') {
      const ctl = p.controller as MouseAimController | null;
      if (ctl?.aimDirection && ctl.mouseAimActive !== false) drawMouseAim(f, _fwd.copy(ctl.aimDirection));
    }
    drawKillPopups(f, this.feed);
    drawThreatWarnings(f);
    drawFlightWarnings(f);
    drawEventFeed(f, this.feed);

    const L = scopeLayout(f, this.scopes);
    drawRwr(f, L);
    const markers = (f.sim.services.mission as MissionWithMarkers).markers ?? null;
    drawMinimap(f, L, this.minimap, this.targetState.tracked, markers);
    drawDamagePanel(f, L.mapX + L.mapR + 12 * f.s, L.mapY + L.mapR + 4 * f.s);
    drawWeaponPanel(f);
    drawDamageFlash(f, this.damageGradient, this.hitTime);
  }

  private drawCommon(f: HudFrame, withPlayer: boolean): void {
    const s = f.s;
    drawMissionPanel(f, f.sim.services.mission.state, this.objectiveChanged);
    drawNotice(f, this.notice);
    const L = this.scopes;
    const left = withPlayer ? L.mapX + L.mapR + 12 * s + 128 * s : MARGIN * s;
    const right = withPlayer ? f.W - MARGIN * s - 236 * s : f.W - MARGIN * s;
    drawRadio(f, this.radio, this.radioLayout, left, right);
    drawMissionEnd(f, this.missionEnd);
  }
}
