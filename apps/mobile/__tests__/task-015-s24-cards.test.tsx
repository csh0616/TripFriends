/// <reference types="jest" />
// TASK-015 §24 디자이너 재검수 답 — 여행 중 카드 T-07 라벨 · 문장 (보드대로) · T-08 [숙소로 길 안내] 주 버튼.
// 로직 · 가드레일만 본다: 어떤 글이 있고 없는지, 주 버튼(주황 바탕 · 52)인지, 화면에 주황 주 버튼이 하나인지. 색 값 · 간격 · 아이콘 모양은 보지 않는다.
// 근거: TASK-015 §24 "디자이너가 정해 달라는 3가지" 1(T-08 [숙소로 길 안내] = 주 버튼 52, 보조 44 아님 — "화면에 주황 주 버튼 하나 규칙도 지켜짐(T-08이 메인 카드일 때)") ·
//       2(T-07 보드대로: 라벨 자물쇠 + "고정 일정 · 곧 출발", 제목 + 장소 줄, "N분 뒤에 출발해" + 출발 시각. 앱 라벨 "고정 일정이 곧이야"는 이유 줄과 겹침. 진행 막대는 보드에서 뺌) ·
//       task-015-design §12-1 중-5 · 하-8 · §12-5 · task-014-design §14 ①-30("고정 일정 · 곧 출발 · 저녁 예약 · 하나비 이자카야 19:00 시작 · 11분 뒤에 출발해 · 18:42 출발") ·
//       ①-31([숙소로 길 안내] 주 버튼) · DESIGN 토큰 btn 52 · btn-sm 44
//
// 계약 (이 파일이 정한 것):
//   T-07: card-T-07 안 글 "고정 일정 · 곧 출발"이 있고 "고정 일정이 곧이야"는 없다. 출발 시각 줄 "HH:MM 출발"(값 = leave_by).
//         남은 분 > 0이면 카드 글을 이어 읽은 것에 "N분 뒤에 출발해". 자물쇠 아이콘의 모양은 보지 않는다
//   T-08(숙소 있음 · map_url 있음): home-directions-button이 주 버튼 = 바탕 brand, 최소 높이 52(btn). 보조 small(44)이 아니다
//   여행 중 화면에서 T-08이 메인 카드면 화면 전체에서 주황 바탕의 눌리는 것은 정확히 하나 = home-directions-button
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { NowCardView } from '@/components/now/now-cards';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { COLORS, NUMBERS } from '../test-support/design-table';
import { mapControl } from '../test-support/maps-mock';
import { resetDevice } from '../test-support/planning-driver';
import { installConfig, nowServer, TEST_KEY, toNow } from '../test-support/trip-now-driver';
import { nowView, t02, t07, t08 } from '../test-support/trip-now-fixtures';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

type Tree = { type: string; props: Record<string, any>; parent: Tree | null; children: unknown[]; queryAll: (p: (h: Tree) => boolean) => Tree[] };

const styleOf = (host: { props: Record<string, any> }) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
const byId = (id: string) => screen.getByTestId(id) as unknown as Tree;
const same = (a: unknown, b: string) => String(a).toUpperCase() === b.toUpperCase();
/** Text 하나의 글 (안쪽 Text까지) */
const textOf = (host: Tree): string =>
  host.children.map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : child && typeof child === 'object' ? textOf(child as Tree) : '')).join('');
const hasTextAbove = (host: Tree | null): boolean => host !== null && (host.type === 'Text' || hasTextAbove(host.parent));
/** 카드 안 바깥 Text를 순서대로 이어 붙인 글 */
const cardWords = (id: string) =>
  byId(id)
    .queryAll((inner) => inner.type === 'Text' && !(inner.parent && hasTextAbove(inner.parent)))
    .map(textOf)
    .join('');
/** 눌리는 바깥 상자 (testID가 붙은 곳 또는 그 안의 onClick 있는 곳) */
const pressableOf = (id: string): Tree => {
  const host = byId(id);
  const chain: Tree[] = [];
  for (let now: Tree | null = host; now; now = now.parent) chain.push(now);
  return chain.find((h) => typeof h.props.onClick === 'function') ?? host;
};

