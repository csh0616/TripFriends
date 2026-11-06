/// <reference types="jest" />
// 순수 함수. 근거: TASK-004 §B-5, AC-5, §10-9(Q9), TASK-002 §8 Q26(하버사인, 반지름 6371km)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';

import { contrast } from '@/lib/contrast';
import { distanceLabel } from '@/lib/distance-label';
import { formatStay } from '@/lib/format-stay';
import { placeholderFor } from '@/lib/placeholder-for';
import { initialPlanningState, planningReducer, type PlanningAction } from '@/lib/planning-reducer';
import { projectRoute } from '@/lib/project-route';
import { screenFor } from '@/lib/screen-for';
import { todayHoursText, type ChipKind } from '@/lib/today-hours-text';

import { CONTRAST_PAIRS, COLORS, REJECTED_PAIRS } from '../test-support/design-table';
import { batch, course, done, picks, session } from '../test-support/planning-fixtures';
import { REPO_ROOT } from '../test-support/source-files';

// ---------- screenFor ----------

// 껍데기의 'not implemented'를 "모르는 stage 오류"로 잘못 세지 않는다
const expectStageError = (stage: unknown) => {
  let message = '';
  try {
    screenFor({ stage });
  } catch (error) {
    message = String((error as Error).message);
  }
  expect(message).not.toBe('');
  expect(message).not.toBe('not implemented');
};

describe('screenFor', () => {
  test.each([
    ['asking', 'P1'],
    ['browsing', 'P2'],
    ['composing', 'P3'],
    ['done', 'S9'],
  ])('L01_B2_stage_%s는_%s', (stage, name) => {
    expect(screenFor({ stage })).toBe(name);
  });

  test.each([
    ['세션 응답', session, 'P1'],
    ['묶음 응답', batch(), 'P2'],
    ['코스 응답', course(), 'P3'],
    ['완료 응답', done, 'S9'],
  ])('L02_B2_%s_전체로도_같다', (_name, response, name) => {
    expect(screenFor(response)).toBe(name);
  });

  test.each(['', 'ASKING', 'planning', 'browse', 'done '])('L03_B5_모르는_stage_%j는_오류', (stage) => {
    expectStageError(stage);
  });

  test('L03b_B5_stage와_상관없는_다른_값으로_판단하지_않는다', () => {
    expect(screenFor({ ...session, stage: 'composing' })).toBe('P3');
    expect(screenFor({ ...course(), stage: 'browsing' })).toBe('P2');
  });

  test('L03c_B5_문자열이_아닌_임의_stage는_모두_오류', () => {
    fc.assert(
      fc.property(fc.string(), (stage) => {
        fc.pre(!['asking', 'browsing', 'composing', 'done'].includes(stage));
        expectStageError(stage);
      }),
    );
  });
});

// ---------- planningReducer ----------

