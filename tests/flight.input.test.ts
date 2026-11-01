import { describe, expect, it } from 'vitest';
import { ACTION_IDS, DEFAULT_BINDINGS, InputManager, LONG_PRESS_TIME, bindingLabel, keyLabel } from '../src/flight/input';

const DT = 1 / 60;

function steps(input: InputManager, secs: number): void {
  for (let i = 0; i < Math.round(secs / DT); i++) input.poll(DT);
}

function fakePad(overrides: { axes?: number[]; buttons?: Record<number, number> } = {}): Gamepad {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const v = overrides.buttons?.[i] ?? 0;
    return { pressed: v > 0.5, touched: v > 0, value: v } as GamepadButton;
  });
  return { connected: true, axes: overrides.axes ?? [0, 0, 0, 0], buttons, id: 'test', index: 0, mapping: 'standard', timestamp: 0 } as unknown as Gamepad;
}

describe('DEFAULT_BINDINGS', () => {
  it('모든 동작에 한국어 이름이 있고 GDD 기본 키를 따른다', () => {
    for (const id of ACTION_IDS) {
      expect(DEFAULT_BINDINGS[id].label.length).toBeGreaterThan(0);
      expect(/[가-힣]/.test(DEFAULT_BINDINGS[id].label)).toBe(true);
    }
    expect(DEFAULT_BINDINGS.fire.keys).toContain('Space');
    expect(DEFAULT_BINDINGS.gun.mouse).toContain(0);
    expect(DEFAULT_BINDINGS.gun.keys).toContain('KeyF');
    expect(DEFAULT_BINDINGS.target.keys).toContain('Tab');
    expect(DEFAULT_BINDINGS.accelerate.keys).toContain('ShiftLeft');
    expect(DEFAULT_BINDINGS.brake.keys).toContain('ControlLeft');
    expect(DEFAULT_BINDINGS.countermeasures.keys).toContain('KeyC');
    expect(DEFAULT_BINDINGS.wingAttack.keys).toContain('Digit1');
    expect(DEFAULT_BINDINGS.pause.keys).toContain('Escape');
  });

  it('표시 문자열', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('ShiftLeft')).toBe('Shift');
    expect(bindingLabel(DEFAULT_BINDINGS.gun)).toBe('마우스 왼쪽 / F');
  });
});

