/// <reference types="jest" />
// SC-04에서 시작 화면(S0)으로 나가는 길 (로직·가드레일). 근거: 승현 결정 (TASK-006 머지 전, 폰 확인 중. 문서 밖 요구라 PR에 기록)
// 1. 프로필 아바타 → 작은 시트 [처음부터 다시]·[닫기]
//    [처음부터 다시] = planning-flow의 clearStoredAndReset(null)과 같은 결과 (저장값 지움 + S0, 안내 없음)
// 2. GET /now가 404 resource=day면 저장값을 지우고 S0 (§11 Q22의 'oops'를 이 경우만 바꾼다). course 404·다른 404·500은 그대로
//
// 계약 (이 테스트가 정한 이름):
//   아바타: 역할 button, 접근성 이름 '프로필'. testID 'profile-avatar'는 그 버튼이거나 버튼 안에 있다
//   시트: testID 'profile-sheet'. 버튼 testID 'profile-restart'(글자 '처음부터 다시'), 'profile-close'(글자 '닫기')
import { screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { apiError } from '../test-support/fake-server';
import { mapControl } from '../test-support/maps-mock';
import { hasStoredSession, pressId, pressText, R, resetDevice, restart, storedValues, tap, toS9 } from '../test-support/planning-driver';
import { DAY_ID } from '../test-support/planning-fixtures';
import { ENTER, installConfig, nowServer, TEST_KEY, toNow, type NowControl } from '../test-support/trip-now-driver';
import { nowView } from '../test-support/trip-now-fixtures';

// trip-now.test.tsx와 같이 app.config가 만든 설정을 시험마다 끼운다
jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

type Tree = { type: string; props: Record<string, any>; parent: Tree | null; queryAll: (p: (h: Tree) => boolean) => Tree[] };

const styleOf = (host: { props: Record<string, any> }) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
const byId = (id: string) => screen.getByTestId(id) as unknown as Tree;

const S0_BUTTON = '데모 여행 시작';
const OOPS = '잠깐 문제가 생겼어';
const RESTART_NOTICE = '처음부터 다시 하자'; // 세션 404 때 S0에 뜨는 안내. 이번 경로들은 안내 없음 (course 404와 같음)
const dayGone = apiError(404, 'NOT_FOUND', { resource: 'day', day_id: DAY_ID });

const avatarButton = () => screen.getByRole('button', { name: '프로필' });
const openProfile = async () => {
  await tap(avatarButton());
  await screen.findByTestId('profile-sheet');
};
/** 이 날(day-2)을 가리키는 저장값 = 여행 중 기록·코스 날 */
const dayValues = () => storedValues().filter((value) => value.includes(DAY_ID));

async function expectS0WithoutNotice() {
  expect(await screen.findByText(S0_BUTTON)).toBeTruthy();
  expect(screen.queryByTestId('trip-now-screen')).toBeNull();
  expect(screen.queryByText(RESTART_NOTICE)).toBeNull();
  expect(screen.queryByText(OOPS)).toBeNull();
}

async function expectStorageCleared() {
  await waitFor(() => expect(hasStoredSession()).toBe(false));
  expect(dayValues()).toEqual([]);
}

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

// ---------- 1. 프로필 아바타 → 시트 ----------

describe('X1 프로필 아바타', () => {
  test('X1_아바타는_프로필이라는_이름의_버튼이고_profile_avatar가_그_안에_있다', async () => {
    await toNow();
    const button = avatarButton() as unknown as Tree;
    let now: Tree | null = byId('profile-avatar');
    let found = false;
    while (now) {
      if (now === button) found = true;
      now = now.parent;
    }
    expect(found).toBe(true);
    expect(screen.getAllByTestId('profile-avatar')).toHaveLength(1);
  });

  test('X1_아바타_누르는_영역은_44_이상', async () => {
    await toNow();
    const host = avatarButton() as unknown as Tree;
    const style = styleOf(host);
    const slop = host.props.hitSlop ?? {};
    const extra = (a: unknown, b: unknown) => (typeof slop === 'number' ? 2 * slop : Number(a ?? 0) + Number(b ?? 0));
    const side = (value: unknown, min: unknown) => Math.max(...[value, min].filter((v): v is number => typeof v === 'number'), 0);
    expect(side(style.height, style.minHeight) + extra(slop.top, slop.bottom)).toBeGreaterThanOrEqual(44);
    expect(side(style.width, style.minWidth) + extra(slop.left, slop.right)).toBeGreaterThanOrEqual(44);
  });

  test('X1_처음엔_시트가_없다', async () => {
    await toNow();
    expect(screen.queryByTestId('profile-sheet')).toBeNull();
  });

  test('X1_누르면_시트에_처음부터_다시와_닫기_두_버튼', async () => {
    await toNow();
    await openProfile();
    const sheet = within(screen.getByTestId('profile-sheet'));
    expect(sheet.getByTestId('profile-restart')).toBeTruthy();
    expect(sheet.getByText('처음부터 다시')).toBeTruthy();
    expect(sheet.getByTestId('profile-close')).toBeTruthy();
    expect(sheet.getByText('닫기')).toBeTruthy();
    expect(sheet.getAllByRole('button')).toHaveLength(2);
  });

  test('X1_시트를_열어도_서버_요청_없고_SC_04_그대로', async () => {
    const { control } = await toNow();
    const before = control.server.requests.length;
    await openProfile();
    expect(control.server.requests).toHaveLength(before);
    expect(screen.getByTestId('trip-now-screen')).toBeTruthy();
    expect(screen.getByTestId('now-main')).toBeTruthy();
  });

  test('X1_시트_버튼의_누르는_영역은_최소_높이_44', async () => {
    await toNow();
    await openProfile();
    for (const id of ['profile-restart', 'profile-close']) {
      const style = styleOf(byId(id));
      // 글자가 든 버튼은 고정 높이 대신 최소 높이 (TASK-006 D4와 같은 규칙)
      expect(style.height).toBeUndefined();
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  test('X1_시트_글자도_maxFontSizeMultiplier_1_3', async () => {
    await toNow();
    await openProfile();
    const texts = (byId('profile-sheet') as Tree).queryAll((host) => host.type === 'Text');
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.filter((host) => host.props.maxFontSizeMultiplier !== 1.3).map((host) => host.props.children)).toEqual([]);
  });
});

describe('X2 [닫기]', () => {
  test('X2_닫기면_시트만_닫히고_SC_04_그대로_서버_요청_없음', async () => {
    const { control } = await toNow();
    const before = control.server.requests.length;
    await openProfile();
    await pressId('profile-close');
    expect(screen.queryByTestId('profile-sheet')).toBeNull();
    expect(screen.getByTestId('trip-now-screen')).toBeTruthy();
    expect(screen.getByTestId('now-main')).toBeTruthy();
    expect(screen.getByTestId('card-T-01')).toBeTruthy();
    expect(control.server.requests).toHaveLength(before);
  });

  test('X2_닫기면_저장값이_그대로', async () => {
    await toNow();
    const saved = [...storedValues()].sort();
    expect(hasStoredSession()).toBe(true);
    expect(dayValues().length).toBeGreaterThan(0);
    await openProfile();
    await pressId('profile-close');
    expect([...storedValues()].sort()).toEqual(saved);
  });

  test('X2_닫은_뒤_다시_켜도_SC_04', async () => {
    const { app, control } = await toNow();
    await openProfile();
    await pressId('profile-close');
    const before = control.requests().length;
    await restart(app);
    await screen.findByTestId('trip-now-screen');
    await screen.findByTestId('now-main');
    expect(control.requests().length).toBeGreaterThan(before);
  });

  test('X2_닫은_뒤_다시_열_수_있다', async () => {
    await toNow();
    await openProfile();
    await pressId('profile-close');
    await openProfile();
    expect(screen.getByTestId('profile-restart')).toBeTruthy();
  });
});

describe('X3 [처음부터 다시]', () => {
  test('X3_누르면_S0이고_안내_없음', async () => {
    await toNow();
    await openProfile();
    await pressId('profile-restart');
    await expectS0WithoutNotice();
  });

  test('X3_누르면_계획_세션과_여행_중_기록이_지워진다', async () => {
    await toNow();
    expect(hasStoredSession()).toBe(true);
    expect(dayValues().length).toBeGreaterThan(0);
    await openProfile();
    await pressId('profile-restart');
    await screen.findByText(S0_BUTTON);
    await expectStorageCleared();
  });

  test('X3_누를_때_now를_다시_부르지_않는다', async () => {
    const { control } = await toNow();
    const before = control.requests().length;
    await openProfile();
    await pressId('profile-restart');
    await screen.findByText(S0_BUTTON);
    expect(control.requests()).toHaveLength(before);
  });

  test('X3_다시_켜도_S0이고_now를_부르지_않는다', async () => {
    const { app, control } = await toNow();
    await openProfile();
    await pressId('profile-restart');
    await screen.findByText(S0_BUTTON);
    const before = control.requests().length;
    await restart(app);
    await expectS0WithoutNotice();
    expect(control.requests()).toHaveLength(before);
  });

  test('X3_S0에서_데모_여행_시작으로_새로_시작할_수_있다', async () => {
    const { control } = await toNow();
    await openProfile();
    await pressId('profile-restart');
    await pressText(S0_BUTTON);
    await screen.findByTestId('choice-walk_alley');
    expect(control.server.sent(R.start).length).toBeGreaterThanOrEqual(2);
  });
});

// ---------- 2. GET /now 404 day → S0 ----------

describe('X4 /now 404 day', () => {
  /** 데모 +10분으로 다음 /now를 부르게 한다 */
  async function nextNow(control: NowControl) {
    const before = control.requests().length;
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(control.requests().length).toBeGreaterThan(before));
  }

  test('X4_보던_중_404_day면_S0이고_안내_없음', async () => {
    const control = nowServer();
    await toNow(control);
    control.reply(dayGone);
    await nextNow(control);
    await expectS0WithoutNotice();
  });

  test('X4_보던_중_404_day면_저장값이_지워진다', async () => {
    const control = nowServer();
    await toNow(control);
    control.reply(dayGone);
    await nextNow(control);
    await screen.findByText(S0_BUTTON);
    await expectStorageCleared();
  });

  test('X4_S9에서_들어갈_때_첫_요청이_404_day여도_S0', async () => {
    const control = nowServer();
    control.reply(dayGone);
    await toS9();
    await pressText(ENTER);
    await expectS0WithoutNotice();
    await expectStorageCleared();
  });

  test('X4_서버를_다시_켜서_날이_없으면_앱을_다시_켰을_때_S0', async () => {
    const { app, control } = await toNow();
    control.reply(dayGone);
    const before = control.requests().length;
    await restart(app);
    await waitFor(() => expect(control.requests().length).toBeGreaterThan(before));
    await expectS0WithoutNotice();
    await expectStorageCleared();
  });

  test('X4_404_day로_S0이_된_뒤_다시_켜도_S0이고_now를_부르지_않는다', async () => {
    const { app, control } = await toNow();
    control.reply(dayGone);
    await restart(app);
    await expectS0WithoutNotice();
    const before = control.requests().length;
    await restart(app);
    await expectS0WithoutNotice();
    expect(control.requests()).toHaveLength(before);
  });

  test('X4_detail에_day_id가_없어도_resource가_day면_S0', async () => {
    const control = nowServer();
    await toNow(control);
    control.reply(apiError(404, 'NOT_FOUND', { resource: 'day' }));
    await nextNow(control);
    await expectS0WithoutNotice();
  });

  // 경계: day만 바뀐다. 나머지는 그대로
  test.each([
    ['404 route', apiError(404, 'NOT_FOUND', { resource: 'route' })],
    ['404 resource 없음', apiError(404, 'NOT_FOUND', null)],
    ['500', apiError(500, 'INTERNAL_ERROR')],
    ['409 day 글자', apiError(409, 'CONFLICT', { resource: 'day' })],
  ])('X4_%s는_그대로_500_줄_마지막_화면_유지_저장값_유지', async (_name, reply) => {
    const control = nowServer();
    await toNow(control);
    control.once(reply);
    await nextNow(control);
    expect(await screen.findByText(OOPS)).toBeTruthy();
    expect(screen.getByTestId('trip-now-screen')).toBeTruthy();
    expect(screen.getByTestId('card-T-01')).toBeTruthy();
    expect(screen.getByTestId('retry-button')).toBeTruthy();
    expect(screen.queryByText(S0_BUTTON)).toBeNull();
    expect(dayValues().length).toBeGreaterThan(0);
    expect(hasStoredSession()).toBe(true);
  });

  test('X4_404_course는_그대로_코스_없음과_계획_다시_하기', async () => {
    const control = nowServer();
    await toNow(control);
    control.reply(apiError(404, 'NOT_FOUND', { resource: 'course' }));
    await nextNow(control);
    expect(await screen.findByText('고른 코스가 없어')).toBeTruthy();
    expect(screen.getByText('계획 다시 하기')).toBeTruthy();
    expect(screen.getByTestId('trip-now-screen')).toBeTruthy();
  });

  test('X4_200_응답은_SC_04_유지', async () => {
    const control = nowServer();
    await toNow(control);
    control.show(nowView({ status_text: '서버_다음_상태' }));
    await nextNow(control);
    expect(await screen.findByText('서버_다음_상태')).toBeTruthy();
    expect(screen.getByTestId('trip-now-screen')).toBeTruthy();
    expect(screen.queryByText(S0_BUTTON)).toBeNull();
  });
});