describe('planningReducer', () => {
  const start: PlanningAction = { type: 'request_start' };
  const fail: PlanningAction = { type: 'request_failure', message: '연결이 안 돼' };
  const success = (response: unknown): PlanningAction => ({ type: 'request_success', response });
  const reduce = (actions: PlanningAction[], from = initialPlanningState) => actions.reduce(planningReducer, from);

  test('L04_B5_요청을_시작하면_요청_중이고_응답과_담은_곳은_그대로', () => {
    const before = reduce([success(batch({ picks_count: 2 })), success(picks(['D01', 'D02']))]);
    const after = planningReducer(before, start);
    expect(after.inFlight).toBe(true);
    expect(after.response).toEqual(before.response);
    expect(after.picks).toEqual(['D01', 'D02']);
    expect(after.picksCount).toBe(2);
  });

  test('L05_B5_성공하면_요청_중이_끝나고_마지막_응답이_바뀌고_오류가_지워진다', () => {
    const response = batch({ round: 2 });
    const after = reduce([start, fail, start, success(response)]);
    expect(after.inFlight).toBe(false);
    expect(after.response).toEqual(response);
    expect(after.error).toBeNull();
  });

  test('L06_S7_실패하면_요청_중이_끝나고_오류_글만_바뀐다', () => {
    const before = reduce([start, success(batch({ picks_count: 1 })), success(picks(['D01']))]);
    const after = reduce([start, fail], before);
    expect(after.inFlight).toBe(false);
    expect(after.error).toBe('연결이 안 돼');
    expect(after.response).toEqual(before.response);
    expect(after.picks).toEqual(before.picks);
    expect(after.picksCount).toBe(before.picksCount);
  });

  test('L07_AC8_Picks_응답은_담은_곳과_숫자만_서버_값으로_바꾸고_묶음은_그대로', () => {
    const shown = batch({ picks_count: 0 });
    const after = reduce([success(shown), start, success(picks(['D01'], 5))]);
    expect(after.response).toEqual(shown);
    expect(after.picks).toEqual(['D01']);
    expect(after.picksCount).toBe(5);
  });

  test('L08_AC8_묶음_응답의_picks_count도_서버_값으로', () => {
    expect(reduce([success(batch({ picks_count: 3 }))]).picksCount).toBe(3);
  });

  test('L39_Q7_묶음_응답의_picks로_담은_곳을_복원', () => {
    const after = reduce([success(batch({ picks: ['D02', 'D01'], picks_count: 2 }))]);
    expect(after.picks).toEqual(['D02', 'D01']);
    expect(after.picksCount).toBe(2);
  });

  test('L40_Q7_새_묶음의_picks가_앞선_담은_곳을_대신한다', () => {
    const after = reduce([success(picks(['D01', 'D02'])), success(batch({ picks: ['D02'], picks_count: 1 }))]);
    expect(after.picks).toEqual(['D02']);
    expect(after.picksCount).toBe(1);
  });

  test.each([
    ['코스', course()],
    ['첫 질문', session],
    ['완료', done],
  ])('L41_S7_%s_응답은_picks가_없으니_담은_곳을_지우지_않는다', (_name, response) => {
    const after = reduce([success(picks(['D01'])), success(response)]);
    expect(after.picks).toEqual(['D01']);
    expect(after.response).toEqual(response);
  });

  test('L09_B5_요청을_시작해도_낙관적으로_숫자를_바꾸지_않는다', () => {
    const before = reduce([success(batch({ picks_count: 3 }))]);
    expect(planningReducer(before, start).picksCount).toBe(3);
  });

  test('L10_B5_입력_상태를_바꾸지_않는다', () => {
    const before = Object.freeze({ ...initialPlanningState, picks: Object.freeze(['D01']) as unknown as string[] });
    expect(() => planningReducer(before, start)).not.toThrow();
    expect(before.inFlight).toBe(false);
  });

  test('L11_S7_어떤_순서로든_실패는_응답과_담은_곳을_바꾸지_않는다', () => {
    const responses = [session, batch({ picks_count: 2 }), course(), picks(['D01', 'D02'])];
    const action = fc.oneof(
      fc.constant(start),
      fc.constant(fail),
      fc.constantFrom(...responses).map((response) => success(response)),
    );
    fc.assert(
      fc.property(fc.array(action, { maxLength: 15 }), (actions) => {
        let state = initialPlanningState;
        for (const next of actions) {
          const previous = state;
          state = planningReducer(state, next);
          if (next.type === 'request_failure') {
            expect(state.response).toEqual(previous.response);
            expect(state.picks).toEqual(previous.picks);
            expect(state.picksCount).toBe(previous.picksCount);
            expect(state.inFlight).toBe(false);
          }
          if (next.type === 'request_start') expect(state.inFlight).toBe(true);
          if (next.type === 'request_success') expect(state.inFlight).toBe(false);
        }
      }),
    );
  });
});

// ---------- distanceLabel ----------

