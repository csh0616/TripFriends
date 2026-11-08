/// <reference types="jest" />
// TASK-010 reviewer 결과에 대한 PM 답 (11-09) 3·4. 로직·가드레일만 본다 (색·간격 모습은 시험하지 않는다).
// 근거:
//   3 [+ 일정]은 계획 전인 날(오늘이면서 계획 전 포함)에만. 계획 완료·지난 날·오늘(계획 있음)엔 숨김.
//     "오늘이면서 계획 전/있음" = TripDay.chosen_option_id null/값 (packages/api-types TripDay, §9 Q6 "응답에 그날 고른 코스가 있는지 알 수 있는 값")
//   4 후보 카드 목록 아래 여백 = action-bar 68(DESIGN-001 토큰 표 `action-bar` 68) + 안전 영역 아래 -> 영업시간 줄이 가려지지 않게
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   날 줄의 [+ 일정] testID `add-fixed-{day_id}` (지금 이름 그대로). 보이는 조건 = state 'planning' 또는 (state 'today' 이고 chosen_option_id null)
//   P2 후보 카드(`candidate-card-*`)를 담은 세로 스크롤 목록의 contentContainerStyle 아래 여백(paddingBottom, 없으면 paddingVertical·padding) = 68 + 안전 영역 아래
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { P2Screen } from '@/planning/screens/p2';
import { TripDays } from '@/trips/trip-days';

import { batch } from '../test-support/planning-fixtures';

const ACTION_BAR = 68; // DESIGN-001 `action-bar` 68 (시트 아래 확정 버튼 줄)

const metrics = (bottom: number) => ({ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom } });

// ---------- 답 3: [+ 일정]은 계획 전인 날에만 ----------

const tripDay = (id: string, n: number, state: string, chosen: boolean) => ({
  day_id: id,
  date: `2026-12-0${n}`,
  state,
  chosen_option_id: chosen ? `opt-${id}` : null,
  fixed_events: [] as unknown[],
});
const TRIP = {
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-01',
  end_date: '2026-12-04',
  lodging_place_id: null,
  status: 'active',
  trip_days: [
    tripDay('past', 1, 'past', true),
    tripDay('today-planned', 2, 'today', true),
    tripDay('planned', 3, 'planned', true),
    tripDay('planning', 4, 'planning', false),
  ],
};

async function showDays(trip: object) {
  return render(
    <SafeAreaProvider initialMetrics={metrics(34)}>
      <TripDays trip={trip as never} onOpen={() => {}} onTripChange={() => {}} onNewTrip={() => {}} />
    </SafeAreaProvider>,
  );
}

// [날 id, 상태, 고른 코스 있음, + 일정 보임]
const ADD_CASES: [string, string, boolean, boolean][] = [
  ['planning', 'planning', false, true],
  ['planned', 'planned', true, false],
  ['past', 'past', true, false],
  ['today-planned', 'today', true, false],
];

describe('§14 PM 답 3 [+ 일정]은 계획 전인 날에만', () => {
  test.each(ADD_CASES)('T10_S14_PM3_%s(%s·고른_코스_%s)_+일정_보임_%s', async (dayId, _state, _chosen, shown) => {
    await showDays(TRIP);
    const row = screen.getByTestId(`day-row-${dayId}`);
    if (shown) expect(within(row).getByTestId(`add-fixed-${dayId}`)).toBeTruthy();
    else expect(within(row).queryByTestId(`add-fixed-${dayId}`)).toBeNull();
  });

  test('T10_S14_PM3_오늘이면서_계획_전(chosen_option_id_null)이면_+일정이_보인다', async () => {
    await showDays({ ...TRIP, trip_days: [tripDay('past', 1, 'past', true), tripDay('today-open', 2, 'today', false), tripDay('planning', 3, 'planning', false)] });
    expect(within(screen.getByTestId('day-row-today-open')).getByTestId('add-fixed-today-open')).toBeTruthy();
  });

  test('T10_S14_PM3_같은_오늘이라도_고른_코스가_생기면_+일정이_사라진다', async () => {
    const open = { ...TRIP, trip_days: [tripDay('today-x', 1, 'today', false)] };
    const view = await showDays(open);
    expect(screen.getByTestId('add-fixed-today-x')).toBeTruthy();
    await view.rerender(
      <SafeAreaProvider initialMetrics={metrics(34)}>
        <TripDays trip={{ ...open, trip_days: [tripDay('today-x', 1, 'today', true)] } as never} onOpen={() => {}} onTripChange={() => {}} onNewTrip={() => {}} />
      </SafeAreaProvider>,
    );
    expect(screen.queryByTestId('add-fixed-today-x')).toBeNull();
  });

  test('T10_S14_PM3_+일정은_계획_전인_날_수만큼만', async () => {
    await showDays({ ...TRIP, trip_days: [...TRIP.trip_days, tripDay('today-open', 5, 'today', false)] });
    expect(screen.queryAllByTestId(/^add-fixed-/).map((node) => node.props.testID).sort()).toEqual(['add-fixed-planning', 'add-fixed-today-open']);
  });
});

// ---------- 답 4: 후보 카드 목록 아래 여백 = action-bar 68 + 안전 영역 ----------

type Node = { props: Record<string, unknown>; parent: Node | null };

/** 후보 카드를 담은 가장 가까운 세로 스크롤 목록 (가로 캐러셀은 건너뛴다) */
function verticalListOf(card: Node): Node {
  for (let node = card.parent; node; node = node.parent) {
    if (node.props.contentContainerStyle !== undefined && !node.props.horizontal) return node;
  }
  throw new Error('후보 카드를 담은 세로 스크롤 목록이 없다');
}

const bottomPad = (list: Node): unknown => {
  const style = (StyleSheet.flatten(list.props.contentContainerStyle as never) ?? {}) as Record<string, unknown>;
  return style.paddingBottom ?? style.paddingVertical ?? style.padding;
};

async function showP2(bottom: number) {
  return render(
    <SafeAreaProvider initialMetrics={metrics(bottom)}>
      <P2Screen
        batch={batch()}
        picks={[]}
        picksCount={0}
        busy={false}
        notice={null}
        onReact={async () => true}
        onNext={async () => true}
        onCompose={async () => true}
      />
    </SafeAreaProvider>,
  );
}

describe('§14 PM 답 4 후보 카드 목록 아래 여백', () => {
  test.each([
    [34, ACTION_BAR + 34],
    [0, ACTION_BAR],
  ])('T10_S14_PM4_안전_영역_아래_%i이면_목록_아래_여백은_%i', async (bottom, expected) => {
    await showP2(bottom);
    const card = (await screen.findByTestId('candidate-card-D01')) as unknown as Node;
    expect(bottomPad(verticalListOf(card))).toBe(expected);
  });

  test('T10_S14_PM4_목록_아래_여백은_안전_영역이_늘어난_만큼_늘어난다', async () => {
    const view = await showP2(0);
    const before = bottomPad(verticalListOf((await screen.findByTestId('candidate-card-D01')) as unknown as Node));
    await view.unmount();
    await showP2(21);
    const after = bottomPad(verticalListOf((await screen.findByTestId('candidate-card-D01')) as unknown as Node));
    expect([before, after]).toEqual([ACTION_BAR, ACTION_BAR + 21]);
  });
});
