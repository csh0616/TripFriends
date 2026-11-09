/// <reference types="jest" />
// TASK-012 B6 (TASK-011 §17에서 넘어온 것): 오늘 + 고른 코스 줄(계획 완료 줄과 같은 84 줄, 스타일 rowToday)의 주황 링 2pt가 안쪽을 밀지 않는다.
// 방법은 TASK-011 §16 앱 2(N18, 오늘 카드)와 같다: 렌더 트리에서 눌리는 상자의 네 변 "안쪽 차지" = 안쪽 여백 + 테두리 굵기가
//   링 없는 계획 완료 줄과 같아야 하고, 높이(minHeight 84)도 같다. 링을 겹쳐 그리는 안쪽 상자가 있으면 자리를 먹지 않는다(absolute).
//   고치는 방법(겹친 상자 / 여백 줄이기)은 정하지 않는다. 모습(색·간격 실측)은 스크린샷으로.
// 근거: TASK-012 §B B6, TASK-011 §16 앱 2·§17, DESIGN-001 §4-11(sel-ring 2).
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TripDays } from '@/trips/trip-days';

import { COLORS } from '../test-support/design-table';
import { pressableOf, same, styleOf, type Host } from '../test-support/screen-tree';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };
const DATES = ['2026-12-11', '2026-12-12', '2026-12-13'];
const SUMMARY = { end_time: '18:30', place_count: 8, move_min: 125 };
const tripDay = (n: number, state: string, chosen = state !== 'planning') => ({
  day_id: `d${n}`,
  date: DATES[n - 1],
  state,
  chosen_option_id: chosen ? `opt-${n}` : null,
  fixed_events: [] as unknown[],
  summary: chosen ? SUMMARY : null,
  must_visits: [] as unknown[],
});
const trip = (...days: ReturnType<typeof tripDay>[]) => ({
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: DATES[0],
  end_date: DATES[2],
  lodging_place_id: null,
  status: 'active',
  trip_days: days,
});
const AT = { before: '2026-11-06T03:00:00Z', day2: '2026-12-12T03:00:00Z' };
const PLANNED_ROW = trip(tripDay(1, 'planned'), tripDay(2, 'planned'), tripDay(3, 'planning')); // d2 = 계획 완료 줄 (링 없음)
const TODAY_WITH_COURSE = trip(tripDay(1, 'past'), tripDay(2, 'today', true), tripDay(3, 'planning')); // d2 = 오늘 + 코스 줄 (링)

async function show(value: object, at: string) {
  jest.useFakeTimers({
    now: Date.parse(at),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TripDays trip={value as never} onOpen={jest.fn()} onTripChange={() => {}} onNewTrip={() => {}} />
    </SafeAreaProvider>,
  );
}

afterEach(() => {
  jest.useRealTimers();
});

const rowBox = (dayId: string) => pressableOf(screen.getByTestId(`day-row-${dayId}`) as unknown as Host);
const hasRing = (host: Host) => {
  const style = styleOf(host);
  return typeof style.borderWidth === 'number' && style.borderWidth > 0 && same(style.borderColor, COLORS.brand);
};
const num = (value: unknown) => (typeof value === 'number' ? value : 0);
const SIDES = ['Top', 'Bottom', 'Left', 'Right'] as const;
const inset = (host: Host) => {
  const style = styleOf(host);
  return SIDES.map((at) => {
    const axis = at === 'Top' || at === 'Bottom' ? 'Vertical' : 'Horizontal';
    const padding = num(style[`padding${at}`] ?? style[`padding${axis}`] ?? style.padding);
    const border = num(style[`border${at}Width`] ?? style.borderWidth);
    return padding + border;
  });
};
const sizeOf = (host: Host) => ({ height: styleOf(host).height, minHeight: styleOf(host).minHeight });

describe('B6 오늘 + 코스 줄 링은 안쪽을 밀지 않는다', () => {
  test('T12_B6_오늘+코스_줄(링)의_네_변_안쪽_차지는_링_없는_계획_완료_줄과_같다', async () => {
    await show(PLANNED_ROW, AT.before);
    const plain = inset(rowBox('d2'));
    const plainSize = sizeOf(rowBox('d2'));
    expect(plainSize.minHeight).toBe(84);
    await show(TODAY_WITH_COURSE, AT.day2);
    expect(inset(rowBox('d2'))).toEqual(plain);
    expect(sizeOf(rowBox('d2'))).toEqual(plainSize);
  });

  test('T12_B6_링은_그대로_있고_굵기_2', async () => {
    await show(TODAY_WITH_COURSE, AT.day2);
    const box = rowBox('d2');
    const rings = [box, ...box.queryAll(() => true)].filter(hasRing);
    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) expect(styleOf(ring).borderWidth).toBe(2);
  });

  test('T12_B6_링을_겹쳐_그리는_안쪽_상자는_자리를_먹지_않는다(absolute)', async () => {
    await show(TODAY_WITH_COURSE, AT.day2);
    const box = rowBox('d2');
    for (const ring of box.queryAll(() => true).filter(hasRing)) expect(styleOf(ring).position).toBe('absolute');
  });
});
