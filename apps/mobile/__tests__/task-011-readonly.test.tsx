/// <reference types="jest" />
// TASK-011 A2·A3 "‹ 날짜" 뒤로(back-day) 한 모양 + A3 고른 코스 읽기만 줄(row-read) + AC-3(주황).
// 로직·가드레일만 본다 (크기·간격·색 모습은 디자이너 재검수 몫).
// 근거: TASK-011 §A A2·A3·AC-3, DESIGN-001 §4-11(뒤로·읽기만), task-011-review.md §2 14·21·22·23번 줄, §1 PM 답 3·8, TASK-004 §14 ⑤.
//
// 계약 (이 테스트가 정한 이름, 승인 대기):
//   뒤로 testID `header-back` 그대로. 계획 대화·코스안·읽기만 세 화면에서 글자 "날짜"(‹는 글자가 아니라 아이콘), 눌리는 상자 바탕 없음(투명)
//   읽기만 줄 `course-row-{seq}` 그대로. 이름 줄 `course-row-name-{seq}`(이름 + 칩), 보조 줄 `course-row-sub-{seq}`(지금 이름 그대로)
//     칩은 미확인·모름만 이름 줄 안. 확인됨 칩은 없다. 보조 줄 글자는 한 줄(numberOfLines 1)
//   읽기만 화면에 동선 그림(`route-diagram`) 없음, 주황 버튼 없음
//   §9 v1.1: Q10 curated 시간대 줄 -> 이름 줄에 "추천 시간대", 늘 열림 -> 칩 없이 "늘 열려 있어" · Q11 안내 "지금은 보기만 할 수 있어"
import { act, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { COLORS } from '../test-support/design-table';
import { FakeServer, json } from '../test-support/fake-server';
import { resetDevice, tap } from '../test-support/planning-driver';
import { course, hoursFact, relaxed, session, SID } from '../test-support/planning-fixtures';
import { buttonsFilledWith, isInside, noFill, pressableOf, styleOf, type Host } from '../test-support/screen-tree';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };
const CURRENT = 'GET /trips/current';
const NOW_ISO = '2026-12-02T03:00:00Z';

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

// 확인됨 · 미확인 · 모름 · 고정 일정(확인됨)이 섞인 날 (§D 스크린샷 "미확인·모름 섞인 날")
const base = relaxed('opt-3');
const MIXED = relaxed('opt-3', {
  items: [
    { ...base.items[0], seq: 1, hours_status: 'confirmed' as const, facts: [hoursFact('confirmed')] },
    { ...base.items[1], seq: 2, hours_status: 'unverified' as const, facts: [hoursFact('unverified')] },
    { ...base.items[0], seq: 3, place_id: 'D05', name: '모르는 가게', hours_status: 'unknown' as const, facts: [hoursFact('unknown')] },
    { ...base.items[2], seq: 4, hours_status: 'confirmed' as const, facts: [hoursFact('confirmed')] }, // 고정 일정 · 이동 48분
    // §9 Q10: 밤거리(curated 시간대)·늘 열림
    { ...base.items[0], seq: 5, place_id: 'D06', name: '밤 골목', hours_status: 'confirmed' as const, facts: [hoursFact('confirmed', { source_type: 'curated', value: '17:00-24:00' })] },
    { ...base.items[0], seq: 6, place_id: 'D07', name: '작은 공원', hours_status: 'confirmed' as const, facts: [hoursFact('confirmed', { source_type: 'curated', value: '00:00-24:00' })] },
  ],
});

function freezeDate(iso: string) {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
}

async function startHome() {
  const Index = require('@/app/index').default;
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Index />
    </SafeAreaProvider>,
  );
  await act(async () => {
    await new Promise<void>((done) => setImmediate(done));
  });
  return view;
}

async function openReadonly(dayId = 'day-t3') {
  await startHome();
  await tap(await screen.findByTestId(`day-row-${dayId}`));
  return screen.findByTestId('course-readonly');
}

let server: FakeServer;

