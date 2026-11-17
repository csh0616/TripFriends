/// <reference types="jest" />
// TASK-015 §22 막는 1 (Jest 몫): a2 "지도에서 찍기" — 이름 칸에 포커스가 있는 채 키보드 숨김 신호가 와도 시트가 내려가지 않고, [여기로 정했어] 한 번으로 넘어간다.
// 로직 · 가드레일만 본다 (모습은 보지 않는다). 실제 탭이 앱에 닿는지는 Maestro `lodging-pin-keyboard.yaml` 몫 (Jest의 누름은 시트 위치와 상관없이 닿는다).
// 근거: TASK-015 §22 "키보드 한 번 누르기 고침 승인"(원인: 칸이 블러되지 않았는데 키보드 숨김 신호가 와서 시트가 내려가고 그 사이 탭이 앱에 닿지 않음 ->
//       칸에 포커스가 있는 동안은 숨김 신호로 시트를 내리지 않음) · §21 막는 1(키보드가 열린 채 [여기로 정했어] 한 번 -> 다음 화면, AC-5) ·
//       §18 막는 것 1 · task-015-design §1-3 키보드(이름 칸을 누르면 시트가 키보드 위로)
//
// 계약 (이 파일이 정한 것):
//   키보드 신호 = DeviceEventEmitter의 keyboardWillShow/keyboardDidShow · keyboardWillHide/keyboardDidHide (화면은 iOS Will · 안드로이드 Did를 듣는다 — 둘 다 보낸다)
//   시트가 올라간 양 = task-015-s18-screens의 lift() 식과 같다 (pick-panel과 조상들의 bottom · marginBottom 합 + 조상 paddingBottom − translateY)
//   이름 칸(pick-label) 포커스 -> 키보드 올라옴(336) -> 글 입력 -> 포커스 그대로 숨김 신호: 그 직후 pick-confirm 한 번 -> onConfirm 한 번(핀 · 이름)
//   경계: 포커스가 없을 때 숨김 신호 -> 시트가 바닥으로. 블러 -> 바닥으로
//   **TASK-015 §24 42번 + 승현 답(11-18)**: 키보드가 내려가면 시트도 내린다 — 포커스가 있어도 숨김 신호면 바닥으로(옛: 키보드 위에 그대로).
//     추가 규칙(원문): "버튼을 누르는 중(pressIn~pressOut)에 숨김 신호가 오면 시트는 손을 뗄 때까지 그대로 두고, 뗀 뒤에 내려. 누름은 그대로 처리돼야 해."
//     -> pick-confirm pressIn -> 숨김 신호 -> (그 사이 시트 336 이상 그대로) -> pressOut · press: onConfirm 한 번, 그 뒤 시트가 바닥으로
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DeviceEventEmitter, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LodgingPickScreen, type LodgingPickResult, type PickedLodging } from '@/trips/lodging-pick-screen';

type Host = { type: unknown; props: Record<string, any>; parent: Host | null };

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const CENTER = { lat: 34.6662, lng: 135.501 };
const SPOT = { lat: 34.657913, lng: 135.506271 };
const KEYBOARD = 336;
const keyboardEvent = (height: number) => ({
  endCoordinates: { height, screenY: 844 - height, screenX: 0, width: 390 },
  startCoordinates: { height: 0, screenY: 844, screenX: 0, width: 390 },
  duration: 0,
  easing: 'keyboard',
  isEventFromThisApp: true,
});

let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockImplementation((() => {
    throw new Error('a2 화면은 네트워크를 부르지 않는다');
  }) as never);
});
afterEach(() => {
  fetchSpy.mockRestore();
});

async function showPick() {
  const confirm = jest.fn(async (_picked: PickedLodging): Promise<LodgingPickResult> => ({ ok: true }));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <LodgingPickScreen cityCode="osaka" center={CENTER} onConfirm={confirm} onBack={jest.fn()} initial={{ pin: SPOT, label: null, tooFar: false }} />
    </SafeAreaProvider>,
  );
  return confirm;
}

const flat = (host: Host) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
const num = (value: unknown) => (typeof value === 'number' ? value : 0);
const chain = (host: Host): Host[] => {
  const out: Host[] = [];
  for (let node: Host | null = host; node; node = node.parent) out.push(node);
  return out;
};

function lift(): number {
  const panel = screen.getByTestId('pick-panel') as unknown as Host;
  let total = 0;
  for (const node of chain(panel)) {
    const style = flat(node);
    total += num(style.bottom) + num(style.marginBottom);
    if (node !== panel) total += num(style.paddingBottom);
    for (const t of (style.transform ?? []) as Record<string, unknown>[]) total -= num(t.translateY);
  }
  return total;
}

