/// <reference types="jest" />
// TASK-010 승현 폰 확인 피드백 (11-09): 여행의 모든 날을 계획하면 날짜 목록의 주 버튼이 [새 여행 만들기]뿐이라
// 누르면 새 여행 -> 이전 여행 보관이 반복된다. 로직·가드레일만 본다 (색·간격 모습은 시험하지 않는다).
// 근거 (승현 지시 그대로):
//   여행이 있을 때 [새 여행 만들기]는 주 버튼이 아니라 보조(글자 버튼)로.
//   누르면 "지금 여행은 보관돼. 새로 만들까?" 확인 한 번.
//   여행이 없을 때 빈 첫 화면의 주 버튼은 그대로.
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   날짜 목록 `new-trip`: 눌리는 상자에 바탕색이 없다(미지정 또는 'transparent'). 누를 수 있는 높이 = height·minHeight + hitSlop >= touch-min(44)
//     (앱에 글자 버튼 부품이 아직 없어 "바탕색 없음"으로 확인한다)
//   확인 방식 = react-native Alert.alert (앱에 확인 대화 패턴이 아직 없어 RN 기본을 쓴다)
//     문구 '지금 여행은 보관돼. 새로 만들까?' 는 제목 또는 본문에. 버튼 두 개:
//     '취소'(style 'cancel', 누르면 아무 일 없음) · '새로 만들기'(누르면 onNewTrip 한 번) — 버튼 이름은 지어낸 것 (앱에 같은 쓰임 이름이 없음)
//   빈 첫 화면 `home-create`: 주 버튼(brand 바탕) 그대로, 누르면 확인 없이 바로 SC-01(`field-start-date`)
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, StyleSheet, type AlertButton } from 'react-native';
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
const QUESTION = '지금 여행은 보관돼. 새로 만들까?';
const CANCEL = '취소';
const MAKE = '새로 만들기';

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
const noFill = (value: unknown) => value === undefined || value === null || value === 'transparent' || /^(#0000|#00000000|rgba\(.*,\s*0\))$/i.test(String(value));

const settleAll = async () => {
  await act(async () => {
    await new Promise<void>((done) => setImmediate(done));
  });
};

/** Alert.alert가 받은 [제목, 본문, 버튼] 중 마지막 호출 */
const lastAlert = (spy: jest.SpyInstance) => {
  if (spy.mock.calls.length === 0) throw new Error('확인 대화(Alert.alert)가 뜨지 않았다');
  return spy.mock.calls[spy.mock.calls.length - 1] as [string, string | undefined, AlertButton[] | undefined];
};
const buttonOf = (buttons: AlertButton[] | undefined, label: string) => {
  const found = (buttons ?? []).find((b) => b.text === label);
  if (!found) throw new Error(`확인 대화에 [${label}] 버튼이 없다`);
  return found;
};

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
  test('T10_NEWTRIP_1_바탕색이_없다(주_버튼도_보조_바탕도_아님)', async () => {
    await showDays(() => {});
    const bg = styleOf(pressable('new-trip')).backgroundColor;
    expect(bg).not.toBe(color.brand);
    expect(bg).not.toBe(color['bg-2']);
    expect(noFill(bg)).toBe(true);
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

describe('피드백 2 누르면 바로 가지 않고 확인 한 번', () => {
  test('T10_NEWTRIP_2_누르면_확인이_한_번_뜨고_아직_새_여행으로_안_간다', async () => {
    const onNewTrip = jest.fn();
    await showDays(onNewTrip);
    await fireEvent.press(screen.getByTestId('new-trip'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(onNewTrip).not.toHaveBeenCalled();
  });

  test('T10_NEWTRIP_2_확인_문구는_지금_여행은_보관돼_새로_만들까', async () => {
    await showDays(() => {});
    await fireEvent.press(screen.getByTestId('new-trip'));
    const [title, message] = lastAlert(alertSpy);
    expect([title, message]).toContain(QUESTION);
  });

  test('T10_NEWTRIP_2_버튼은_취소(cancel)와_새로_만들기_두_개', async () => {
    await showDays(() => {});
    await fireEvent.press(screen.getByTestId('new-trip'));
    const [, , buttons] = lastAlert(alertSpy);
    expect((buttons ?? []).map((b) => b.text)).toEqual(expect.arrayContaining([CANCEL, MAKE]));
    expect(buttons).toHaveLength(2);
    expect(buttonOf(buttons, CANCEL).style).toBe('cancel');
  });

  test('T10_NEWTRIP_2_새로_만들기를_누르면_onNewTrip이_한_번', async () => {
    const onNewTrip = jest.fn();
    await showDays(onNewTrip);
    await fireEvent.press(screen.getByTestId('new-trip'));
    const [, , buttons] = lastAlert(alertSpy);
    await act(async () => {
      buttonOf(buttons, MAKE).onPress?.();
    });
    expect(onNewTrip).toHaveBeenCalledTimes(1);
  });

  test('T10_NEWTRIP_2_취소를_누르면_아무_일도_없다', async () => {
    const onNewTrip = jest.fn();
    await showDays(onNewTrip);
    await fireEvent.press(screen.getByTestId('new-trip'));
    const [, , buttons] = lastAlert(alertSpy);
    await act(async () => {
      buttonOf(buttons, CANCEL).onPress?.();
    });
    expect(onNewTrip).not.toHaveBeenCalled();
    expect(screen.getByTestId('day-row-day-t1')).toBeTruthy(); // 날짜 목록 그대로
  });

  test('T10_NEWTRIP_2_첫_화면_흐름_확인_전에는_날짜_목록에_머물고_새로_만들기면_SC_01', async () => {
    server.on(CURRENT, json(200, ALL_PLANNED));
    await startHome();
    await fireEvent.press(await screen.findByTestId('new-trip'));
    await settleAll();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('field-start-date')).toBeNull();
    expect(screen.getByTestId('day-row-day-t1')).toBeTruthy();
    const [, , buttons] = lastAlert(alertSpy);
    await act(async () => {
      buttonOf(buttons, MAKE).onPress?.();
    });
    expect(await screen.findByTestId('field-start-date')).toBeTruthy();
  });

  test('T10_NEWTRIP_2_첫_화면_흐름_취소면_날짜_목록_그대로', async () => {
    server.on(CURRENT, json(200, ALL_PLANNED));
    await startHome();
    await fireEvent.press(await screen.findByTestId('new-trip'));
    await settleAll();
    const [, , buttons] = lastAlert(alertSpy);
    await act(async () => {
      buttonOf(buttons, CANCEL).onPress?.();
    });
    await settleAll();
    expect(screen.queryByTestId('field-start-date')).toBeNull();
    expect(screen.getByTestId('day-row-day-t1')).toBeTruthy();
  });
});

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
  });
});