beforeEach(() => {
  resetDevice();
  freezeDate(NOW_ISO);
  server = new FakeServer()
    .on(CURRENT, json(200, FOUR))
    .on('GET /days/day-t3/course', json(200, MIXED))
    .on('GET /days/day-t1/course', json(200, MIXED));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------- back-day: 세 화면 같은 모양 (review 14·21번 줄) ----------

const expectBackDay = () => {
  const back = screen.getByTestId('header-back');
  expect(within(back).getByText('날짜')).toBeTruthy();
  expect(within(back).queryByText(/‹|</)).toBeNull(); // ‹는 아이콘 (글자 기호 아님)
  expect(noFill(styleOf(pressableOf(back as unknown as Host)).backgroundColor)).toBe(true);
};

describe('A2·A3 "‹ 날짜" 뒤로는 세 화면에서 같은 모양', () => {
  test('T11_A2_계획_대화_뒤로는_투명_바탕에_글자_날짜', async () => {
    server.on('POST /days/day-t4/planning', json(201, session)).on(`GET /planning/${SID}`, json(200, session));
    await startHome();
    await tap(await screen.findByTestId('day-row-day-t4'));
    await screen.findByTestId('header-back');
    expectBackDay();
  });

  test('T11_A2_코스안_뒤로도_같은_모양', async () => {
    server.on('POST /days/day-t4/planning', json(201, course())).on(`GET /planning/${SID}`, json(200, course()));
    await startHome();
    await tap(await screen.findByTestId('day-row-day-t4'));
    await screen.findByTestId('option-relaxed');
    expectBackDay();
  });

  test.each(['day-t3', 'day-t1'])('T11_A3_읽기만(%s)_뒤로도_같은_모양', async (dayId) => {
    await openReadonly(dayId);
    expectBackDay();
  });

  test('T11_A3_읽기만_뒤로를_누르면_날짜_목록', async () => {
    await openReadonly();
    await tap(screen.getByTestId('header-back'));
    expect(await screen.findByTestId('day-row-day-t4')).toBeTruthy();
  });
});

// ---------- A3 읽기만 줄 (review 22·23번 줄, PM 답 8) ----------

describe('A3 읽기만 칩은 미확인·모름만, 이름 줄 오른쪽', () => {
  test('T11_A3_확인됨_칩은_없다', async () => {
    const view = await openReadonly();
    expect(within(view).queryAllByText('확인됨')).toEqual([]);
  });

  test.each([
    [2, '미확인'],
    [3, '모름'],
  ])('T11_A3_%i번_줄의_%s_칩은_이름_줄_안', async (seq, chip) => {
    await openReadonly();
    const nameLine = screen.getByTestId(`course-row-name-${seq}`);
    expect(within(nameLine).getByText(chip)).toBeTruthy();
    expect(within(screen.getByTestId(`course-row-sub-${seq}`)).queryByText(chip)).toBeNull();
  });

  test.each([1, 4])('T11_A3_확인됨인_%i번_줄에는_칩이_없다', async (seq) => {
    await openReadonly();
    const row = within(screen.getByTestId(`course-row-${seq}`));
    for (const chip of ['확인됨', '미확인', '모름']) expect(row.queryByText(chip)).toBeNull();
  });

  test('T11_A3_이름_줄에_장소_이름이_있다', async () => {
    await openReadonly();
    expect(within(screen.getByTestId('course-row-name-2')).getByText('꼭 갈 박물관')).toBeTruthy();
    expect(within(screen.getByTestId('course-row-name-3')).getByText('모르는 가게')).toBeTruthy();
  });

  test.each([1, 2, 3, 4, 5, 6])('T11_A3_%i번_줄_보조_줄은_한_줄(넘치면_…)', async (seq) => {
    await openReadonly();
    const texts = (screen.getByTestId(`course-row-sub-${seq}`) as unknown as Host).queryAll((h) => h.type === 'Text');
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text.props.numberOfLines).toBe(1);
  });

  test('T11_A3_고정_일정_줄_보조_줄은_칩_없이_한_줄(8번_줄_꺾임)', async () => {
    await openReadonly();
    const sub = screen.getByTestId('course-row-sub-4');
    expect(within(sub).getByText(/고정 일정 · 이동 48분/)).toBeTruthy();
    for (const chip of ['확인됨', '미확인', '모름']) expect(within(sub).queryByText(chip)).toBeNull();
  });
});

describe('A3 읽기만 화면 가드레일', () => {
  test('T11_A3_동선_그림이_없다(PM_답_3)', async () => {
    await openReadonly();
    expect(screen.queryByTestId('route-diagram')).toBeNull();
  });

  test('T11_AC3_읽기만_화면에_주황_버튼이_없다', async () => {
    const view = (await openReadonly()) as unknown as Host;
    expect(buttonsFilledWith(COLORS.brand)).toEqual([]);
    expect(buttonsFilledWith(COLORS.brand, view)).toEqual([]);
  });

  test('T11_A3_읽기만_줄은_코스_줄_수만큼', async () => {
    const view = await openReadonly();
    for (const item of MIXED.items) expect(within(view).getByTestId(`course-row-${item.seq}`)).toBeTruthy();
    expect(isInside(screen.getByTestId('course-row-1') as unknown as Host, view as unknown as Host)).toBe(true);
  });
});

describe('§9 Q10·Q11 읽기만', () => {
  test('T11_Q10_읽기만_curated_시간대_줄은_이름_줄에_추천_시간대', async () => {
    await openReadonly();
    expect(within(screen.getByTestId('course-row-name-5')).getByText('추천 시간대')).toBeTruthy();
    expect(within(screen.getByTestId('course-row-5')).queryByText('확인됨')).toBeNull();
  });

  test('T11_Q10_읽기만_늘_열림_줄은_칩_없이_늘_열려_있어', async () => {
    await openReadonly();
    const row = within(screen.getByTestId('course-row-6'));
    for (const chip of ['확인됨', '미확인', '모름', '추천 시간대']) expect(row.queryByText(chip)).toBeNull();
    expect(row.getByText(/늘 열려 있어/)).toBeTruthy();
  });

  test('T11_Q11_읽기만_안내는_지금은_보기만_할_수_있어', async () => {
    const view = await openReadonly();
    expect(within(view).getByText('지금은 보기만 할 수 있어')).toBeTruthy();
  });
});
