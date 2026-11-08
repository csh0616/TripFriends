/// <reference types="jest" />
// TASK-011 A2 계획 대화 머리·후보 카드, A4 Google 값은 상자 없이 출처 줄만, A5 밤거리 추천 시간대 칩, AC-3(주황).
// 로직·가드레일만 본다 (그림 크기·간격·색 모습은 디자이너 재검수 몫).
// 근거: TASK-011 §A A2·A4·A5·AC-3, DESIGN-001 §4-11(날 이름·사실 줄·확인 칩과 추천 칩), §4-8(큰 카드 = 무늬 + 그림),
//       task-011-review.md §2 15·16·18·19·20번 줄, §1 PM 답 6, TASK-010 §13 O1·O2·O4.
//
// 계약 (이 테스트가 정한 이름, 승인 대기):
//   후보 카드 사실 줄: `fact-line-{place_id}` = 칩 · 값 · 거리 한 줄, `fact-source-{place_id}` = 출처 줄(Google Maps 자리 g-slot 또는 "Tripfriends")
//     두 줄은 서로 안에 있지 않다. 출처가 없는 카드(데모 등)는 `fact-source-*`가 없어도 된다
//   A4: 후보 카드 안 사실 줄에는 bg-2 바탕 상자가 없다 (fact-box-google은 상세 카드에만)
//   A5: curated 시간대(값이 늘 열림 "00:00-24:00"이 아닌 curated 영업시간) -> 칩 글자 "추천 시간대", "확인됨" 칩 없음
//       todayHoursText의 chip(내부 status)은 그대로 'confirmed' (task-010-lib T10_S13_O4 그대로 통과해야 한다)
//       늘 열림(O1)은 A5 대상이 아니라 "확인됨" 그대로
//   시각 범위: 화면 글자에 "HH:MM-HH:MM"·"HH:MM~HH:MM"이 없고 엔 대시 "HH:MM–HH:MM" (서버 값의 하이픈은 화면에서 바꾼다)
//   A2 큰 카드 그림: 후보 카드 그림 안에 무늬 `place-pattern`
//   §9 v1.1:
//     Q7 두 구간 "11:00–14:00 · 17:00–22:00" · Q9 끝 카드 [다른 곳 보여 줘]는 주황 아님, 주황은 [코스 짜기]만
//     Q10 늘 열림 -> 칩 없이 "늘 열려 있어". 코스 줄(P3)도 같은 칩 규칙 (코스 줄 facts, test-support hoursFact)
//     Q13 무늬는 docs/design/place-images/{종류}.svg 파일이 정본 -> 앱 assets 안에 같은 내용의 파일이 있다
import { screen, within } from '@testing-library/react-native';

import { COLORS } from '../test-support/design-table';
import { json } from '../test-support/fake-server';
import { happyServer, R, resetDevice, toP1, toP2, toP3 } from '../test-support/planning-driver';
import { batch, course, day, hoursFact, packed, PLACES, relaxed } from '../test-support/planning-fixtures';
import { buttonsFilledWith, filledWith, isInside, rootHost, styleOf, type Host } from '../test-support/screen-tree';

const EN_DASH = '–';

const withHours = (id: string, over: object) =>
  PLACES.map((p) => (p.id === id ? { ...p, facts: p.facts.map((f) => (f.field === 'opening_hours' ? { ...f, ...over } : f)) } : p));
const serve = (places: typeof PLACES) =>
  happyServer().on(R.answer, json(200, batch({ candidates: places.map((p) => ({ place: p, why: `이유 ${p.id}` })) })));

const GOOGLE = { source_type: 'google' }; // D01 = 10:00-18:00 확인됨
const ALWAYS = { source_type: 'curated', value: '00:00-24:00', status: 'confirmed' }; // O1 늘 열림
const NIGHT = { source_type: 'curated', value: '17:00-24:00', status: 'confirmed' }; // O2 밤거리 시간대

const textsUnder = (host: Host): string[] =>
  host.queryAll((h) => h.type === 'Text').map((h) => (h.children ?? []).filter((c): c is string => typeof c === 'string').join(''));
const card = (id: string) => screen.getByTestId(`candidate-card-${id}`) as unknown as Host;
const byId = (id: string) => screen.getByTestId(id) as unknown as Host;

beforeEach(() => resetDevice());
afterEach(() => jest.restoreAllMocks());

