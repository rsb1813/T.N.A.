// 입력: 키보드 + 마우스 + 게임패드(표준 매핑). 동작(action) 단위로 읽는다.
//
//   const input = new InputManager();
//   input.attach(canvas);          // DOM 이벤트 연결 (detach() 로 해제)
//   input.poll(dt);                // 시뮬레이션 스텝마다 한 번 (PlayerController 가 호출)
//   input.axes.pitch / roll / yaw  // -1..1 (키보드는 부드럽게 증감)
//   input.pressed('fire'), input.tapped('target'), input.longPressed('target'), input.held('gun')
//   input.consumeMouseDelta('aim') // 채널별 누적 마우스 이동 (aim = 마우스 에임, look = 카메라)
//
// pressed/released/tapped/longPressed 는 poll() 사이의 이벤트를 놓치지 않도록 래치한다.
// held() 는 원시 상태라 렌더 프레임(카메라)에서 읽어도 된다.

export type ActionId =
  | 'pitchUp'
  | 'pitchDown'
  | 'rollLeft'
  | 'rollRight'
  | 'yawLeft'
  | 'yawRight'
  | 'accelerate'
  | 'brake'
  | 'fire'
  | 'gun'
  | 'weaponNext'
  | 'target'
  | 'countermeasures'
  | 'flare'
  | 'chaff'
  | 'jammer'
  | 'radarMode'
  | 'jettison'
  | 'view'
  | 'freeLook'
  | 'targetView'
  | 'missileCam'
  | 'wingAttack'
  | 'wingCover'
  | 'wingFormation'
  | 'wingEngageFree'
  | 'map'
  | 'pause';

export interface ActionBinding {
  /** 설정 화면 표시용 이름 (한국어) */
  label: string;
  /** KeyboardEvent.code 목록 */
  keys: string[];
  /** 마우스 버튼 (0 왼쪽, 1 가운데, 2 오른쪽) */
  mouse?: number[];
  /** 표준 게임패드 버튼 인덱스 */
  pad?: number[];
  /** 게임패드 표시 문자열 (축 동작 포함) */
  padLabel?: string;
}

export type BindingMap = Record<ActionId, ActionBinding>;

/** 기본 조작 (docs/GDD.md §10). 피치는 비행 스틱 규칙: W = 기수 내림, S = 기수 올림 */
export const DEFAULT_BINDINGS: Readonly<BindingMap> = Object.freeze({
  pitchUp: { label: '기수 올림', keys: ['KeyS'], padLabel: '왼쪽 스틱 ↓' },
  pitchDown: { label: '기수 내림', keys: ['KeyW'], padLabel: '왼쪽 스틱 ↑' },
  rollLeft: { label: '왼쪽 롤', keys: ['KeyA'], padLabel: '왼쪽 스틱 ←' },
  rollRight: { label: '오른쪽 롤', keys: ['KeyD'], padLabel: '왼쪽 스틱 →' },
  yawLeft: { label: '왼쪽 요', keys: ['KeyQ'], pad: [4], padLabel: 'LB' },
  yawRight: { label: '오른쪽 요', keys: ['KeyE'], pad: [5], padLabel: 'RB' },
  accelerate: { label: '가속 (애프터버너)', keys: ['ShiftLeft', 'ShiftRight'], pad: [7], padLabel: 'RT' },
  brake: { label: '감속 (에어브레이크)', keys: ['ControlLeft', 'ControlRight'], pad: [6], padLabel: 'LT' },
  fire: { label: '미사일/폭탄 발사', keys: ['Space'], pad: [0], padLabel: 'A' },
  gun: { label: '기관포', keys: ['KeyF'], mouse: [0], pad: [2], padLabel: 'X' },
  weaponNext: { label: '무장 전환', keys: ['KeyR'], pad: [3], padLabel: 'Y' },
  target: { label: '표적 전환 (짧게) / 정면 표적 (길게)', keys: ['Tab'], pad: [1], padLabel: 'B' },
  countermeasures: { label: '플레어 + 채프', keys: ['KeyC'], pad: [11], padLabel: '오른쪽 스틱 누르기' },
  flare: { label: '플레어', keys: ['KeyZ'] },
  chaff: { label: '채프', keys: ['KeyX'] },
  jammer: { label: '재머 켜기/끄기', keys: ['KeyJ'] },
  radarMode: { label: '레이더 모드 전환', keys: ['KeyI'] },
  jettison: { label: '외부 무장 투하 (길게)', keys: ['Backspace'] },
  view: { label: '시점 전환', keys: ['KeyV'], pad: [10], padLabel: '왼쪽 스틱 누르기' },
  freeLook: { label: '둘러보기 (누르는 동안)', keys: [], mouse: [2], padLabel: '오른쪽 스틱' },
  targetView: { label: '표적 시점 (누르는 동안)', keys: ['KeyT'] },
  missileCam: { label: '미사일 시점', keys: ['KeyB'] },
  wingAttack: { label: '윙맨: 공격', keys: ['Digit1'], pad: [12], padLabel: '십자키 ↑' },
  wingCover: { label: '윙맨: 엄호', keys: ['Digit2'], pad: [15], padLabel: '십자키 →' },
  wingFormation: { label: '윙맨: 편대 복귀', keys: ['Digit3'], pad: [13], padLabel: '십자키 ↓' },
  wingEngageFree: { label: '윙맨: 자유 교전', keys: ['Digit4'], pad: [14], padLabel: '십자키 ←' },
  map: { label: '지도', keys: ['KeyM'], pad: [8], padLabel: 'Back' },
  pause: { label: '일시정지', keys: ['Escape', 'KeyP'], pad: [9], padLabel: 'Start' },
} satisfies BindingMap);

