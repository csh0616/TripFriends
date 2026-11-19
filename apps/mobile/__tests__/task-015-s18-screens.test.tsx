/// <reference types="jest" />
// TASK-015 §18 화면 가드레일: T-08 라벨 "숙소로" · reviewer 막는 것 1(a2 키보드) · 2(a2 빈 흰 원). 로직·가드레일만 본다 (색·간격 값은 보지 않는다).
// 근거: TASK-015 §18 "디자이너 V130"(①-31 같은 말 세 번 -> 카드 라벨을 "숙소로", 이유 줄 "오늘 일정이 끝났어"는 그대로) ·
//       task-014-design §14-4(T-08 ㉡ 카드 라벨을 "숙소로"로 줄이기) · §14-5(숙소 없는 T-08은 본문 "오늘 일정이 끝났어. 오늘도 수고했어!" — 라벨 바꿈과 상관없음) ·
//       TASK-014 §31 Q2(숙소 없는 T-08 제목 "오늘 일정 끝" 그대로) ·
//       TASK-015 §18 reviewer 막는 것 1("a2 이름 칸을 누르면 키보드가 시트를 가림 -> 키보드 위로 시트를 올린다(task-015-design §1-3 키보드 규칙)") ·
//       task-015-design §1-3 키보드("이름 칸을 누르면 시트가 키보드 위로 올라간다(②-07 field와 같은 규칙)") ·
//       막는 것 2("a2 오른쪽 위 빈 흰 원(뒤로 버튼 모양을 자리 채우기에 씀) -> 빈 자리는 그리지 않는다") · task-015-design §1-3 위(뒤로 44 흰 원 + 가운데 알약)
//
// 계약 (이 테스트가 정한 것):
//   T-08 숙소 있음: card-T-08 안에 라벨 글 "숙소로"가 있고 "숙소 가는 법"은 없다. 제목("숙소까지 N분" / "숙소로 돌아가자")·[숙소로 길 안내]는 그대로
//   T-08 숙소 없음: 지금 모양 그대로 ("오늘 일정 끝" 제목 + 본문, "숙소로" 라벨 없음)
//   a2 키보드: 시트를 감싼 판(어느 조상이든)의 onLayout을 화면 전체(0,0,390,844)로 알린 뒤, 키보드 신호(keyboardWillShow · keyboardDidShow,
//     높이 336 · screenY 508)가 오면 pick-panel이 336 이상 올라간다. 올라간 양 = pick-panel과 그 조상들의 style bottom 합 + 조상들의 paddingBottom 합
//     + marginBottom 합 − translateY 합 (KeyboardAvoidingView behavior padding/position이든 키보드 신호로 bottom을 바꾸든 같은 식으로 잡힌다).
//     키보드가 내려가면(keyboardWillHide · keyboardDidHide) 다시 336 미만
//   a2 빈 흰 원: a2 화면에 "흰 면(surface) + 원(radius ≥ 폭/2) + 안에 아무것도 없음 + 누를 수 없음"인 View가 없다. 뒤로 버튼(pick-back)은 그대로 있다
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { DeviceEventEmitter, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NowCardView } from '@/components/now/now-cards';
import { color } from '@/planning/theme';
import { LodgingPickScreen, type LodgingPickResult, type PickedLodging } from '@/trips/lodging-pick-screen';

import { t08 } from '../test-support/trip-now-fixtures';

type Host = { type: unknown; props: Record<string, any>; parent: Host | null; children: (Host | string)[] };

// ---------- T-08 라벨 ----------

async function showT08(card: object, main = true) {
  await render(<NowCardView card={card as never} main={main} onOpenFailed={() => {}} />);
  return within(screen.getByTestId('card-T-08'));
}

describe('§18 T-08 카드 라벨 "숙소로"', () => {
  test.each([true, false])('T15_S18_숙소_있는_T_08_라벨은_숙소로이고_숙소_가는_법이_아니다 (main=%s)', async (main) => {
    const card = await showT08(t08(), main);
    expect(card.getByText('숙소로')).toBeTruthy();
    expect(card.queryByText('숙소 가는 법')).toBeNull();
  });

  test.each([
    [25, '숙소까지 25분'],
    [0, '숙소로 돌아가자'],
    [null, '숙소로 돌아가자'],
  ])('T15_S18_경계_라벨만_바뀌고_제목은_그대로 (go_home_min=%s -> %s)', async (goHome, title) => {
    const card = await showT08(t08({ go_home_min: goHome }));
    expect(card.getByText('숙소로')).toBeTruthy();
    expect(card.getByText(title)).toBeTruthy();
    expect(card.getByTestId('home-directions-button')).toBeTruthy();
  });

  test('T15_S18_경계_숙소_없는_T_08은_그대로_오늘_일정_끝이고_숙소로_라벨이_없다', async () => {
    const card = await showT08(t08({ lodging: null, map_url: null, go_home_min: null }));
    expect(card.getByText('오늘 일정 끝')).toBeTruthy();
    expect(card.getByText('오늘 일정이 끝났어. 오늘도 수고했어!')).toBeTruthy();
    expect(card.queryByText('숙소로')).toBeNull();
  });
});