describe('distanceLabel', () => {
  const HOME = { lat: 35, lng: 135 };
  const M_PER_DEGREE = (Math.PI / 180) * 6371000; // TASK-002 §8 Q26
  const north = (metres: number) => ({ lat: HOME.lat + metres / M_PER_DEGREE, lng: HOME.lng });

  test.each([
    [650, '숙소에서 650m'],
    [1200, '숙소에서 1.2km'],
    [0, '숙소에서 0m'],
    [4.9, '숙소에서 0m'],
    [5.1, '숙소에서 10m'],
    [10, '숙소에서 10m'],
    [644.9, '숙소에서 640m'],
    [645.1, '숙소에서 650m'],
    [654.9, '숙소에서 650m'],
    [655.1, '숙소에서 660m'],
    [990, '숙소에서 990m'],
    [994.9, '숙소에서 990m'],
  ])('L12_B5_1km_미만은_m_10m_반올림_%dm', (metres, label) => {
    expect(distanceLabel(HOME, north(metres))).toBe(label);
  });

  test.each([
    [1000, '숙소에서 1.0km'],
    [1000.1, '숙소에서 1.0km'],
    [1049, '숙소에서 1.0km'],
    [1051, '숙소에서 1.1km'],
    [1149, '숙소에서 1.1km'],
    [1151, '숙소에서 1.2km'],
    [12340, '숙소에서 12.3km'],
  ])('L13_B5_1km_이상은_km_소수_한_자리_%dm', (metres, label) => {
    expect(distanceLabel(HOME, north(metres))).toBe(label);
  });

  test.each([
    [995.1, '숙소에서 1.0km'],
    [999, '숙소에서 1.0km'],
    [999.9, '숙소에서 1.0km'],
  ])('L14_Q11_995m부터_999m까지는_1_0km_%dm', (metres, label) => {
    expect(distanceLabel(HOME, north(metres))).toBe(label);
  });

  test('L15_B5_하버사인_동서_방향도_위도를_반영한다', () => {
    // 위도 35도에서 경도 0.01도 = 약 910.9m (평면 계산이면 1110m)
    expect(distanceLabel(HOME, { lat: 35, lng: 135.01 })).toBe('숙소에서 910m');
  });

  test('L16_B5_방향이_바뀌어도_같다', () => {
    const a = { lat: 35.01, lng: 135.02 };
    expect(distanceLabel(HOME, a)).toBe(distanceLabel(a, HOME));
  });

  const toMetres = (label: string) => {
    const match = /^숙소에서 ([0-9.]+)(m|km)$/.exec(label);
    expect(match).not.toBeNull();
    return Number(match![1]) * (match![2] === 'km' ? 1000 : 1);
  };

  test('L17_AC5_더_멀면_글자의_거리가_줄지_않는다_단조', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 50000, noNaN: true }), fc.double({ min: 0, max: 50000, noNaN: true }), (a, b) => {
        const [near, far] = a <= b ? [a, b] : [b, a];
        expect(toMetres(distanceLabel(HOME, north(near)))).toBeLessThanOrEqual(toMetres(distanceLabel(HOME, north(far))));
      }),
    );
  });

  test('L18_B5_걷는_시간을_쓰지_않는다', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 50000, noNaN: true }), (metres) => {
        expect(distanceLabel(HOME, north(metres))).toMatch(/^숙소에서 [0-9.]+(m|km)$/);
      }),
    );
  });
});

// ---------- formatStay ----------

describe('formatStay', () => {
  test.each([
    [90, '1시간 30분'],
    [60, '1시간'],
    [45, '45분'],
    [15, '15분'],
    [59, '59분'],
    [61, '1시간 1분'],
    [75, '1시간 15분'],
    [119, '1시간 59분'],
    [120, '2시간'],
    [285, '4시간 45분'],
    [300, '5시간'],
  ])('L19_B5_%d분은_%s', (minutes, label) => {
    expect(formatStay(minutes)).toBe(label);
  });

  test('L20_AC5_15에서_300까지_글자를_되읽으면_같은_분', () => {
    fc.assert(
      fc.property(fc.integer({ min: 15, max: 300 }), (minutes) => {
        const match = /^(?:(\d+)시간)?\s?(?:(\d+)분)?$/.exec(formatStay(minutes));
        expect(match).not.toBeNull();
        expect(Number(match![1] ?? 0) * 60 + Number(match![2] ?? 0)).toBe(minutes);
      }),
    );
  });

  test('L21_AC5_0분이나_60분_같은_빈_조각을_쓰지_않는다', () => {
    fc.assert(
      fc.property(fc.integer({ min: 15, max: 300 }), (minutes) => {
        expect(formatStay(minutes)).not.toMatch(/(^|\s)0(시간|분)|60분/);
      }),
    );
  });
});

// ---------- todayHoursText ----------

