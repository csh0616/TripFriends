/// <reference types="jest" />
// TASK-010 §14 답 2: 날짜 목록 알약은 DESIGN-001 §4-9 "날 상태 알약 색" 표의 토큰을 상태별로 쓴다.
// 근거: TASK-010 §14 답 2, DESIGN-001 §4-9 알약 색 표. 값은 test-support/design-table.ts PILLS (문서 옮김).
// 대비 숫자는 시험하지 않는다 (PM 확인). 화면 소스에 색 값을 직접 쓰지 않는 규칙은 guardrails G1 그대로.
//
// 계약 (이 테스트가 정한 이름, 승인 대기):
//   알약 View testID `day-pill-{day_id}`: backgroundColor = bg, 테두리 있으면 borderWidth 1 + borderColor = border, pill-today는 테두리 없음
//   알약 글자 색 = fg
//   점선 동그라미 testID `day-pill-dot-{day_id}` (pill-planning만): 색 = dot (style.borderColor 또는 color·stroke 속성)
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TripDays } from '@/trips/trip-days';

import { PILLS } from '../test-support/design-table';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

const tripDay = (n: number, state: string, chosen: boolean) => ({
  day_id: `day-t${n}`,
  date: `2026-12-0${n}`,
  state,
  chosen_option_id: chosen ? `opt-${n}` : null,
  fixed_events: [] as unknown[],
});
const FOUR = {
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: '2026-12-01',
  end_date: '2026-12-04',
  lodging_place_id: null,
  status: 'active',
  trip_days: [tripDay(1, 'past', true), tripDay(2, 'today', true), tripDay(3, 'planned', true), tripDay(4, 'planning', false)],
};

// [날 id, 상태, 알약 토큰 이름, 알약 글자]
const CASES: [string, string, string, string][] = [
  ['day-t4', 'planning', 'pill-planning', '계획 전'],
  ['day-t3', 'planned', 'pill-planned', '계획 완료'],
  ['day-t2', 'today', 'pill-today', '오늘 · 여행 중'],
  ['day-t1', 'past', 'pill-past', '지난 날'],
];

function show() {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <TripDays trip={FOUR as never} onOpen={() => {}} onTripChange={() => {}} onNewTrip={() => {}} />
    </SafeAreaProvider>,
  );
}

const flat = (node: { props: { style?: unknown } }) => (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
const upper = (value: unknown) => (typeof value === 'string' ? value.toUpperCase() : value);

describe('§14 답 2 날 상태 알약 색 (DESIGN-001 §4-9)', () => {
  test.each(CASES)('T10_S14_2_%s(%s)_알약_바탕은_%s의_bg', (dayId, _state, token) => {
    show();
    expect(upper(flat(screen.getByTestId(`day-pill-${dayId}`)).backgroundColor)).toBe(PILLS[token].bg);
  });

  test.each(CASES)('T10_S14_2_%s(%s)_알약_글자_색은_%s의_fg', (dayId, _state, token, label) => {
    show();
    const pill = screen.getByTestId(`day-pill-${dayId}`);
    expect(upper(flat(within(pill).getByText(label)).color)).toBe(PILLS[token].fg);
  });

  test.each(CASES.filter(([, , token]) => PILLS[token].border))('T10_S14_2_%s(%s)_알약_테두리는_1px_%s의_border', (dayId, _state, token) => {
    show();
    const style = flat(screen.getByTestId(`day-pill-${dayId}`));
    expect(style.borderWidth).toBe(1);
    expect(upper(style.borderColor)).toBe(PILLS[token].border);
  });

  test('T10_S14_2_오늘_알약은_테두리가_없다', () => {
    show();
    const style = flat(screen.getByTestId('day-pill-day-t2'));
    expect(style.borderWidth ?? 0).toBe(0);
  });

  test('T10_S14_2_계획_전_알약에만_점선_동그라미_색은_dot', () => {
    show();
    const dot = screen.getByTestId('day-pill-dot-day-t4');
    expect(within(screen.getByTestId('day-pill-day-t4')).getByTestId('day-pill-dot-day-t4')).toBe(dot);
    const props = dot.props as { color?: unknown; stroke?: unknown };
    const colours = [flat(dot).borderColor, props.color, props.stroke].map(upper);
    expect(colours).toContain(PILLS['pill-planning'].dot);
    for (const other of ['day-t3', 'day-t2', 'day-t1']) expect(screen.queryByTestId(`day-pill-dot-${other}`)).toBeNull();
  });

  test('T10_S14_2_알약_네_가지가_서로_다른_바탕이다', () => {
    show();
    const backs = CASES.map(([dayId]) => upper(flat(screen.getByTestId(`day-pill-${dayId}`)).backgroundColor));
    expect(new Set(backs).size).toBe(4);
  });
});