async function showCard(card: object, main = true) {
  await render(<NowCardView card={card as never} main={main} onOpenFailed={() => {}} />);
  return within(screen.getByTestId(`card-${(card as { type: string }).type}`));
}

// ---------- T-07 라벨 · 문장 (보드대로) ----------

describe('§24 T-07 라벨 · 문장은 보드대로', () => {
  test.each([true, false])('T15_S24_T_07_라벨은_고정_일정_·_곧_출발이고_옛_라벨_고정_일정이_곧이야는_없다 (main=%s)', async (main) => {
    const card = await showCard(t07(), main);
    expect(card.getByText('고정 일정 · 곧 출발')).toBeTruthy();
    expect(card.queryByText('고정 일정이 곧이야')).toBeNull();
  });

  test.each([
    [15, '14:40', '15분 뒤에 출발해'],
    [1, '18:42', '1분 뒤에 출발해'], // 경계: 남은 분 1
  ])('T15_S24_T_07_남은_분_%i이면_N분_뒤에_출발해와_출발_시각_줄', async (min, leaveBy, words) => {
    const card = await showCard(t07({ leave_in_min: min, leave_by: leaveBy }));
    expect(cardWords('card-T-07')).toContain(words);
    expect(card.getByText(`${leaveBy} 출발`)).toBeTruthy();
    expect(card.queryByText(`${leaveBy}까지 출발해야 해`)).toBeNull();
  });

  test('T15_S24_T_07_경계_남은_분_0이면_N분_뒤에_출발해가_없다(출발_시각_줄은_있다)', async () => {
    const card = await showCard(t07({ leave_in_min: 0 }));
    expect(cardWords('card-T-07')).not.toContain('분 뒤에 출발해');
    expect(card.getByText('14:40 출발')).toBeTruthy();
  });

  test('T15_S24_T_07_제목과_장소_이름이_서로_다른_줄', async () => {
    const card = await showCard(t07());
    const title = card.getByText('서버_예약_제목') as unknown as Tree;
    const place = card.getByText(/서버_식당_이름/) as unknown as Tree;
    expect(textOf(title)).not.toContain('서버_식당_이름');
    expect(textOf(place)).not.toContain('서버_예약_제목');
  });
});

// ---------- T-08 [숙소로 길 안내] 주 버튼 ----------

describe('§24 T-08 [숙소로 길 안내]는 주 버튼(52)', () => {
  test.each([true, false])('T15_S24_T_08_숙소로_길_안내는_주황_바탕_주_버튼 (main=%s)', async (main) => {
    await showCard(t08(), main);
    expect(same(styleOf(pressableOf('home-directions-button')).backgroundColor, COLORS.brand)).toBe(true);
  });

  test('T15_S24_T_08_숙소로_길_안내_높이는_주_버튼_52이고_보조_44가_아니다', async () => {
    await showCard(t08());
    const style = styleOf(pressableOf('home-directions-button'));
    const height = style.minHeight ?? style.height;
    expect(height).toBe(NUMBERS.btn);
    expect(height).not.toBe(NUMBERS['btn-sm']);
  });

  test('T15_S24_경계_T_02_길_안내는_그대로_보조(이번_고침은_T_08만)', async () => {
    await showCard(t02());
    expect(same(styleOf(pressableOf('directions-button')).backgroundColor, COLORS.brand)).toBe(false);
  });
});

describe('§24 T-08이 메인 카드일 때 화면에 주황 주 버튼 하나', () => {
  beforeEach(() => {
    resetDevice();
    mapControl.reset();
    sheetControl.reset();
    installConfig(TEST_KEY);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('T15_S24_T_08_메인이면_화면의_주황_바탕_눌리는_것은_숙소로_길_안내_하나', async () => {
    await toNow(nowServer(nowView({ main: t08(), subs: [] })));
    const root = screen.root as unknown as Tree;
    const orange = root.queryAll((host) => typeof host.props.onClick === 'function' && same(styleOf(host).backgroundColor, COLORS.brand));
    expect(orange).toHaveLength(1);
    expect(orange[0]).toBe(pressableOf('home-directions-button'));
  });
});