// ---------- A2 머리 (review 15번 줄, §4-11 날 이름) ----------

describe('A2 계획 대화 머리', () => {
  test('T11_A2_머리_제목은_N일째_고르는_중', async () => {
    happyServer();
    await toP2();
    expect(screen.getByText('2일째 고르는 중')).toBeTruthy();
    expect(screen.queryByText(/둘째 날/)).toBeNull();
  });

  test('T11_A2_부제는_요일_한_글자와_엔_대시', async () => {
    happyServer();
    await toP2();
    expect(screen.getByText(`12월 2일 수 · 10:00${EN_DASH}20:00`)).toBeTruthy();
  });

  test.each([
    ['2026-12-12', '13:00', '21:00', `12월 12일 토 · 13:00${EN_DASH}21:00`], // §4-11의 예
    ['2026-12-06', '10:00', '20:00', `12월 6일 일 · 10:00${EN_DASH}20:00`],
    ['2027-01-05', '09:30', '21:15', `1월 5일 화 · 09:30${EN_DASH}21:15`],
  ])('T11_A2_부제_%s', async (date, start, end, subtitle) => {
    happyServer().on(R.answer, json(200, batch({ day: { ...day, date, start, end } })));
    await toP2();
    expect(screen.getByText(subtitle)).toBeTruthy();
  });
});

// ---------- A2 큰 카드 그림 = 무늬 + 그림 (review 16번 줄, §4-8) ----------

describe('A2 큰 카드 그림', () => {
  test('T11_A2_후보_카드_그림에_무늬가_있다', async () => {
    happyServer();
    await toP2();
    for (const place of PLACES) expect(within(screen.getByTestId(`candidate-card-${place.id}`)).getByTestId('place-pattern')).toBeTruthy();
  });
});

// ---------- 시각 범위 엔 대시 (review 20번 줄) ----------

describe('A2 시각 범위는 엔 대시', () => {
  test('T11_A2_후보_카드_영업시간은_엔_대시', async () => {
    happyServer();
    await toP2();
    expect(within(screen.getByTestId('candidate-card-D01')).getByText(`10:00${EN_DASH}18:00`)).toBeTruthy();
  });

  test('T11_A2_후보_카드_어느_글자에도_하이픈·물결_시각_범위가_없다', async () => {
    happyServer();
    await toP2();
    const all = PLACES.flatMap((place) => textsUnder(card(place.id)));
    expect(all.filter((value) => /\d{2}:\d{2}\s*[-~]\s*\d{2}:\d{2}/.test(value))).toEqual([]);
  });

  test('T11_A2_curated_시간대도_엔_대시', async () => {
    serve(withHours('D01', NIGHT));
    await toP2();
    expect(within(screen.getByTestId('candidate-card-D01')).getByText(new RegExp(`17:00${EN_DASH}24:00`))).toBeTruthy();
  });
});

// ---------- 사실 줄 · 출처 위치 (review 18번 줄) + A4 (19번 줄) ----------

describe('A2·A4 사실 줄과 출처 줄', () => {
  test('T11_A2_Google_값_카드_칩·값·거리는_한_줄_출처는_아래_줄', async () => {
    serve(withHours('D01', GOOGLE));
    await toP2();
    const line = byId('fact-line-D01');
    const source = byId('fact-source-D01');
    expect(within(screen.getByTestId('fact-line-D01')).getByText('확인됨')).toBeTruthy();
    expect(within(screen.getByTestId('fact-line-D01')).getByText(`10:00${EN_DASH}18:00`)).toBeTruthy();
    expect(within(screen.getByTestId('fact-line-D01')).getByText('숙소에서 650m')).toBeTruthy();
    expect(within(screen.getByTestId('fact-source-D01')).getByTestId('g-slot')).toBeTruthy();
    expect(isInside(source, line) || isInside(line, source)).toBe(false);
  });

  test('T11_A2_Tripfriends_출처도_Google과_같은_자리(아래_줄)', async () => {
    serve(withHours('D01', ALWAYS));
    await toP2();
    expect(within(screen.getByTestId('fact-source-D01')).getByText(/Tripfriends/)).toBeTruthy();
    expect(within(screen.getByTestId('fact-line-D01')).queryByText(/Tripfriends/)).toBeNull();
    expect(within(screen.getByTestId('fact-line-D01')).getByText('늘 열려 있어')).toBeTruthy();
  });

  test('T11_A4_후보_카드의_Google_값은_bg_2_상자에_담지_않는다', async () => {
    serve(withHours('D01', GOOGLE));
    await toP2();
    const value = within(screen.getByTestId('candidate-card-D01')).getByText(`10:00${EN_DASH}18:00`) as unknown as Host;
    const boxes = filledWith(COLORS['bg-2'], card('D01')).filter((box) => isInside(value, box));
    expect(boxes).toEqual([]);
  });

  test('T11_A4_후보_카드_사실_줄_전체에_bg_2_상자가_없다', async () => {
    serve(withHours('D01', GOOGLE));
    await toP2();
    expect(filledWith(COLORS['bg-2'], byId('fact-line-D01'))).toEqual([]);
    expect(filledWith(COLORS['bg-2'], byId('fact-source-D01'))).toEqual([]);
  });
});