describe('todayHoursText', () => {
  const fact = (value: string | null, status: ChipKind) => [
    { field: 'opening_hours', value, status, source_type: 'demo', checked_at: null },
  ];

  test.each<[string | null, ChipKind, string, ChipKind]>([
    [null, 'confirmed', '오늘 휴무', 'confirmed'],
    [null, 'unverified', '오늘 휴무', 'unverified'],
    [null, 'unknown', '영업시간 모름', 'unknown'],
  ])('L22_Q9_value_%s_status_%s는_%s', (value, status, text, chip) => {
    expect(todayHoursText(fact(value, status))).toEqual({ text, chip });
  });

  test.each<[string, ChipKind]>([
    ['10:00-18:00', 'confirmed'],
    ['10:00-18:00', 'unverified'],
    ['11:00-14:00,17:00-22:00', 'confirmed'],
    ['18:00-26:00', 'unverified'],
  ])('L23_Q32_영업_값_%s_%s는_서버_글자_그대로이고_칩은_데이터_상태', (value, status) => {
    expect(todayHoursText(fact(value, status))).toEqual({ text: value, chip: status });
  });

  test('L24_B5_다른_field가_앞에_있어도_opening_hours를_읽는다', () => {
    const other = { field: 'price', value: '1000엔', status: 'confirmed' as const };
    const out = todayHoursText([other, ...fact(null, 'unknown')]);
    expect(out).toEqual({ text: '영업시간 모름', chip: 'unknown' });
  });

  test('L25_규칙2_미확인을_확인됨으로_내보내지_않는다', () => {
    fc.assert(
      fc.property(fc.constantFrom('10:00-18:00', null), fc.constantFrom<ChipKind>('confirmed', 'unverified', 'unknown'), (value, status) => {
        expect(todayHoursText(fact(value, status)).chip).toBe(status);
      }),
    );
  });
});

// ---------- projectRoute ----------

