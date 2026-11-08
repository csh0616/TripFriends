/// <reference types="jest" />
// TASK-011 C1 새 여행 확인: iOS 기본 확인 창(Alert) 대신 sheet-confirm 시트. 로직·가드레일만 본다 (크기·간격 모습은 디자이너 재검수 몫).
// 근거: TASK-011 §C C1·C2·AC-7, DESIGN-001 §4-11 "새 여행 확인"·`sheet-confirm`(빨강 안 씀), task-011-review.md §5 4번.
// task-010-new-trip-confirm.test.tsx의 Alert 계약(피드백 2)을 이 파일이 대신한다 (그 파일의 피드백 1·3은 그대로).
//
// 계약 (이 테스트가 정한 이름, 승인 대기):
//   날짜 목록 `new-trip`을 누르면 시트 `new-trip-sheet`가 뜬다. Alert.alert는 부르지 않는다
//   시트 글 "지금 여행은 보관돼. 새로 만들까?" + 한 줄 "보관한 여행은 지금은 다시 열 수 없어"
//   버튼 [새로 만들기] `new-trip-confirm` -> onNewTrip 한 번 / [그대로 둘게] `new-trip-keep` -> 시트 닫힘, 아무 일 없음
//   빨강 안 씀: 시트 안 어디에도 danger 색(바탕·글자·테두리)이 없다
//   빈 첫 화면 [여행 만들기]는 시트 없이 바로 SC-01 (TASK-010 피드백 3 그대로)
//   §9 Q12: [새로 만들기]가 주 버튼(주황), [그대로 둘게]는 보조(주황 아님). 바깥 어두운 곳 `new-trip-sheet-scrim`을 누르면 [그대로 둘게]와 같다
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { control } from '@/planning/theme';
import { TripDays } from '@/trips/trip-days';

import { COLORS } from '../test-support/design-table';
import { apiError, FakeServer, json } from '../test-support/fake-server';
import { resetDevice } from '../test-support/planning-driver';
import { buttonsFilledWith, pressableOf, styleOf, type Host } from '../test-support/screen-tree';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const QUESTION = '지금 여행은 보관돼. 새로 만들까?';
const NOTE = '보관한 여행은 지금은 다시 열 수 없어';
const MAKE = '새로 만들기';
const KEEP = '그대로 둘게';

const tripDay = (n: number, state: string) => ({
  day_id: `day-t${n}`,
  date: `2026-12-0${n}`,
  state,
  chosen_option_id: state === 'planning' ? null : `opt-${n}`,
  fixed_events: [] as unknown[],
});
const ALL_PLANNED = {
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-01',
  end_date: '2026-12-03',
  lodging_place_id: null,
  status: 'active',
  trip_days: [tripDay(1, 'planned'), tripDay(2, 'planned'), tripDay(3, 'planned')],
};

const settleAll = async () => {
  await act(async () => {
    await new Promise<void>((done) => setImmediate(done));
  });
};
const press = async (id: string) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId(id));
  });
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