// ---------- A5 밤거리 칩 (PM 답 6, §4-11 확인 칩과 추천 칩) ----------

describe('A5 curated 시간대는 추천 시간대 칩', () => {
  test('T11_A5_curated_시간대_카드는_확인됨_대신_추천_시간대', async () => {
    serve(withHours('D01', NIGHT));
    await toP2();
    const inCard = within(screen.getByTestId('candidate-card-D01'));
    expect(inCard.getByText('추천 시간대')).toBeTruthy();
    expect(inCard.queryByText('확인됨')).toBeNull();
    expect(inCard.getByText(/Tripfriends/)).toBeTruthy(); // 출처는 그대로 (O4)
  });

  test('T11_A5_추천_시간대_칩은_사실_줄_안(칩_자리)', async () => {
    serve(withHours('D01', NIGHT));
    await toP2();
    expect(within(screen.getByTestId('fact-line-D01')).getByText('추천 시간대')).toBeTruthy();
  });

  test('T11_A5_추천_시간대_칩은_주황도_확인_색도_아니다', async () => {
    serve(withHours('D01', NIGHT));
    await toP2();
    const label = within(screen.getByTestId('candidate-card-D01')).getByText('추천 시간대') as unknown as Host;
    for (const host of [label, label.parent!]) {
      for (const colour of [COLORS.brand, COLORS.ok, COLORS['ok-bg'], COLORS.warn, COLORS['warn-bg']]) {
        const style = styleOf(host);
        expect(String(style.backgroundColor ?? '').toUpperCase()).not.toBe(colour);
        expect(String(style.color ?? '').toUpperCase()).not.toBe(colour);
      }
    }
  });

  test('T11_A5_내부_status는_그대로_confirmed', () => {
    const { todayHoursText } = require('@/lib/today-hours-text');
    expect(todayHoursText([{ field: 'opening_hours', value: '17:00-24:00', status: 'confirmed', source_type: 'curated' }]).chip).toBe('confirmed');
  });

  test('T11_Q10_늘_열림(O1)은_칩_없이_늘_열려_있어', async () => {
    serve(withHours('D01', ALWAYS));
    await toP2();
    const inCard = within(screen.getByTestId('candidate-card-D01'));
    for (const chip of ['확인됨', '미확인', '모름', '추천 시간대']) expect(inCard.queryByText(chip)).toBeNull();
    expect(inCard.getByText('늘 열려 있어')).toBeTruthy();
  });

  test('T11_A5_Google·데모_영업시간은_추천_시간대가_아니다', async () => {
    serve(withHours('D01', GOOGLE));
    await toP2();
    expect(screen.queryByText('추천 시간대')).toBeNull();
    expect(within(screen.getByTestId('candidate-card-D01')).getByText('확인됨')).toBeTruthy();
    expect(within(screen.getByTestId('candidate-card-D02')).getByText('미확인')).toBeTruthy();
  });
});

// ---------- AC-3 계획 대화의 주황 ----------

