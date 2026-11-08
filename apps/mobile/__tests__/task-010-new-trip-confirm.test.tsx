/// <reference types="jest" />
// TASK-010 승현 폰 확인 피드백 (11-09): 여행의 모든 날을 계획하면 날짜 목록의 주 버튼이 [새 여행 만들기]뿐이라
// 누르면 새 여행 -> 이전 여행 보관이 반복된다. 로직·가드레일만 본다 (색·간격 모습은 시험하지 않는다).
// 근거 (승현 지시 그대로):
//   여행이 있을 때 [새 여행 만들기]는 주 버튼이 아니라 보조(글자 버튼)로.
//   누르면 "지금 여행은 보관돼. 새로 만들까?" 확인 한 번.
//   여행이 없을 때 빈 첫 화면의 주 버튼은 그대로.
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   날짜 목록 `new-trip`: TASK-011 §9 Q1부터 btn-new-trip(bg-2 바탕). 누를 수 있는 높이 = height·minHeight + hitSlop >= touch-min(44)
//   확인 방식 = TASK-011 C1부터 sheet-confirm 시트 (task-011-new-trip-sheet.test.tsx). 아래 피드백 3은 Alert도 시트도 없음을 본다
//   빈 첫 화면 `home-create`: 주 버튼(brand 바탕) 그대로, 누르면 확인 없이 바로 SC-01(`field-start-date`)
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { color, control } from '@/planning/theme';
import { TripDays } from '@/trips/trip-days';

import { apiError, FakeServer, json } from '../test-support/fake-server';
import { resetDevice } from '../test-support/planning-driver';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';

const tripDay = (n: number, state: string) => ({
  day_id: `day-t${n}`,
  date: `2026-12-0${n}`,
  state,
  chosen_option_id: state === 'planning' ? null : `opt-${n}`,
  fixed_events: [] as unknown[],
});
// 피드백 상황: 모든 날이 계획 완료
const ALL_PLANNED = {
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-01',
  end_date: '2026-12-03',
  lodging_place_id: null,
  status: 'active',
  trip_days: [tripDay(1, 'planned'), tripDay(2, 'planned'), tripDay(3, 'planned')],
};

type Host = { props: Record<string, any>; parent: Host | null; queryAll: (pick: (h: Host) => boolean) => Host[] };
const styleOf = (host: Host) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
const chain = (host: Host): Host[] => {
  const list: Host[] = [];
  for (let now: Host | null = host; now; now = now.parent) list.push(now);
  return list;
};
/** testID가 붙은 부품 아래에서 실제로 눌리는 상자 (onClick이 있는 View) */
const pressable = (id: string): Host => {
  const host = screen.getByTestId(id) as unknown as Host;
  return chain(host).find((h) => typeof h.props.onClick === 'function') ?? host.queryAll((h) => typeof h.props.onClick === 'function')[0] ?? host;
};
/** 누를 수 있는 높이: height·minHeight + hitSlop (trip-delay.test의 reachHeight와 같은 셈) */
function reachHeight(host: Host): number {
  const style = styleOf(host);
  const slop = host.props.hitSlop ?? {};
  const extra = typeof slop === 'number' ? 2 * slop : Number(slop.top ?? 0) + Number(slop.bottom ?? 0);
  const numeric = [style.height, style.minHeight].filter((v): v is number => typeof v === 'number');
  return (numeric.length ? Math.max(...numeric) : 0) + extra;
}

function showDays(onNewTrip: () => void) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TripDays trip={ALL_PLANNED as never} onOpen={() => {}} onTripChange={() => {}} onNewTrip={onNewTrip} />
    </SafeAreaProvider>,
  );
}

function startHome() {
  const Index = require('@/app/index').default;
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Index />
    </SafeAreaProvider>,
  );
}

let alertSpy: jest.SpyInstance;
let server: FakeServer;

beforeEach(() => {
  resetDevice();
  server = new FakeServer();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------- 1. 여행이 있을 때 [새 여행 만들기]는 글자 버튼 ----------

describe('피드백 1 날짜 목록의 [새 여행 만들기]는 보조(글자 버튼)', () => {
  // TASK-011 §9 Q1 (승인): 글자 버튼은 TASK-010 임시 모양이라 폐기. btn-new-trip = bg-2 바탕 (주 버튼 아님)
  test('T10_NEWTRIP_1_바탕은_bg_2(주_버튼_아님)_TASK_011_Q1', async () => {
    await showDays(() => {});
    const bg = styleOf(pressable('new-trip')).backgroundColor;
    expect(bg).not.toBe(color.brand);
    expect(String(bg).toUpperCase()).toBe(color['bg-2'].toUpperCase());
  });

  test('T10_NEWTRIP_1_글자는_새_여행_만들기_그대로', async () => {
    await showDays(() => {});
    expect(screen.getByTestId('new-trip')).toHaveTextContent('새 여행 만들기');
  });

  test('T10_NEWTRIP_1_누를_수_있는_높이는_touch_min_44_이상', async () => {
    await showDays(() => {});
    expect(control['touch-min']).toBe(44);
    expect(reachHeight(pressable('new-trip'))).toBeGreaterThanOrEqual(control['touch-min']);
  });
});

// ---------- 2. 누르면 확인 한 번 ----------
// TASK-011 C1: iOS 기본 확인 창(Alert) -> sheet-confirm 시트로 바뀌었다. 확인 한 번의 테스트는 task-011-new-trip-sheet.test.tsx가 맡는다
// (문구 그대로, 버튼 [새로 만들기] / [그대로 둘게]).

// ---------- 3. 여행이 없을 때 빈 첫 화면은 그대로 ----------

describe('피드백 3 빈 첫 화면 [여행 만들기]는 주 버튼 그대로, 확인 없음', () => {
  test('T10_NEWTRIP_3_빈_첫_화면_여행_만들기는_주_버튼(brand_바탕)', async () => {
    server.on(CURRENT, apiError(404, 'NOT_FOUND', { resource: 'trip' }));
    await startHome();
    await screen.findByTestId('home-create');
    expect(styleOf(pressable('home-create')).backgroundColor).toBe(color.brand);
    expect(reachHeight(pressable('home-create'))).toBeGreaterThanOrEqual(control['touch-min']);
  });

  test('T10_NEWTRIP_3_빈_첫_화면_여행_만들기는_확인_없이_바로_SC_01', async () => {
    server.on(CURRENT, apiError(404, 'NOT_FOUND', { resource: 'trip' }));
    await startHome();
    await fireEvent.press(await screen.findByTestId('home-create'));
    expect(await screen.findByTestId('field-start-date')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('new-trip-sheet')).toBeNull();
  });
});