/** 누를 수 있는 높이: height·minHeight + hitSlop */
function reachHeight(host: Host): number {
  const style = styleOf(host);
  const slop = host.props.hitSlop ?? {};
  const extra = typeof slop === 'number' ? 2 * slop : Number(slop.top ?? 0) + Number(slop.bottom ?? 0);
  const numeric = [style.height, style.minHeight].filter((v): v is number => typeof v === 'number');
  return (numeric.length ? Math.max(...numeric) : 0) + extra;
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

describe('C1 [새 여행 만들기] -> 확인 시트', () => {
  test('T11_C1_누르면_시트가_뜨고_Alert는_쓰지_않는다', async () => {
    const onNewTrip = jest.fn();
    await showDays(onNewTrip);
    expect(screen.queryByTestId('new-trip-sheet')).toBeNull();
    await press('new-trip');
    expect(screen.getByTestId('new-trip-sheet')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(onNewTrip).not.toHaveBeenCalled(); // 아직 새 여행으로 안 간다
  });

  test('T11_C1_시트_글과_한_줄은_TASK_그대로', async () => {
    await showDays(() => {});
    await press('new-trip');
    const sheet = within(screen.getByTestId('new-trip-sheet'));
    expect(sheet.getByText(QUESTION)).toBeTruthy();
    expect(sheet.getByText(NOTE)).toBeTruthy();
  });

  test('T11_E4_한_줄_글자는_ink(#333333)_muted_아님', async () => {
    await showDays(() => {});
    await press('new-trip');
    const note = within(screen.getByTestId('new-trip-sheet')).getByText(NOTE) as unknown as Host;
    expect(String(styleOf(note).color).toUpperCase()).toBe(COLORS.ink);
  });

  test('T11_C1_버튼은_새로_만들기와_그대로_둘게_두_개', async () => {
    await showDays(() => {});
    await press('new-trip');
    const sheet = screen.getByTestId('new-trip-sheet');
    expect(within(screen.getByTestId('new-trip-confirm')).getByText(MAKE)).toBeTruthy();
    expect(within(screen.getByTestId('new-trip-keep')).getByText(KEEP)).toBeTruthy();
    expect(within(sheet).getByTestId('new-trip-confirm')).toBeTruthy();
    expect(within(sheet).getByTestId('new-trip-keep')).toBeTruthy();
    expect(within(sheet).queryByText('취소')).toBeNull(); // 옛 Alert 버튼 이름
  });

  test('T11_C1_새로_만들기를_누르면_onNewTrip이_한_번', async () => {
    const onNewTrip = jest.fn();
    await showDays(onNewTrip);
    await press('new-trip');
    await press('new-trip-confirm');
    expect(onNewTrip).toHaveBeenCalledTimes(1);
  });

  test('T11_C1_그대로_둘게를_누르면_시트가_닫히고_아무_일도_없다', async () => {
    const onNewTrip = jest.fn();
    await showDays(onNewTrip);
    await press('new-trip');
    await press('new-trip-keep');
    expect(onNewTrip).not.toHaveBeenCalled();
    expect(screen.queryByTestId('new-trip-sheet')).toBeNull();
    expect(screen.getByTestId('day-row-day-t1')).toBeTruthy(); // 날짜 목록 그대로
  });

  test('T11_C1_그대로_둘게_뒤_다시_누르면_시트가_다시_뜬다', async () => {
    await showDays(() => {});
    await press('new-trip');
    await press('new-trip-keep');
    await press('new-trip');
    expect(screen.getByTestId('new-trip-sheet')).toBeTruthy();
  });

  test('T11_C1_빨강을_쓰지_않는다(danger_0)', async () => {
    await showDays(() => {});
    await press('new-trip');
    const sheet = screen.getByTestId('new-trip-sheet') as unknown as Host;
    const red = [sheet, ...sheet.queryAll(() => true)].filter((host) => {
      const style = styleOf(host);
      return [style.backgroundColor, style.color, style.borderColor, host.props.color, host.props.fill, host.props.stroke].some(
        (value) => typeof value === 'string' && value.toUpperCase() === COLORS.danger,
      );
    });
    expect(red).toEqual([]);
  });

  test.each(['new-trip-confirm', 'new-trip-keep'])('T11_C1_%s_누를_수_있는_높이는_44_이상', async (id) => {
    await showDays(() => {});
    await press('new-trip');
    expect(reachHeight(pressableOf(screen.getByTestId(id) as unknown as Host))).toBeGreaterThanOrEqual(control['touch-min']);
  });
});

describe('§9 Q12 주 버튼과 바깥', () => {
  test('T11_Q12_새로_만들기는_주황_주_버튼', async () => {
    await showDays(() => {});
    await press('new-trip');
    expect(String(styleOf(pressableOf(screen.getByTestId('new-trip-confirm') as unknown as Host)).backgroundColor).toUpperCase()).toBe(COLORS.brand);
  });

  test('T11_Q12_그대로_둘게는_주황이_아니다_시트_안_주황은_하나', async () => {
    await showDays(() => {});
    await press('new-trip');
    expect(String(styleOf(pressableOf(screen.getByTestId('new-trip-keep') as unknown as Host)).backgroundColor).toUpperCase()).not.toBe(COLORS.brand);
    expect(buttonsFilledWith(COLORS.brand, screen.getByTestId('new-trip-sheet') as unknown as Host)).toHaveLength(1);
  });

  test('T11_Q12_바깥을_누르면_그대로_둘게와_같다', async () => {
    const onNewTrip = jest.fn();
    await showDays(onNewTrip);
    await press('new-trip');
    await press('new-trip-sheet-scrim');
    expect(onNewTrip).not.toHaveBeenCalled();
    expect(screen.queryByTestId('new-trip-sheet')).toBeNull();
    expect(screen.getByTestId('day-row-day-t1')).toBeTruthy();
  });
});

describe('C1 첫 화면 흐름 (C2 Maestro와 같은 길)', () => {
  test('T11_C1_새로_만들기면_SC_01', async () => {
    server.on(CURRENT, json(200, ALL_PLANNED));
    await startHome();
    await act(async () => {
      fireEvent.press(await screen.findByTestId('new-trip'));
    });
    await settleAll();
    expect(screen.getByTestId('new-trip-sheet')).toBeTruthy();
    expect(screen.queryByTestId('field-start-date')).toBeNull();
    await press('new-trip-confirm');
    expect(await screen.findByTestId('field-start-date')).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('T11_C1_그대로_둘게면_날짜_목록_그대로', async () => {
    server.on(CURRENT, json(200, ALL_PLANNED));
    await startHome();
    await act(async () => {
      fireEvent.press(await screen.findByTestId('new-trip'));
    });
    await settleAll();
    await press('new-trip-keep');
    await settleAll();
    expect(screen.queryByTestId('field-start-date')).toBeNull();
    expect(screen.queryByTestId('new-trip-sheet')).toBeNull();
    expect(screen.getByTestId('day-row-day-t1')).toBeTruthy();
  });

  test('T11_C1_빈_첫_화면_여행_만들기는_시트_없이_바로_SC_01', async () => {
    server.on(CURRENT, apiError(404, 'NOT_FOUND', { resource: 'trip' }));
    await startHome();
    await act(async () => {
      fireEvent.press(await screen.findByTestId('home-create'));
    });
    expect(await screen.findByTestId('field-start-date')).toBeTruthy();
    expect(screen.queryByTestId('new-trip-sheet')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