describe('AC-3 계획 대화의 주황 버튼', () => {
  test('T11_AC3_P1_주황_버튼은_하나', async () => {
    happyServer();
    await toP1();
    expect(buttonsFilledWith(COLORS.brand)).toHaveLength(1);
  });

  // §9 Q9: 끝 카드 [다른 곳 보여 줘]는 btn-card-secondary(주황 아님), 주황은 [코스 짜기]만
  test('T11_Q9_P2_주황_버튼은_코스_짜기_하나뿐(끝_카드_포함)', async () => {
    happyServer();
    await toP2();
    const orange = buttonsFilledWith(COLORS.brand);
    expect(orange).toHaveLength(1);
    expect(isInside(orange[0], byId('compose-button')) || isInside(byId('compose-button'), orange[0])).toBe(true);
  });

  test('T11_Q9_끝_카드_다른_곳_보여_줘는_주황이_아니다', async () => {
    happyServer();
    await toP2();
    const label = within(screen.getByTestId('end-card')).getByText('다른 곳 보여 줘') as unknown as Host;
    expect(buttonsFilledWith(COLORS.brand, byId('end-card'))).toEqual([]);
    expect(isInside(label, byId('end-card'))).toBe(true);
  });

  test('T11_Q9_소진이면_끝_카드_주황은_코스_짜기만', async () => {
    happyServer().on(R.answer, json(200, batch({ exhausted: true })));
    await toP2();
    const orange = buttonsFilledWith(COLORS.brand);
    expect(orange.length).toBeGreaterThanOrEqual(1);
    for (const host of orange) expect(textsUnder(host).join('')).toBe('코스 짜기');
  });

  test('T11_AC3_P2_후보_카드_안_버튼에_주황이_없다', async () => {
    happyServer();
    await toP2();
    for (const place of PLACES) expect(buttonsFilledWith(COLORS.brand, card(place.id))).toEqual([]);
  });

  test('T11_AC3_P3_주황_버튼은_하나', async () => {
    happyServer();
    await toP3();
    expect(buttonsFilledWith(COLORS.brand, rootHost())).toHaveLength(1);
  });
});

// ---------- §9 Q7 두 구간 ----------

describe('§9 Q7 두 구간 영업시간', () => {
  test('T11_Q7_두_구간은_가운데_점으로', async () => {
    happyServer();
    await toP2();
    expect(within(screen.getByTestId('candidate-card-D02')).getByText('11:00–14:00 · 17:00–22:00')).toBeTruthy();
  });
});

// ---------- §9 Q10 코스 줄(P3)도 같은 칩 규칙 ----------

describe('§9 Q10 코스안 줄의 칩', () => {
  const withItemHours = (over: object) => {
    const option = relaxed();
    option.items[0] = { ...option.items[0], facts: [hoursFact('confirmed', over)] };
    return course([option, packed()]);
  };

  test('T11_Q10_P3_curated_시간대_줄은_추천_시간대', async () => {
    happyServer().on(R.compose, json(200, withItemHours(NIGHT)));
    await toP3();
    const row = within(screen.getByTestId('course-row-1'));
    expect(row.getByText('추천 시간대')).toBeTruthy();
    expect(row.queryByText('확인됨')).toBeNull();
  });

  test('T11_Q10_P3_늘_열림_줄은_칩_없이_늘_열려_있어', async () => {
    happyServer().on(R.compose, json(200, withItemHours(ALWAYS)));
    await toP3();
    const row = within(screen.getByTestId('course-row-1'));
    for (const chip of ['확인됨', '미확인', '모름', '추천 시간대']) expect(row.queryByText(chip)).toBeNull();
    expect(row.getByText(/늘 열려 있어/)).toBeTruthy();
  });

  test('T11_Q10_P3_데모·Google_줄은_전과_같이_확인_칩', async () => {
    happyServer();
    await toP3();
    expect(within(screen.getByTestId('course-row-1')).getByText('확인됨')).toBeTruthy();
    expect(within(screen.getByTestId('course-row-2')).getByText('미확인')).toBeTruthy();
  });
});

// ---------- §9 Q13 무늬 파일 ----------

describe('§9 Q13 무늬는 docs 그림 파일이 정본', () => {
  const { readdirSync, readFileSync, statSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  const { MOBILE_ROOT, REPO_ROOT } = require('../test-support/source-files');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
  const appFiles = () => [...walk(join(MOBILE_ROOT, 'assets')), ...walk(join(MOBILE_ROOT, 'src'))].map((path) => readFileSync(path, 'utf8'));

  test.each(['cafe', 'food', 'walk', 'museum', 'landmark', 'shop', 'experience', 'night'])('T11_Q13_%s_무늬_파일이_앱에_그대로_있다', (kind) => {
    const original = readFileSync(join(REPO_ROOT, 'docs', 'design', 'place-images', `${kind}.svg`), 'utf8').trim();
    expect(appFiles().some((text) => text.trim() === original || text.includes(original))).toBe(true);
  });
});