export const ACTION_IDS = Object.keys(DEFAULT_BINDINGS) as ActionId[];

/** 설정 화면 표시용 키 이름 */
export function keyLabel(code: string): string {
  const special: Record<string, string> = {
    Space: 'Space',
    Tab: 'Tab',
    Escape: 'Esc',
    Backspace: 'Backspace',
    Enter: 'Enter',
    ShiftLeft: 'Shift',
    ShiftRight: '오른쪽 Shift',
    ControlLeft: 'Ctrl',
    ControlRight: '오른쪽 Ctrl',
    AltLeft: 'Alt',
    AltRight: '오른쪽 Alt',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
  };
  if (special[code]) return special[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `숫자패드 ${code.slice(6)}`;
  return code;
}

export function mouseButtonLabel(button: number): string {
  return button === 0 ? '마우스 왼쪽' : button === 1 ? '마우스 가운데' : button === 2 ? '마우스 오른쪽' : `마우스 ${button}`;
}

/** 키보드+마우스 바인딩 표시 문자열 (예: 'Shift / 오른쪽 Shift', '마우스 왼쪽 / F') */
export function bindingLabel(b: ActionBinding): string {
  const parts = [...(b.mouse ?? []).map(mouseButtonLabel), ...b.keys.map(keyLabel)];
  return parts.join(' / ');
}

const BINDINGS_KEY = 'tna.bindings.v1';

export function cloneBindings(src: Readonly<BindingMap> = DEFAULT_BINDINGS): BindingMap {
  const out = {} as BindingMap;
  for (const id of ACTION_IDS) {
    const b = src[id] ?? DEFAULT_BINDINGS[id];
    out[id] = { label: DEFAULT_BINDINGS[id].label, keys: [...b.keys], mouse: b.mouse ? [...b.mouse] : undefined, pad: b.pad ? [...b.pad] : undefined, padLabel: b.padLabel };
  }
  return out;
}

/** localStorage 에 저장된 사용자 바인딩 (없으면 기본값) */
export function loadBindings(): BindingMap {
  try {
    const raw = globalThis.localStorage?.getItem(BINDINGS_KEY);
    if (!raw) return cloneBindings();
    const parsed = JSON.parse(raw) as Partial<Record<ActionId, Partial<ActionBinding>>>;
    const out = cloneBindings();
    for (const id of ACTION_IDS) {
      const p = parsed[id];
      if (!p) continue;
      if (Array.isArray(p.keys)) out[id].keys = p.keys.filter((k) => typeof k === 'string');
      if (Array.isArray(p.mouse)) out[id].mouse = p.mouse.filter((k) => typeof k === 'number');
      if (Array.isArray(p.pad)) out[id].pad = p.pad.filter((k) => typeof k === 'number');
    }
    return out;
  } catch {
    return cloneBindings();
  }
}

export function saveBindings(b: BindingMap): void {
  try {
    const slim: Partial<Record<ActionId, Pick<ActionBinding, 'keys' | 'mouse' | 'pad'>>> = {};
    for (const id of ACTION_IDS) slim[id] = { keys: b[id].keys, mouse: b[id].mouse, pad: b[id].pad };
    globalThis.localStorage?.setItem(BINDINGS_KEY, JSON.stringify(slim));
  } catch {
    /* 저장 불가 환경 무시 */
  }
}

// ---------------------------------------------------------------- 상수

/** 길게 누름 판정 (s) */
export const LONG_PRESS_TIME = 0.35;
/** 키보드 축 증가 속도 (1/s) */
const KEY_RISE = { pitch: 3.2, roll: 4.5, yaw: 3 } as const;
/** 키보드 축 복귀 속도 (1/s) */
const KEY_RETURN = 7;
const STICK_DEADZONE = 0.15;
const TRIGGER_DEADZONE = 0.06;

export type MouseChannel = 'aim' | 'look';

export interface InputAxes {
  /** + = 기수 올림 (반전 설정 미적용 원값) */
  pitch: number;
  /** + = 오른쪽 */
  roll: number;
  /** + = 기수 오른쪽 */
  yaw: number;
  /** 가속 0..1 (트리거 아날로그) */
  accel: number;
  /** 감속 0..1 */
  brake: number;
  /** 오른쪽 스틱 (둘러보기) -1..1, + = 오른쪽 / 위 */
  lookX: number;
  lookY: number;
}

interface ActionState {
  held: boolean;
  pressed: boolean;
  released: boolean;
  tapped: boolean;
  longPressed: boolean;
  holdTime: number;
  longFired: boolean;
}

type GamepadSource = () => ArrayLike<Gamepad | null> | null | undefined;

export interface InputManagerOptions {
  bindings?: BindingMap;
  /** 게임패드 공급자 (테스트용). 기본 navigator.getGamepads */
  gamepads?: GamepadSource;
  /** 클릭 시 포인터 잠금 요청 (기본 false — 마우스 에임 모드에서 통합이 켠다) */
  pointerLockOnClick?: boolean;
}

export class InputManager {
  bindings: BindingMap;
  /** false 면 모든 입력이 중립 (메뉴 등) */
  enabled = true;
  pointerLockOnClick: boolean;
  readonly axes: InputAxes = { pitch: 0, roll: 0, yaw: 0, accel: 0, brake: 0, lookX: 0, lookY: 0 };
  /** 마지막으로 쓰인 장치 (UI 힌트용) */
  lastDevice: 'keyboard' | 'mouse' | 'gamepad' = 'keyboard';
  pointerLocked = false;

  private keysDown = new Set<string>();
  private mouseDown = new Set<number>();
  /** poll 사이에 눌렸다/떼진 키 (빠른 탭을 놓치지 않기 위해) */
  private keyPressLatch = new Set<string>();
  private keyReleaseLatch = new Set<string>();
  private mousePressLatch = new Set<number>();
  private mouseReleaseLatch = new Set<number>();
  private padButtons: boolean[] = [];
  private padAxes = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };
  private padPresent = false;
  private mouseAcc: Record<MouseChannel, { x: number; y: number }> = { aim: { x: 0, y: 0 }, look: { x: 0, y: 0 } };
  private wheelAcc = 0;
  private keyAxes = { pitch: 0, roll: 0, yaw: 0 };
  private states = new Map<ActionId, ActionState>();
  private readonly gamepads: GamepadSource;
  private element: HTMLElement | null = null;
  private listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions | undefined]> = [];

  constructor(opts: InputManagerOptions = {}) {
    this.bindings = opts.bindings ?? cloneBindings();
    this.pointerLockOnClick = opts.pointerLockOnClick ?? false;
    this.gamepads =
      opts.gamepads ??
      (() => (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : null));
    for (const id of ACTION_IDS) {
      this.states.set(id, { held: false, pressed: false, released: false, tapped: false, longPressed: false, holdTime: 0, longFired: false });
    }
  }

  // ---------------------------------------------------------------- DOM

  attach(element: HTMLElement): void {
    if (this.element) this.detach();
    this.element = element;
    const on = (target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, opts);
      this.listeners.push([target, type, fn, opts]);
    };
    const win = typeof window !== 'undefined' ? window : null;
    const doc = typeof document !== 'undefined' ? document : null;
    if (win) {
      on(win, 'keydown', ((e: KeyboardEvent) => this.onKeyDown(e)) as EventListener);
      on(win, 'keyup', ((e: KeyboardEvent) => this.onKeyUp(e)) as EventListener);
      on(win, 'mouseup', ((e: MouseEvent) => this.handleMouseButton(e.button, false)) as EventListener);
      on(win, 'mousemove', ((e: MouseEvent) => this.onMouseMove(e)) as EventListener);
      on(win, 'blur', () => this.releaseAll());
    }
    on(element, 'mousedown', ((e: MouseEvent) => this.onMouseDown(e)) as EventListener);
    on(element, 'contextmenu', (e) => e.preventDefault());
    on(element, 'wheel', ((e: WheelEvent) => this.handleWheel(e.deltaY)) as EventListener, { passive: true });
    if (doc) {
      on(doc, 'pointerlockchange', () => {
        this.pointerLocked = doc.pointerLockElement === this.element;
      });
      on(doc, 'visibilitychange', () => {
        if (doc.hidden) this.releaseAll();
      });
    }
  }

  detach(): void {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.listeners = [];
    if (this.pointerLocked && typeof document !== 'undefined') document.exitPointerLock?.();
    this.element = null;
    this.releaseAll();
  }

  requestPointerLock(): void {
    const el = this.element as (HTMLElement & { requestPointerLock?: () => unknown }) | null;
    try {
      const r = el?.requestPointerLock?.();
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
    } catch {
      /* 사용자 제스처 밖이면 거부될 수 있다 */
    }
  }

  exitPointerLock(): void {
    if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
  }

  private isTyping(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    if (!t || !t.tagName) return false;
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.isTyping(e)) return;
    if (this.isBoundKey(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.handleKey(e.code, true);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.handleKey(e.code, false);
  }

  private onMouseDown(e: MouseEvent): void {
    if (this.pointerLockOnClick && !this.pointerLocked && e.button === 0) this.requestPointerLock();
    this.handleMouseButton(e.button, true);
  }

  private onMouseMove(e: MouseEvent): void {
    this.handleMouseMove(e.movementX || 0, e.movementY || 0);
  }

  private isBoundKey(code: string): boolean {
    for (const id of ACTION_IDS) if (this.bindings[id].keys.includes(code)) return true;
    return false;
  }

  // ---------------------------------------------------------------- 원시 입력 주입 (DOM 핸들러 + 테스트/가상 버튼)

  handleKey(code: string, down: boolean): void {
    if (down) {
      if (!this.keysDown.has(code)) this.keyPressLatch.add(code);
      this.keysDown.add(code);
    } else {
      if (this.keysDown.has(code)) this.keyReleaseLatch.add(code);
      this.keysDown.delete(code);
    }
    this.lastDevice = 'keyboard';
  }

  handleMouseButton(button: number, down: boolean): void {
    if (down) {
      if (!this.mouseDown.has(button)) this.mousePressLatch.add(button);
      this.mouseDown.add(button);
    } else {
      if (this.mouseDown.has(button)) this.mouseReleaseLatch.add(button);
      this.mouseDown.delete(button);
    }
    this.lastDevice = 'mouse';
  }

  handleMouseMove(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    for (const ch of Object.values(this.mouseAcc)) {
      ch.x += dx;
      ch.y += dy;
    }
    if (dx !== 0 || dy !== 0) this.lastDevice = 'mouse';
  }

  handleWheel(deltaY: number): void {
    if (Number.isFinite(deltaY)) this.wheelAcc += deltaY;
  }

  /** 모든 키/버튼 해제 (창 포커스 잃음) */
  releaseAll(): void {
    for (const k of this.keysDown) this.keyReleaseLatch.add(k);
    for (const b of this.mouseDown) this.mouseReleaseLatch.add(b);
    this.keysDown.clear();
    this.mouseDown.clear();
  }

  // ---------------------------------------------------------------- 읽기

  /** 원시 누름 상태 (렌더 프레임에서 읽어도 됨) */
  held(action: ActionId): boolean {
    if (!this.enabled) return false;
    return this.rawHeld(action);
  }

  /** 이번 poll 에서 새로 눌림 */
  pressed(action: ActionId): boolean {
    return this.enabled && this.state(action).pressed;
  }

  released(action: ActionId): boolean {
    return this.enabled && this.state(action).released;
  }

  /** 짧게 눌렀다 뗌 (LONG_PRESS_TIME 미만) — 뗄 때 한 번 */
  tapped(action: ActionId): boolean {
    return this.enabled && this.state(action).tapped;
  }

  /** 길게 누름이 확정된 순간 한 번 */
  longPressed(action: ActionId): boolean {
    return this.enabled && this.state(action).longPressed;
  }

  /** 누르고 있는 시간 (s) */
  holdTime(action: ActionId): number {
    return this.state(action).holdTime;
  }

  /** 채널별 누적 마우스 이동(px)을 꺼내고 0 으로 */
  consumeMouseDelta(channel: MouseChannel, out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
    const acc = this.mouseAcc[channel];
    out.x = this.enabled ? acc.x : 0;
    out.y = this.enabled ? acc.y : 0;
    acc.x = acc.y = 0;
    return out;
  }

  consumeWheel(): number {
    const w = this.wheelAcc;
    this.wheelAcc = 0;
    return this.enabled ? w : 0;
  }

  get gamepadConnected(): boolean {
    return this.padPresent;
  }

  private state(action: ActionId): ActionState {
    return this.states.get(action)!;
  }

  private rawHeld(action: ActionId): boolean {
    const b = this.bindings[action];
    for (const k of b.keys) if (this.keysDown.has(k)) return true;
    if (b.mouse) for (const m of b.mouse) if (this.mouseDown.has(m)) return true;
    if (b.pad) for (const p of b.pad) if (this.padButtons[p]) return true;
    return false;
  }

  private latchedPress(action: ActionId): boolean {
    const b = this.bindings[action];
    for (const k of b.keys) if (this.keyPressLatch.has(k)) return true;
    if (b.mouse) for (const m of b.mouse) if (this.mousePressLatch.has(m)) return true;
    return false;
  }

  private latchedRelease(action: ActionId): boolean {
    const b = this.bindings[action];
    for (const k of b.keys) if (this.keyReleaseLatch.has(k)) return true;
    if (b.mouse) for (const m of b.mouse) if (this.mouseReleaseLatch.has(m)) return true;
    return false;
  }

  // ---------------------------------------------------------------- poll

  /** 스텝마다 한 번: 게임패드 샘플, 에지 계산, 키보드 축 램프 */
  poll(dt: number): void {
    this.pollGamepad();
    const enabled = this.enabled;
    for (const id of ACTION_IDS) {
      const s = this.state(id);
      const wasHeld = s.held;
      const nowHeld = enabled && this.rawHeld(id);
      const latchedDown = enabled && this.latchedPress(id);
      const latchedUp = enabled && this.latchedRelease(id);
      s.pressed = (nowHeld && !wasHeld) || (latchedDown && !wasHeld);
      const releasedNow = (!nowHeld && wasHeld) || (latchedUp && (wasHeld || latchedDown) && !nowHeld);
      s.released = releasedNow;
      s.longPressed = false;
      s.tapped = false;
      if (s.pressed) {
        s.holdTime = 0;
        s.longFired = false;
      }
      if (nowHeld) {
        s.holdTime += dt;
        if (!s.longFired && s.holdTime >= LONG_PRESS_TIME) {
          s.longFired = true;
          s.longPressed = true;
        }
      }
      if (releasedNow) {
        if (!s.longFired) s.tapped = true;
        s.longFired = false;
        s.holdTime = 0;
      }
      s.held = nowHeld;
    }
    this.keyPressLatch.clear();
    this.keyReleaseLatch.clear();
    this.mousePressLatch.clear();
    this.mouseReleaseLatch.clear();
    this.updateAxes(dt);
  }

  private pollGamepad(): void {
    let pad: Gamepad | null = null;
    try {
      const list = this.gamepads();
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const g = list[i];
          if (g && g.connected) {
            pad = g;
            break;
          }
        }
      }
    } catch {
      pad = null;
    }
    this.padPresent = !!pad;
    const a = this.padAxes;
    if (!pad) {
      this.padButtons.length = 0;
      a.lx = a.ly = a.rx = a.ry = a.lt = a.rt = 0;
      return;
    }
    let any = false;
    for (let i = 0; i < pad.buttons.length; i++) {
      const b = pad.buttons[i];
      const down = !!b && (b.pressed || b.value > 0.5);
      this.padButtons[i] = down;
      any ||= down;
    }
    const ax = pad.axes;
    const [lx, ly] = radialDeadzone(ax[0] ?? 0, ax[1] ?? 0);
    const [rx, ry] = radialDeadzone(ax[2] ?? 0, ax[3] ?? 0);
    a.lx = lx;
    a.ly = ly;
    a.rx = rx;
    a.ry = ry;
    a.lt = triggerValue(pad.buttons[6]);
    a.rt = triggerValue(pad.buttons[7]);
    if (any || Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) + a.lt + a.rt > 0) this.lastDevice = 'gamepad';
  }

  private updateAxes(dt: number): void {
    const en = this.enabled;
    const k = this.keyAxes;
    const dir = (pos: ActionId, neg: ActionId) => (en ? (this.rawHeld(pos) ? 1 : 0) - (this.rawHeld(neg) ? 1 : 0) : 0);
    k.pitch = rampAxis(k.pitch, dir('pitchUp', 'pitchDown'), KEY_RISE.pitch, dt);
    k.roll = rampAxis(k.roll, dir('rollRight', 'rollLeft'), KEY_RISE.roll, dt);
    k.yaw = rampAxis(k.yaw, dir('yawRight', 'yawLeft'), KEY_RISE.yaw, dt);
    const p = this.padAxes;
    const out = this.axes;
    // 스틱 앞으로(축 -) = 기수 내림
    out.pitch = en ? pick(k.pitch, p.ly) : 0;
    out.roll = en ? pick(k.roll, p.lx) : 0;
    out.yaw = k.yaw;
    const keyAccel = en && this.keyHeldOnly('accelerate') ? 1 : 0;
    const keyBrake = en && this.keyHeldOnly('brake') ? 1 : 0;
    out.accel = en ? Math.max(keyAccel, p.rt) : 0;
    out.brake = en ? Math.max(keyBrake, p.lt) : 0;
    out.lookX = en ? p.rx : 0;
    out.lookY = en ? -p.ry : 0;
  }

  /** 키보드/마우스 바인딩만으로 눌림 (아날로그 트리거와 분리) */
  private keyHeldOnly(action: ActionId): boolean {
    const b = this.bindings[action];
    for (const kk of b.keys) if (this.keysDown.has(kk)) return true;
    if (b.mouse) for (const m of b.mouse) if (this.mouseDown.has(m)) return true;
    return false;
  }
}

function rampAxis(cur: number, target: number, rise: number, dt: number): number {
  if (target === 0 || Math.sign(target) !== Math.sign(cur) && cur !== 0) {
    // 중립 복귀 (또는 반대 방향 전환 시 먼저 0 으로)
    const next = cur > 0 ? Math.max(0, cur - KEY_RETURN * dt) : Math.min(0, cur + KEY_RETURN * dt);
    if (target === 0 || next !== 0) return next;
    return target * Math.min(1, rise * dt);
  }
  return target > 0 ? Math.min(target, cur + rise * dt) : Math.max(target, cur - rise * dt);
}

function pick(keyVal: number, padVal: number): number {
  return Math.abs(padVal) > Math.abs(keyVal) ? padVal : keyVal;
}

function radialDeadzone(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < STICK_DEADZONE) return [0, 0];
  const s = Math.min(1, (m - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / m;
  return [x * s, y * s];
}

function triggerValue(b: GamepadButton | undefined): number {
  if (!b) return 0;
  const v = b.value ?? (b.pressed ? 1 : 0);
  return v < TRIGGER_DEADZONE ? 0 : Math.min(1, (v - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE));
}