async function layoutAncestors() {
  const panel = screen.getByTestId('pick-panel') as unknown as Host;
  for (const node of chain(panel)) {
    if (typeof node.props.onLayout !== 'function') continue;
    await act(async () => {
      node.props.onLayout({ persist() {}, nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
    });
  }
}

async function keyboardShow() {
  await act(async () => {
    DeviceEventEmitter.emit('keyboardWillShow', keyboardEvent(KEYBOARD));
  });
  await act(async () => {
    DeviceEventEmitter.emit('keyboardDidShow', keyboardEvent(KEYBOARD));
  });
}

async function keyboardHideSignal() {
  await act(async () => {
    DeviceEventEmitter.emit('keyboardWillHide', keyboardEvent(0));
  });
  await act(async () => {
    DeviceEventEmitter.emit('keyboardDidHide', keyboardEvent(0));
  });
}

async function focusAndType(text: string) {
  await act(async () => {
    fireEvent(screen.getByTestId('pick-label'), 'focus');
  });
  await keyboardShow();
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('pick-label'), text);
  });
}

describe('§22 막는 1 — 이름 칸 포커스 중 키보드 숨김 신호', () => {
  // §24 42번(승현 승인 11-18): 옛 "시트는 키보드 위에 그대로" -> 누르지 않는 중이면 포커스가 있어도 바로 바닥으로
  test('T15_S24_42_포커스_그대로_숨김_신호가_오면_누르는_중이_아니면_시트가_바로_바닥으로', async () => {
    await showPick();
    await layoutAncestors();
    await focusAndType('친구 집');
    expect(lift()).toBeGreaterThanOrEqual(KEYBOARD); // 시험 자체 확인: 키보드 위로 올라갔다
    await keyboardHideSignal();
    expect(lift()).toBeLessThan(KEYBOARD);
  });

  test('T15_S22_1_포커스_그대로_숨김_신호_직후_여기로_정했어_한_번이면_onConfirm이_한_번(핀·이름)', async () => {
    const confirm = await showPick();
    await layoutAncestors();
    await focusAndType('친구 집');
    await keyboardHideSignal(); // §24: 시트 위치 단언은 뺌(승현 승인 11-18) — 누름이 한 번에 넘어가는지만 본다
    await act(async () => {
      fireEvent.press(screen.getByTestId('pick-confirm'));
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toEqual({ lat: SPOT.lat, lng: SPOT.lng, label: '친구 집' });
  });

  test('T15_S22_1_경계_포커스가_없을_때_숨김_신호는_시트를_바닥으로', async () => {
    await showPick();
    await layoutAncestors();
    await keyboardShow();
    expect(lift()).toBeGreaterThanOrEqual(KEYBOARD); // 시험 자체 확인
    await keyboardHideSignal();
    expect(lift()).toBeLessThan(KEYBOARD);
  });

  test('T15_S22_1_경계_숨김_신호_뒤_칸이_블러되면_시트가_바닥으로', async () => {
    await showPick();
    await layoutAncestors();
    await focusAndType('친구 집');
    await keyboardHideSignal();
    await act(async () => {
      fireEvent(screen.getByTestId('pick-label'), 'blur');
    });
    expect(lift()).toBeLessThan(KEYBOARD);
  });

  // §24 승현 추가 규칙(11-18): 누르는 중(pressIn~pressOut) 숨김 신호 -> 뗄 때까지 시트 그대로, 뗀 뒤 내림. 누름은 그대로 처리
  test('T15_S24_42_누르는_중_숨김_신호면_뗄_때까지_시트_그대로이고_누름은_한_번_처리된_뒤_시트가_바닥으로', async () => {
    const confirm = await showPick();
    await layoutAncestors();
    await focusAndType('친구 집');
    const button = screen.getByTestId('pick-confirm');
    await act(async () => {
      fireEvent(button, 'pressIn');
    });
    await keyboardHideSignal();
    expect(lift()).toBeGreaterThanOrEqual(KEYBOARD); // 누르는 중: 시트 그대로
    expect(confirm).not.toHaveBeenCalled(); // 아직 손을 떼지 않았다
    await act(async () => {
      fireEvent(button, 'pressOut');
    });
    await act(async () => {
      fireEvent.press(button);
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toEqual({ lat: SPOT.lat, lng: SPOT.lng, label: '친구 집' });
    expect(lift()).toBeLessThan(KEYBOARD); // 뗀 뒤 내림
  });

  test('T15_S24_42_경계_누르는_중이_아니면(pressIn_없음)_숨김_신호에_바로_내려가고_그_뒤_누름도_한_번', async () => {
    const confirm = await showPick();
    await layoutAncestors();
    await focusAndType('친구 집');
    await keyboardHideSignal();
    expect(lift()).toBeLessThan(KEYBOARD);
    await act(async () => {
      fireEvent.press(screen.getByTestId('pick-confirm'));
    });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test('T15_S24_42_경계_뗀_뒤에_온_숨김_신호는_바로_내린다(누름_끝)', async () => {
    await showPick();
    await layoutAncestors();
    await focusAndType('친구 집');
    const button = screen.getByTestId('pick-confirm');
    await act(async () => {
      fireEvent(button, 'pressIn');
    });
    await act(async () => {
      fireEvent(button, 'pressOut');
    });
    expect(lift()).toBeGreaterThanOrEqual(KEYBOARD); // 시험 자체 확인: 숨김 신호 전엔 키보드 위
    await keyboardHideSignal();
    expect(lift()).toBeLessThan(KEYBOARD);
  });
});