describe('projectRoute', () => {
  const inBox = (p: { x: number; y: number }, w: number, h: number, pad: number) => {
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(pad - 1e-9);
    expect(p.x).toBeLessThanOrEqual(w - pad + 1e-9);
    expect(p.y).toBeGreaterThanOrEqual(pad - 1e-9);
    expect(p.y).toBeLessThanOrEqual(h - pad + 1e-9);
  };

  test.each([
    [300, 120, 16],
    [200, 200, 0],
    [121, 77, 10],
  ])('L26_B5_한_점이면_가운데_%d_%d_%d', (w, h, pad) => {
    expect(projectRoute([{ lat: 35, lng: 135 }], w, h, pad)).toEqual([{ x: w / 2, y: h / 2 }]);
  });

  test('L27_B5_같은_점_여러_개도_0으로_나누지_않고_모두_같은_자리에_상자_안', () => {
    const out = projectRoute(Array(4).fill({ lat: 35, lng: 135 }), 300, 120, 16);
    expect(out).toHaveLength(4);
    out.forEach((p) => inBox(p, 300, 120, 16));
    out.forEach((p) => expect(p).toEqual(out[0]));
  });

  test.each([
    ['위도만 같음', [{ lat: 35, lng: 135 }, { lat: 35, lng: 135.1 }]],
    ['경도만 같음', [{ lat: 35, lng: 135 }, { lat: 35.1, lng: 135 }]],
  ])('L28_B5_%s_두_점도_상자_안이고_서로_다른_자리', (_name, points) => {
    const [a, b] = projectRoute(points, 300, 120, 16);
    inBox(a, 300, 120, 16);
    inBox(b, 300, 120, 16);
    expect(a).not.toEqual(b);
  });

  test('L29_B2_입력_순서를_지킨다', () => {
    const points = [{ lat: 35, lng: 135 }, { lat: 35.2, lng: 135.2 }, { lat: 35, lng: 135 }];
    const out = projectRoute(points, 300, 120, 16);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual(out[2]);
    expect(out[1]).not.toEqual(out[0]);
  });

  test('L30_AC5_모든_점이_상자_안', () => {
    const point = fc.record({
      lat: fc.double({ min: 24, max: 46, noNaN: true }),
      lng: fc.double({ min: 122, max: 146, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(point, { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 40, max: 800 }),
        fc.integer({ min: 40, max: 800 }),
        fc.integer({ min: 0, max: 20 }),
        (points, w, h, pad) => {
          const out = projectRoute(points, w, h, pad);
          expect(out).toHaveLength(points.length);
          out.forEach((p) => inBox(p, w, h, pad));
        },
      ),
    );
  });

  test('L31_Q12_북쪽이_위_동쪽이_오른쪽', () => {
    const [home, ne] = projectRoute([{ lat: 35, lng: 135 }, { lat: 35.1, lng: 135.1 }], 300, 120, 16);
    expect(ne.x).toBeGreaterThan(home.x);
    expect(ne.y).toBeLessThan(home.y);
  });

  test('L42_Q12_축을_따로_봐도_북쪽은_y만_동쪽은_x만_바뀐다', () => {
    const [home, north, east] = projectRoute(
      [{ lat: 35, lng: 135 }, { lat: 35.1, lng: 135 }, { lat: 35, lng: 135.1 }],
      300,
      120,
      16,
    );
    expect(north.y).toBeLessThan(home.y);
    expect(north.x).toBeCloseTo(home.x, 9);
    expect(east.x).toBeGreaterThan(home.x);
    expect(east.y).toBeCloseTo(home.y, 9);
  });

  test('L43_Q12_더_북쪽이면_y가_작고_더_동쪽이면_x가_크다_항상', () => {
    const coordinate = (min: number, max: number) => fc.double({ min, max, noNaN: true });
    fc.assert(
      fc.property(coordinate(30, 40), coordinate(30, 40), coordinate(130, 140), coordinate(130, 140), (a, b, c, d) => {
        fc.pre(a !== b && c !== d);
        const [p, q] = projectRoute([{ lat: a, lng: c }, { lat: b, lng: d }], 300, 120, 16);
        expect(Math.sign(q.y - p.y)).toBe(-Math.sign(b - a));
        expect(Math.sign(q.x - p.x)).toBe(Math.sign(d - c));
      }),
    );
  });
});

// ---------- placeholderFor ----------

describe('placeholderFor', () => {
  const TABLE: Record<string, [string, string]> = {
    food: ['#8FA3B8', '#4F6479'],
    cafe: ['#B7B2C7', '#6E6A85'],
    walk: ['#D3CABB', '#8D8576'],
    night: ['#5D6B8A', '#2F3A55'],
    shop: ['#D9B8B4', '#96706C'],
    museum: ['#9DB8BF', '#547882'],
    experience: ['#9DB8BF', '#547882'],
    landmark: ['#BBC2CA', '#737C88'],
  };

  test.each(Object.entries(TABLE))('L32_B5_%s의_두_색', (category, colours) => {
    expect(placeholderFor(category).map((c) => c.toUpperCase())).toEqual(colours);
  });

  test('L33_B5_서버_종류_모두가_표에_있다', () => {
    const spec = JSON.parse(readFileSync(join(REPO_ROOT, 'packages/api-types/openapi.json'), 'utf8'));
    const categories = spec.components.schemas.Place.properties.category.enum as string[];
    expect([...categories].sort()).toEqual(Object.keys(TABLE).sort());
    for (const category of categories) expect(placeholderFor(category)).toHaveLength(2);
  });
});

// ---------- contrast ----------

describe('contrast', () => {
  test.each([
    ['#000000', '#FFFFFF', 21],
    ['#FFFFFF', '#FFFFFF', 1],
    ['#000000', '#000000', 1],
  ])('L34_B5_%s_%s는_%d', (fg, bg, ratio) => {
    expect(contrast(fg, bg)).toBeCloseTo(ratio, 5);
  });

  test.each(CONTRAST_PAIRS)('L35_S4_4_%s_%s는_문서의_%d', (fg, bg, ratio) => {
    expect(Math.abs(contrast(COLORS[fg], COLORS[bg]) - ratio)).toBeLessThanOrEqual(0.01);
  });

  test.each(REJECTED_PAIRS)('L36_S4_4_탈락_조합_%s_%s는_문서의_%d이고_4_5_미만', (fg, bg, ratio) => {
    const value = contrast(fg, bg);
    expect(Math.abs(value - ratio)).toBeLessThanOrEqual(0.01);
    expect(value).toBeLessThan(4.5);
  });

  test('L37_B5_소문자_hex도_같다', () => {
    expect(contrast('#ff5a00', '#1a1a1a')).toBeCloseTo(contrast('#FF5A00', '#1A1A1A'), 10);
  });

  const hex = fc
    .integer({ min: 0, max: 0xffffff })
    .map((value) => `#${value.toString(16).padStart(6, '0').toUpperCase()}`);

  test('L38_AC5_항상_1에서_21이고_순서를_바꿔도_같다', () => {
    fc.assert(
      fc.property(hex, hex, (a, b) => {
        const value = contrast(a, b);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(21);
        expect(contrast(b, a)).toBeCloseTo(value, 10);
      }),
    );
  });
});
