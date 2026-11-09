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
//     Q10 늘 열림 -> ~~칩 없이~~ "확인됨" 칩 + "늘 열려 있어" (§14 N9로 바뀜). 코스 줄(P3)도 같은 칩 규칙 (코스 줄 facts, test-support hoursFact)
//   §14 N13 + (a) (이 테스트가 정한 것, 승인 대기):
//     [패스] `skip-{id}`·[담기] `like-{id}`는 이름·이유와 같은 띠: 이름 글자와 버튼을 함께 담은 가장 가까운 상자가 가로(flexDirection row),
//       이름·이유는 그 띠 안에서 버튼보다 앞(왼쪽), 이름·이유 글자는 numberOfLines 1
//     카드 렌더 값이 candidateCardParts()를 쓴다: 그림 높이·아래 여백, 이름·이유 줄 높이 합, 사실 줄 위 여백·최소 높이, 출처 줄 위 여백
//     사실 줄은 한 줄(flexWrap 'wrap' 아님) — §4-11 fact-line "칩 · 값 · 거리 한 줄(24)"
//     목록 맨 아래 여백 ≥ 막대 72 + 12 -> task-010-s14-pm-answers T10_S14_PM4에서 본다
//     Q13 무늬는 docs/design/place-images/{종류}.svg 파일이 정본 -> 앱 assets 안에 같은 내용의 파일이 있다
import { screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { COLORS } from '../test-support/design-table';
import { json } from '../test-support/fake-server';
import { happyServer, R, resetDevice, toP1, toP2, toP3 } from '../test-support/planning-driver';
import { batch, course, day, hoursFact, packed, PLACES, relaxed } from '../test-support/planning-fixtures';
import { buttonsFilledWith, chain, childOn, commonAncestor, filledWith, isInside, rootHost, same, styleOf, treeIndex, type Host } from '../test-support/screen-tree';

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

  // §14 N9 (§9 Q10 고침): 늘 열림에도 "확인됨" 칩. 옛 "칩 없이" 테스트를 바꿈
  test('T11_S14_N9_늘_열림(O1)은_확인됨_칩과_늘_열려_있어', async () => {
    serve(withHours('D01', ALWAYS));
    await toP2();
    const line = within(screen.getByTestId('fact-line-D01'));
    expect(line.getByText('확인됨')).toBeTruthy(); // 칩은 사실 줄 안 (칩 자리)
    expect(line.getByText('늘 열려 있어')).toBeTruthy();
    const inCard = within(screen.getByTestId('candidate-card-D01'));
    for (const chip of ['미확인', '모름', '추천 시간대']) expect(inCard.queryByText(chip)).toBeNull();
    expect(inCard.getAllByText('확인됨')).toHaveLength(1);
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

  // §14 N9: 코스 줄도 늘 열림에 "확인됨" 칩. 옛 "칩 없이" 테스트를 바꿈
  test('T11_S14_N9_P3_늘_열림_줄은_확인됨_칩과_늘_열려_있어', async () => {
    happyServer().on(R.compose, json(200, withItemHours(ALWAYS)));
    await toP3();
    const row = within(screen.getByTestId('course-row-1'));
    expect(row.getByText('확인됨')).toBeTruthy();
    for (const chip of ['미확인', '모름', '추천 시간대']) expect(row.queryByText(chip)).toBeNull();
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

// ---------- §14 N13 + (a): [패스]·[담기]는 이름·이유 오른쪽 같은 띠, 카드 높이 433, 목록 끝 여백 ----------
// 근거: TASK-011 §14 N13 + (a), task-011-review.md §9-3 N13·§9-4 (a) 표 1~3, DESIGN-001 §4-11 재검수로 정한 것, §4-11 fact-line.
// 한계: Jest는 실제 레이아웃(출처 줄 아랫변·막대 윗변)을 재지 못한다. 그래서 (1) 카드 부분값은 candidate-fit 함수(task-011-lib),
//       (2) 여기서는 렌더 트리의 스타일 값이 그 함수의 값을 쓰는지, (3) 버튼이 이름·이유 아래 따로 한 줄을 먹지 않는지만 본다.
//       실제 간격(출처 줄 아랫변 ≤ 막대 윗변 − 12, iPhone 17 처음 화면)은 r3-06 스크린샷으로 확인한다 (TASK-011 §16).

describe('§14 N13 후보 카드 버튼 자리와 높이', () => {
  const fit = () => require('@/planning/candidate-fit');
  const num = (value: unknown) => (typeof value === 'number' ? value : 0);
  const textHost = (cardId: string, value: string) => within(screen.getByTestId(`candidate-card-${cardId}`)).getByText(value) as unknown as Host;

  test.each(['skip', 'like'])('T11_S14_N13_%s_버튼은_이름과_같은_가로_띠', async (kind) => {
    happyServer();
    await toP2();
    for (const place of PLACES) {
      const name = textHost(place.id, place.name);
      const band = commonAncestor(name, byId(`${kind}-${place.id}`));
      expect(isInside(band, card(place.id))).toBe(true);
      expect(band === card(place.id)).toBe(false); // 카드 자체(세로)가 아니라 그 안의 띠
      expect(styleOf(band).flexDirection).toBe('row');
    }
  });

  test('T11_S14_N13_이름·이유는_띠_안에서_버튼보다_앞(왼쪽)', async () => {
    happyServer();
    await toP2();
    const name = textHost('D01', PLACES[0].name);
    const why = textHost('D01', '이유 D01');
    const skip = byId('skip-D01');
    expect(commonAncestor(name, skip)).toBe(commonAncestor(why, skip));
    expect(treeIndex(name)).toBeLessThan(treeIndex(skip));
    expect(treeIndex(why)).toBeLessThan(treeIndex(skip));
  });

  test('T11_S14_N13_이름·이유는_한_줄씩(넘치면_…)', async () => {
    happyServer();
    await toP2();
    for (const place of PLACES) {
      expect(textHost(place.id, place.name).props.numberOfLines).toBe(1);
      expect(textHost(place.id, `이유 ${place.id}`).props.numberOfLines).toBe(1);
    }
  });

  test('T11_S14_a_그림은_316이고_아래_12', async () => {
    happyServer();
    await toP2();
    const parts = fit().candidateCardParts();
    const photo = within(screen.getByTestId('candidate-card-D01')).getByTestId('place-pattern') as unknown as Host;
    const box = chain(photo).find((host) => styleOf(host).height === parts.photo && isInside(host, card('D01')));
    expect(box).toBeDefined();
    expect(num(styleOf(box!).marginBottom)).toBe(parts.photoGap);
  });

  test('T11_S14_a_이름·이유_띠는_46(이름_줄_높이_+_이유_줄_높이_+_사이_여백)', async () => {
    happyServer();
    await toP2();
    const name = styleOf(textHost('D01', PLACES[0].name));
    const why = styleOf(textHost('D01', '이유 D01'));
    const between = num(name.marginBottom) + num(why.marginTop);
    expect(num(name.lineHeight) + num(why.lineHeight) + between).toBe(fit().candidateCardParts().nameWhy);
  });

  test('T11_S14_a_사실_줄은_띠_아래_12·최소_높이_24·한_줄', async () => {
    happyServer();
    await toP2();
    const parts = fit().candidateCardParts();
    const line = styleOf(byId('fact-line-D01'));
    expect(num(line.marginTop)).toBe(parts.factGap);
    expect(Math.max(num(line.height), num(line.minHeight))).toBe(parts.factLine);
    expect(line.flexWrap).not.toBe('wrap');
  });

  test('T11_S14_a_출처_줄은_사실_줄_아래_4·높이_19_이하', async () => {
    serve(withHours('D01', GOOGLE));
    await toP2();
    const parts = fit().candidateCardParts();
    const source = byId('fact-source-D01');
    expect(num(styleOf(source).marginTop)).toBe(parts.sourceGap);
    const slot = within(screen.getByTestId('fact-source-D01')).getByTestId('g-slot') as unknown as Host;
    expect(num(styleOf(slot).height)).toBeLessThanOrEqual(parts.source);
  });

  test('T11_S14_a_버튼은_이름·이유_아래_따로_한_줄을_먹지_않는다(사실_줄_앞_띠_하나)', async () => {
    happyServer();
    await toP2();
    const name = textHost('D01', PLACES[0].name);
    const band = commonAncestor(name, byId('skip-D01'));
    const line = byId('fact-line-D01');
    // 카드 안 세로 순서: 그림 -> 띠(이름·이유·버튼) -> 사실 줄. 띠와 사실 줄 사이에 다른 상자가 없다
    const column = commonAncestor(band, line);
    const items = column.children.filter((c): c is Host => typeof c !== 'string');
    const bandAt = items.findIndex((c) => isInside(band, c));
    const lineAt = items.findIndex((c) => isInside(line, c));
    expect(lineAt - bandAt).toBe(1);
  });
});

// 목록 맨 아래 여백 ≥ 막대 72 + 12 는 task-010-s14-pm-answers.test.tsx T10_S14_PM4 (§14로 고친 승인 테스트)

// ---------- §16 앱 1: 후보 화면 위쪽 높이 (task-011-review.md §12-3 1, DESIGN-001 §4-11 r2 재검수로 정한 것) ----------
// 머리 → 말풍선 8 (20에서 바뀜) · 말풍선 46 · 말풍선 → 칩 줄 16 · 칩 줄 44(보이는 36) · 칩 줄 → 카드 16.
// 렌더 트리 값으로 본다 (Jest는 실제 레이아웃을 재지 못한다):
//   세로 스크롤 목록 = 후보 카드를 담은 가장 가까운 세로 ScrollView (테스트 환경에서는 RCTScrollView가 contentContainerStyle을 들고, 안쪽 View 하나가 본문 줄들을 담는다)
//   머리 → 말풍선 = 목록 contentContainerStyle 위 여백 + 말풍선 줄의 위 바깥 여백 (말풍선 줄이 본문 첫 줄)
//   줄 사이 = 목록 gap(rowGap) + 앞 줄 아래 바깥 여백 + 뒷 줄 위 바깥 여백
//   말풍선 46 = 말풍선 상자(bg-2) 위아래 안쪽 여백 + 한 줄 글 줄 높이
//   칩 줄 44 = 칩 보이는 높이 36 + 칩 가로 스크롤 안쪽 위아래 여백
describe('§16 앱 1 후보 화면 위쪽 높이', () => {
  const num = (value: unknown) => (typeof value === 'number' ? value : 0);
  const side = (style: Record<string, any>, kind: 'padding' | 'margin', at: 'Top' | 'Bottom' | 'Left' | 'Right') =>
    num(style[`${kind}${at}`] ?? style[at === 'Top' || at === 'Bottom' ? `${kind}Vertical` : `${kind}Horizontal`] ?? style[kind]);
  const contentStyle = (scroll: Host) => (StyleSheet.flatten(scroll.props.contentContainerStyle) ?? {}) as Record<string, any>;

  /** 후보 카드를 담은 세로 스크롤 목록과 그 안의 본문 줄들 */
  const page = () => {
    const list = chain(card('D01')).find((host) => host.props.contentContainerStyle !== undefined && host.props.horizontal !== true);
    if (!list) throw new Error('후보 카드를 담은 세로 스크롤 목록이 없다');
    const inner = list.children.find((c): c is Host => typeof c !== 'string')!;
    const rowOf = (host: Host) => childOn(inner, host);
    const items = inner.children.filter((c): c is Host => typeof c !== 'string');
    return { list, inner, rowOf, items };
  };
  const bubbleText = () => screen.getByText('서버가_준_묶음_말') as unknown as Host;
  const chipRow = () => chain(byId('direction-' + batch().directions[0].id)).find((host) => host.props.horizontal === true)!;
  const gapBetween = (list: Host, inner: Host, a: Host, b: Host) => {
    const own = { ...contentStyle(list), ...styleOf(inner) };
    return num(own.rowGap ?? own.gap) + side(styleOf(a), 'margin', 'Bottom') + side(styleOf(b), 'margin', 'Top');
  };

  test('T11_S16_1_말풍선_줄이_본문_첫_줄이고_그_다음_칩_줄_그_다음_카드', async () => {
    happyServer();
    await toP2();
    const { items, rowOf } = page();
    expect(items.indexOf(rowOf(bubbleText()))).toBe(0);
    expect(items.indexOf(rowOf(chipRow()))).toBe(1);
    expect(items.indexOf(rowOf(card('D01')))).toBe(2);
  });

  test('T11_S16_1_머리_→_말풍선은_8(20이_아니다)', async () => {
    happyServer();
    await toP2();
    const { list, rowOf } = page();
    const top = side(contentStyle(list), 'padding', 'Top') + side(styleOf(rowOf(bubbleText())), 'margin', 'Top');
    expect(top).toBe(8);
    expect(top).not.toBe(20);
  });

  test('T11_S16_1_위만_줄이고_좌우_화면_여백은_그대로_20', async () => {
    happyServer();
    await toP2();
    const { list } = page();
    expect(side(contentStyle(list), 'padding', 'Left')).toBe(20);
    expect(side(contentStyle(list), 'padding', 'Right')).toBe(20);
  });

  test('T11_S16_1_말풍선은_46(위아래_안쪽_여백_+_한_줄_글_높이)', async () => {
    happyServer();
    await toP2();
    const text = bubbleText();
    const box = chain(text).find((host) => same(styleOf(host).backgroundColor, COLORS['bg-2']));
    expect(box).toBeDefined();
    const inside = side(styleOf(box!), 'padding', 'Top') + side(styleOf(box!), 'padding', 'Bottom');
    expect(inside + num(styleOf(text).lineHeight)).toBe(46);
  });

  test('T11_S16_1_말풍선_→_칩_줄은_16', async () => {
    happyServer();
    await toP2();
    const { list, inner, rowOf } = page();
    expect(gapBetween(list, inner, rowOf(bubbleText()), rowOf(chipRow()))).toBe(16);
  });

  test('T11_S16_1_칩_줄은_44(보이는_칩_36_+_위아래_누르는_영역_4)', async () => {
    happyServer();
    await toP2();
    const chip = styleOf(byId('direction-' + batch().directions[0].id));
    const visible = Math.max(num(chip.height), num(chip.minHeight));
    expect(visible).toBe(36);
    const row = contentStyle(chipRow());
    expect(visible + side(row, 'padding', 'Top') + side(row, 'padding', 'Bottom')).toBe(44);
  });

  test('T11_S16_1_칩_줄_→_카드는_16', async () => {
    happyServer();
    await toP2();
    const { list, inner, rowOf } = page();
    expect(gapBetween(list, inner, rowOf(chipRow()), rowOf(card('D01')))).toBe(16);
  });
});