// ---------- a2 ----------

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

async function showPick(withPin = true) {
  const confirm = jest.fn(async (_picked: PickedLodging): Promise<LodgingPickResult> => ({ ok: true }));
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <LodgingPickScreen
        cityCode="osaka"
        center={CENTER}
        onConfirm={confirm}
        onBack={jest.fn()}
        initial={withPin ? { pin: SPOT, label: null, tooFar: false } : undefined}
      />
    </SafeAreaProvider>,
  );
}

const flat = (host: Host) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
const num = (value: unknown) => (typeof value === 'number' ? value : 0);
const chain = (host: Host): Host[] => {
  const out: Host[] = [];
  for (let node: Host | null = host; node; node = node.parent) out.push(node);
  return out;
};

/** pick-panel이 화면 바닥에서 올라간 양 (계약의 식) */
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

async function keyboard(show: boolean) {
  await act(async () => {
    DeviceEventEmitter.emit(show ? 'keyboardWillShow' : 'keyboardWillHide', keyboardEvent(show ? KEYBOARD : 0));
  });
  await act(async () => {
    DeviceEventEmitter.emit(show ? 'keyboardDidShow' : 'keyboardDidHide', keyboardEvent(show ? KEYBOARD : 0));
  });
}

describe('§18 막는 것 1 — a2 이름 칸을 누르면 시트가 키보드 위로', () => {
  test('T15_S18_a2_이름_칸_포커스_뒤_키보드가_올라오면_시트가_키보드_높이만큼_올라간다', async () => {
    await showPick();
    await layoutAncestors();
    expect(lift()).toBeLessThan(KEYBOARD); // 시험 자체 확인: 처음엔 바닥
    await act(async () => {
      fireEvent(screen.getByTestId('pick-label'), 'focus');
    });
    await keyboard(true);
    expect(lift()).toBeGreaterThanOrEqual(KEYBOARD);
  });

  test('T15_S18_a2_키보드가_내려가면_시트도_다시_바닥으로', async () => {
    await showPick();
    await layoutAncestors();
    await act(async () => {
      fireEvent(screen.getByTestId('pick-label'), 'focus');
    });
    await keyboard(true);
    await act(async () => {
      fireEvent(screen.getByTestId('pick-label'), 'blur');
    });
    await keyboard(false);
    expect(lift()).toBeLessThan(KEYBOARD);
  });

  test('T15_S18_a2_키보드가_올라와도_이름_칸과_여기로_정했어는_시트_안에_그대로', async () => {
    await showPick();
    await layoutAncestors();
    await keyboard(true);
    const panel = within(screen.getByTestId('pick-panel'));
    expect(panel.getByTestId('pick-label')).toBeTruthy();
    expect(panel.getByTestId('pick-confirm')).toBeTruthy();
  });
});

describe('§18 막는 것 2 — a2 오른쪽 위 빈 흰 원을 그리지 않는다', () => {
  const emptyWhiteCircles = (): Host[] =>
    (screen.root as unknown as Host & { queryAll: (pick: (h: Host) => boolean) => Host[] }).queryAll((host) => {
      if (typeof host.type !== 'string' || host.type !== 'View') return false;
      const style = flat(host);
      const width = num(style.width);
      const isCircle = width > 0 && num(style.borderRadius) >= width / 2;
      const pressable = typeof host.props.onPress === 'function' || typeof host.props.onClick === 'function' || host.props.accessible === true || host.props.onStartShouldSetResponder;
      return style.backgroundColor === color.surface && isCircle && (host.children ?? []).length === 0 && !pressable;
    });

  test.each([true, false])('T15_S18_a2에_빈_흰_원이_없다 (핀=%s)', async (withPin) => {
    await showPick(withPin);
    expect(emptyWhiteCircles()).toEqual([]);
  });

  test('T15_S18_경계_뒤로_버튼은_그대로_있다', async () => {
    await showPick();
    expect(screen.getByTestId('pick-back')).toBeTruthy();
    expect(screen.getByText('지도에서 찍기')).toBeTruthy();
  });
});