describe('InputManager', () => {
  it('pressed/released 에지와 held', () => {
    const input = new InputManager({ gamepads: () => [] });
    input.handleKey('Space', true);
    input.poll(DT);
    expect(input.pressed('fire')).toBe(true);
    expect(input.held('fire')).toBe(true);
    input.poll(DT);
    expect(input.pressed('fire')).toBe(false);
    input.handleKey('Space', false);
    input.poll(DT);
    expect(input.released('fire')).toBe(true);
    expect(input.held('fire')).toBe(false);
  });

  it('poll 사이에 눌렀다 뗀 빠른 탭도 놓치지 않는다', () => {
    const input = new InputManager({ gamepads: () => [] });
    input.handleKey('Tab', true);
    input.handleKey('Tab', false);
    input.poll(DT);
    expect(input.pressed('target')).toBe(true);
    expect(input.tapped('target')).toBe(true);
  });

  it('짧게 = tapped, 길게 = longPressed (한 번만)', () => {
    const input = new InputManager({ gamepads: () => [] });
    input.handleKey('Tab', true);
    steps(input, 0.1);
    input.handleKey('Tab', false);
    input.poll(DT);
    expect(input.tapped('target')).toBe(true);
    expect(input.longPressed('target')).toBe(false);

    input.handleKey('Tab', true);
    let longCount = 0;
    for (let i = 0; i < 60; i++) {
      input.poll(DT);
      if (input.longPressed('target')) longCount++;
    }
    expect(longCount).toBe(1);
    expect(input.holdTime('target')).toBeGreaterThan(LONG_PRESS_TIME);
    input.handleKey('Tab', false);
    input.poll(DT);
    expect(input.tapped('target')).toBe(false);
    expect(input.released('target')).toBe(true);
  });

  it('키보드 축은 부드럽게 증감한다', () => {
    const input = new InputManager({ gamepads: () => [] });
    input.handleKey('KeyS', true); // 기수 올림
    input.poll(DT);
    expect(input.axes.pitch).toBeGreaterThan(0);
    expect(input.axes.pitch).toBeLessThan(0.2);
    steps(input, 0.5);
    expect(input.axes.pitch).toBe(1);
    input.handleKey('KeyS', false);
    input.poll(DT);
    expect(input.axes.pitch).toBeGreaterThan(0.5);
    steps(input, 0.3);
    expect(input.axes.pitch).toBe(0);
    // 반대 방향 전환은 0 을 거쳐 간다
    input.handleKey('KeyD', true);
    steps(input, 0.5);
    expect(input.axes.roll).toBe(1);
    input.handleKey('KeyD', false);
    input.handleKey('KeyA', true);
    input.poll(DT);
    expect(input.axes.roll).toBeGreaterThan(0);
    steps(input, 0.6);
    expect(input.axes.roll).toBe(-1);
  });

  it('마우스 이동은 채널별로 누적/소비된다', () => {
    const input = new InputManager({ gamepads: () => [] });
    input.handleMouseMove(10, -4);
    input.handleMouseMove(5, 0);
    expect(input.consumeMouseDelta('aim')).toEqual({ x: 15, y: -4 });
    expect(input.consumeMouseDelta('aim')).toEqual({ x: 0, y: 0 });
    expect(input.consumeMouseDelta('look')).toEqual({ x: 15, y: -4 });
  });

  it('마우스 버튼 바인딩 (좌클릭 = 기관포, 우클릭 = 둘러보기)', () => {
    const input = new InputManager({ gamepads: () => [] });
    input.handleMouseButton(0, true);
    input.handleMouseButton(2, true);
    input.poll(DT);
    expect(input.held('gun')).toBe(true);
    expect(input.held('freeLook')).toBe(true);
  });

  it('게임패드: 왼쪽 스틱 = 피치/롤 (앞으로 = 기수 내림), 트리거 = 가속/감속, 버튼', () => {
    let pad = fakePad({ axes: [0.6, -1, 0, 0], buttons: { 7: 1, 0: 1 } });
    const input = new InputManager({ gamepads: () => [pad] });
    input.poll(DT);
    expect(input.gamepadConnected).toBe(true);
    expect(input.axes.roll).toBeGreaterThan(0.4);
    expect(input.axes.pitch).toBeLessThan(-0.8); // 대각선은 단위원으로 정규화
    expect(input.axes.accel).toBe(1);
    expect(input.pressed('fire')).toBe(true);
    // 데드존
    pad = fakePad({ axes: [0.05, 0.08, 0, 0], buttons: { 6: 0.5 } });
    input.poll(DT);
    expect(input.axes.roll).toBe(0);
    expect(input.axes.pitch).toBe(0);
    expect(input.axes.brake).toBeGreaterThan(0.4);
    expect(input.axes.brake).toBeLessThan(0.6);
    expect(input.released('fire')).toBe(true);
  });

  it('enabled = false 면 중립', () => {
    const input = new InputManager({ gamepads: () => [] });
    input.handleKey('Space', true);
    input.handleKey('KeyS', true);
    input.enabled = false;
    steps(input, 0.5);
    expect(input.pressed('fire')).toBe(false);
    expect(input.held('fire')).toBe(false);
    expect(input.axes.pitch).toBe(0);
  });

  it('releaseAll (포커스 잃음) 은 떼기로 처리', () => {
    const input = new InputManager({ gamepads: () => [] });
    input.handleKey('KeyF', true);
    input.poll(DT);
    input.releaseAll();
    input.poll(DT);
    expect(input.held('gun')).toBe(false);
    expect(input.released('gun')).toBe(true);
  });
});
