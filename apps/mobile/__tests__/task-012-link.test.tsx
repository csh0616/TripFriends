/// <reference types="jest" />
// TASK-012 2단계 앱: 계정 연결 + §15 보안 규칙(S1 PKCE·S4 값 안 남김). 로직·가드레일만 본다 (색·간격은 design-tokens·리뷰 몫).
// 근거: TASK-012 §C C1·C2·C4·C5·C6·§6 "Google 연결 실패·취소"·§7 AC-5·AC-8·§8 "여행 삭제(보관만)"·§9 답 1~9,
//   ADR-016 §3-1(연결 규칙)·§3-2(권하는 때)·§3-3(앱은 Supabase를 로그인에만), docs/design/reviews/task-012-design.md §1(문구)·§4·§8,
//   DESIGN-001 §4-12, PM 안(결정권자 전달 11-11: linkIdentity + expo-web-browser + code 교환, redirect tripfriends://auth/callback,
//   이미 있는 계정은 그 계정으로 로그인 -> POST /account/claim, [연결 취소]는 서버 호출 없이 보관한 익명 세션으로).
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   Supabase·브라우저는 가짜 (test-support/supabase-mock: authFake·webBrowser, 실제 Google·Supabase·네트워크 0)
//   C2 연결: auth.linkIdentity({ provider: 'google', options: { redirectTo: REDIRECT, skipBrowserRedirect: true } }) -> 돌려받은 url로
//     WebBrowser.openAuthSessionAsync(url, REDIRECT) -> 돌아온 주소의 code로 auth.exchangeCodeForSession(code). 같은 user_id
//     돌아온 주소에 error_code=identity_already_exists면 C4: auth.signInWithOAuth(같은 options) -> 브라우저 -> code 교환 (그 계정 세션)
//     -> POST /account/claim (헤더 Bearer = 그 계정 토큰, 본문 { anonymous_token: 연결 전 익명 세션의 access token })
//        { result: 'moved' } -> 지금 여행을 다시 묻는다 / { result: 'choose', choices: [기기 칸, 계정 칸] } -> 어느 여행 시트
//        칸 = { origin: 'device'|'account', trip_id, name, start_date, end_date, planned_days, total_days } (API-001 §2-1)
//     [이걸로 할래] -> POST /account/claim/choose { anonymous_token, trip_id } -> 응답 Trip으로 날짜 목록
//   §9 3 [연결 취소]: 서버 호출 없이 연결 전 익명 세션으로 돌아간다 (새 익명 계정 만들지 않음). 알림 없음
//   §9 9 실패: role="alert" 한 줄 "연결하지 못했어. 지금 여행은 그대로야", 6초 뒤 사라짐·누르면 닫힘, 저장 권유 시트 닫힘.
//     §16 Q7 브라우저 취소면 알림 없고 저장 권유 시트 그대로 · 스크림 = [나중에] · 실제 여행에서 코스를 고른 그 순간에만(데모 뒤 없음, 이미 계획한 여행을 열 때 없음)
//   §16 Q6 기기에 익명 세션 전체를 보관, claim·choose 직전 만료 60초 안이면 먼저 갱신, moved·choose 성공 뒤 보관본을 지운다
//   §16 Q13 claim 실패(409 포함): 계정 세션 로그아웃 -> 보관한 익명 세션으로 -> 실패 알림
//   §16 Q8·§17 2 실제 여행 [처음부터 다시] -> ①-28 확인 -> [새로 만들기] -> 여행 만들기 화면으로만 (새 API 없음, 보관은 POST /trips 때)
//   §9 4 날짜 목록 머리 왼쪽 아바타: 역할 button, 접근성 이름 '내 프로필' (지도 위 아바타는 기존 '프로필' 그대로)
//   문구는 모두 리뷰 파일 §1·§8 그대로. 화면 이름(testID)은 정하지 않고 글자·역할로 찾는다
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { apiError, FakeServer, json, networkDown, type Sent } from '../test-support/fake-server';
import { happyServer, resetDevice, storedValues, tap } from '../test-support/planning-driver';
import { course, SID } from '../test-support/planning-fixtures';
import { treeIndex, type Host } from '../test-support/screen-tree';
import { authFake, EXISTING_USER_ID } from '../test-support/supabase-mock';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: null } };
});

const METRICS = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };
const NOW_ISO = '2026-12-02T03:00:00Z';
const REDIRECT = 'tripfriends://auth/callback';
const CURRENT = 'GET /trips/current';
const CLAIM = 'POST /account/claim';
const CHOOSE = 'POST /account/claim/choose';
const NO_TRIP = apiError(404, 'NOT_FOUND', { resource: 'trip' });

// 리뷰 파일 §1·§8 문구
const SAVE = { title: '저장해 둘래?', body: '앱을 지우면 사라져', note: 'Google 계정에 이어 두면 다른 폰에서도 볼 수 있어', google: 'Google 계정으로 계속', later: '나중에' };
const PICK = {
  title: '어느 여행을 쓸까?',
  body: 'se***@gmail.com 계정에 이미 여행이 있어. 고르지 않은 여행은 지우지 않고 보관해 둘게',
  device: '이 폰에서 만든 여행',
  account: 'Google 계정에 있던 여행',
  confirm: '이걸로 할래',
  cancel: '연결 취소',
};
const MENU = {
  anon: '저장 안 됨',
  anonLine: '이 폰에만 있어. 앱을 지우면 사라져',
  linked: 'Google 계정에 저장됨',
  email: 'se***@gmail.com',
  linkedNote: '로그아웃해도 여행은 계정에 남아 있어',
  save: '저장하기',
  restart: '처음부터 다시',
  close: '닫기',
  logout: '로그아웃',
};
const FAILED = '연결하지 못했어. 지금 여행은 그대로야';
const RESTART_CONFIRM = { title: '지금 여행은 보관돼. 새로 만들까?', note: '보관한 여행은 지금은 다시 열 수 없어', yes: '새로 만들기', keep: '그대로 둘게' };

const day = (n: number, date: string, chosen: boolean) => ({
  day_id: `day-t${n}`,
  date,
  state: chosen ? 'planned' : 'planning',
  chosen_option_id: chosen ? `opt-chosen-${n}` : null,
  fixed_events: [],
  summary: chosen ? { end_time: '18:30', place_count: 3, move_min: 40 } : null,
  must_visits: [],
});
const DATES = ['2026-12-11', '2026-12-12', '2026-12-13'];
const tripWith = (planned: number[]) => ({
  trip_id: 'trip-osaka-1',
  city_code: 'osaka',
  start_date: DATES[0],
  end_date: DATES[2],
  lodging_place_id: null,
  status: 'active',
  is_demo: false,
  trip_days: DATES.map((date, i) => day(i + 1, date, planned.includes(i + 1))),
});
const TRIP = tripWith([]);
const TRIP_PLANNED = tripWith([1]);
const ACCOUNT_DATES = ['2027-01-08', '2027-01-09', '2027-01-10', '2027-01-11'];
const ACCOUNT_TRIP = {
  ...TRIP,
  trip_id: 'trip-account-1',
  start_date: ACCOUNT_DATES[0],
  end_date: ACCOUNT_DATES[3],
  trip_days: ACCOUNT_DATES.map((date, i) => ({ ...day(i + 1, date, i < 3), day_id: `day-a${i + 1}` })),
};
const CHOICES = {
  result: 'choose',
  choices: [
    { origin: 'device', trip_id: TRIP_PLANNED.trip_id, name: '오사카 2박 3일', start_date: DATES[0], end_date: DATES[2], planned_days: 1, total_days: 3 },
    { origin: 'account', trip_id: ACCOUNT_TRIP.trip_id, name: '오사카 3박 4일', start_date: ACCOUNT_DATES[0], end_date: ACCOUNT_DATES[3], planned_days: 3, total_days: 4 },
  ],
};

let server: FakeServer;
const realDev = (globalThis as { __DEV__?: boolean }).__DEV__;

function startHome() {
  const Index = require('@/app/index').default;
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <Index />
    </SafeAreaProvider>,
  );
}

const TIMERS_KEPT = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate'] as const;
function freezeDate(iso: string, fakeTimeouts = false) {
  jest.useFakeTimers({
    now: Date.parse(iso),
    doNotFake: fakeTimeouts ? [...TIMERS_KEPT] : [...TIMERS_KEPT, 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
}

const settleAll = async () => {
  await act(async () => {
    await new Promise<void>((done) => setImmediate(done));
  });
};

const session = () => authFake.session();
const bearerOf = (sent: Sent) => server.headers(sent).authorization;
const accountPaths = () => server.requests.filter((r) => r.path.startsWith('/account'));
/** C6·§8: 어떤 흐름에서도 앱은 여행을 지우지 않는다 (지울 수 있는 것은 고정 일정뿐) */
const expectNoTripDeletion = () => expect(server.requests.filter((r) => r.method === 'DELETE' && !r.path.startsWith('/fixed-events/'))).toEqual([]);

const isDisabled = (element: unknown): boolean => {
  let host = element as Host | null;
  while (host) {
    if (host.props.accessibilityState?.disabled === true || host.props['aria-disabled'] === true || host.props.disabled === true) return true;
    host = (host as unknown as { parent: Host | null }).parent;
  }
  return false;
};

/** 날짜 목록까지 (지금 여행이 trip) */
async function toList(trip: object = TRIP_PLANNED) {
  server.on(CURRENT, json(200, trip));
  await startHome();
  await screen.findByTestId('day-row-day-t1');
}

/** 그날 [알아서 짜 줘] -> 코스안 -> [이걸로 할래] -> S9 -> [날짜 목록으로] (TASK-011 §9 Q3, TASK-003 §5) */
async function planDay(n: number, after: object) {
  server
    .on(`POST /days/day-t${n}/planning`, json(201, course()))
    .on(`GET /planning/${SID}`, json(200, course()))
    .on('POST /course-options/opt-relaxed/select', json(200, { day_id: `day-t${n}`, option_id: 'opt-relaxed' }));
  await tap(await screen.findByTestId(`card-auto-day-t${n}`));
  await screen.findByTestId('option-relaxed');
  server.on(CURRENT, json(200, after));
  await tap(screen.getByText('이걸로 할래'));
  await tap(await screen.findByTestId('s9-close'));
  await screen.findByTestId('day-row-day-t1');
  await settleAll();
}

/** 계획 전 여행으로 시작 -> 첫날 첫 계획 -> 날짜 목록 + 저장 권유 시트 */
async function toSaveSheet() {
  server.on(CURRENT, json(200, TRIP));
  await startHome();
  await screen.findByTestId('day-row-day-t1');
  await planDay(1, TRIP_PLANNED);
  await screen.findByText(SAVE.title);
}

async function openMenu() {
  await tap(screen.getByRole('button', { name: '내 프로필' }));
  await screen.findByText(MENU.close);
}

/** 프로필 메뉴 [저장하기] -> 저장 권유 시트 (§9 2) */
async function toSaveSheetFromMenu(trip: object = TRIP_PLANNED) {
  await toList(trip);
  await openMenu();
  await tap(screen.getByText(MENU.save));
  await screen.findByText(SAVE.title);
}

const pressGoogle = async () => {
  await tap(screen.getByText(SAVE.google));
  await settleAll();
};

beforeEach(() => {
  resetDevice();
  freezeDate(NOW_ISO);
  server = new FakeServer();
});

afterEach(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = realDev;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------- C1 저장 권유 (첫 계획 뒤 한 번, [나중에] 뒤엔 자동으로 다시 묻지 않음) ----------

describe('C1 저장 권유 시트', () => {
  test('T12_C1_첫_계획을_마치고_날짜_목록으로_오면_저장_권유_시트가_뜬다', async () => {
    await toSaveSheet();
    for (const line of [SAVE.title, SAVE.body, SAVE.note, SAVE.google, SAVE.later]) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByTestId('day-row-day-t1')).toBeTruthy(); // 날짜 목록 위에 (①-22 바탕 = 첫 계획 직후 날짜 목록)
  });

  test('T12_C1_코스를_고르기_전_날짜_목록에는_시트가_없다', async () => {
    await toList(TRIP);
    await settleAll();
    expect(screen.queryByText(SAVE.title)).toBeNull();
  });

  test('T12_C1_나중에를_누르면_닫히고_앱을_다시_켜도_다시_묻지_않는다', async () => {
    await toSaveSheet();
    await tap(screen.getByText(SAVE.later));
    expect(screen.queryByText(SAVE.title)).toBeNull();
    expect(accountPaths()).toEqual([]);
    expect(authFake.linkCalls()).toEqual([]);
    screen.unmount();
    await startHome();
    await screen.findByTestId('day-row-day-t1');
    await settleAll();
    expect(screen.queryByText(SAVE.title)).toBeNull();
  });

  test('T12_C1_나중에_뒤_다른_날을_계획해도_다시_묻지_않는다', async () => {
    await toSaveSheet();
    await tap(screen.getByText(SAVE.later));
    await planDay(2, tripWith([1, 2]));
    expect(screen.queryByText(SAVE.title)).toBeNull();
  });

  test('T12_S16_Q7_이미_계획을_마친_여행을_열면_자동으로_띄우지_않는다', async () => {
    await toList(TRIP_PLANNED); // 처음 연 기기, 묻지 않았음
    await settleAll();
    expect(screen.queryByText(SAVE.title)).toBeNull();
  });

  test('T12_S16_Q7_스크림을_누르면_나중에와_같다', async () => {
    await toSaveSheet();
    const scrim = screen
      .getAllByRole('button', { name: SAVE.later })
      .find((host) => (host as unknown as Host).queryAll((child) => child.type === 'Text').length === 0);
    expect(scrim).toBeDefined();
    await tap(scrim!);
    expect(screen.queryByText(SAVE.title)).toBeNull();
    screen.unmount();
    await startHome();
    await screen.findByTestId('day-row-day-t1');
    await settleAll();
    expect(screen.queryByText(SAVE.title)).toBeNull();
    expect(authFake.linkCalls()).toEqual([]);
  });

  test('T12_S16_Q7_데모에서_코스를_골라도_시트가_없다', async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    server = happyServer().on(CURRENT, NO_TRIP);
    await startHome();
    await tap(await screen.findByTestId('home-demo'));
    await tap(await screen.findByText('아무거나 찾아 줘'));
    await screen.findByTestId('candidate-card-D01');
    await tap(screen.getByTestId('compose-button'));
    await screen.findByText('코스 짜 봤어');
    await tap(screen.getByText('이걸로 할래'));
    await screen.findByText('코스 저장했어'); // 데모 S9 = 코스를 고른 그 순간 (데모라 시트 없음)
    await settleAll();
    expect(screen.queryByText(SAVE.title)).toBeNull();
    await tap(screen.getByText('처음부터'));
    await settleAll();
    expect(screen.queryByText(SAVE.title)).toBeNull();
  });

  test('T12_C1_이미_Google에_연결된_기기는_첫_계획_뒤에도_시트가_없다', async () => {
    await authFake.keepSession({ email: 'seunghyun@gmail.com' });
    server.on(CURRENT, json(200, TRIP));
    await startHome();
    await screen.findByTestId('day-row-day-t1');
    await planDay(1, TRIP_PLANNED);
    expect(screen.queryByText(SAVE.title)).toBeNull();
  });
});

// ---------- C2 Google 연결 = 같은 user_id (새 계정) ----------

describe('C2 새 Google 계정에 연결', () => {
  test('T12_C2_Google_계정으로_계속을_누르면_linkIdentity·앱_안_브라우저·code_교환으로_같은_user_id', async () => {
    await toSaveSheet();
    const before = await session();
    await pressGoogle();
    await waitFor(async () => expect((await session())?.user.is_anonymous).toBe(false));

    expect(authFake.linkCalls()).toEqual([{ provider: 'google', options: expect.objectContaining({ redirectTo: REDIRECT, skipBrowserRedirect: true }) }]);
    const [opened] = authFake.browserCalls();
    expect(opened.redirectUrl).toBe(REDIRECT);
    expect(opened.url).toContain('flow=link'); // linkIdentity가 돌려준 주소 그대로
    expect(authFake.exchangeCalls()).toHaveLength(1);
    const after = await session();
    expect(after?.user.id).toBe(before?.user.id); // ADR-016 §3-1: 같은 사용자 ID
    expect(after?.user.email).toBe('seunghyun@gmail.com');
    expect(authFake.signIns()).toBe(1); // 처음 익명 로그인 한 번뿐
    expect(accountPaths()).toEqual([]); // 같은 사용자라 서버에 옮길 것이 없다
    expect(screen.queryByText(SAVE.title)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.getByTestId('day-row-day-t1')).toBeTruthy();
    expectNoTripDeletion();
  });

  test('T12_C2_C5_연결_뒤_프로필은_Google_계정에_저장됨·이메일_일부·로그아웃', async () => {
    await toSaveSheet();
    await pressGoogle();
    await waitFor(async () => expect((await session())?.user.is_anonymous).toBe(false));
    await openMenu();
    for (const line of [MENU.linked, MENU.email, MENU.linkedNote, MENU.logout, MENU.restart, MENU.close]) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.queryByText(MENU.save)).toBeNull();
    expect(screen.queryByText('seunghyun@gmail.com')).toBeNull(); // 이메일 일부만 (C5)
  });

  test.each([['cancel'], ['dismiss']] as const)('T12_S6_Q9_S16_Q7_브라우저를_닫으면(%s)_알림_없이_시트·익명·여행_그대로', async (step) => {
    authFake.browser(step);
    await toSaveSheet();
    const before = await session();
    await pressGoogle();
    await settleAll();
    expect(authFake.browserCalls()).toHaveLength(1);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(SAVE.title)).toBeTruthy(); // §16 Q7: 취소면 시트 그대로 (다시 누르거나 [나중에])
    expect((await session())?.user).toEqual(before?.user);
    expect(authFake.exchangeCalls()).toEqual([]);
    expect(accountPaths()).toEqual([]);
    expect(screen.getByTestId('day-row-day-t1')).toBeTruthy();
  });

  test.each([
    ['연결_주소를_못_받음', () => authFake.failLink(1)],
    ['공급자_오류로_돌아옴', () => authFake.browser('error')],
    ['code_교환_실패', () => authFake.failExchange(1)],
  ])('T12_S6_Q9_연결이_실패하면(%s)_한_줄_알림·저장_권유_시트_닫힘·익명·여행_그대로', async (_name, arrange) => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    arrange();
    await toSaveSheet();
    const before = await session();
    await pressGoogle();
    const alert = await screen.findByRole('alert');
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(alert).toBeTruthy();
    expect(screen.queryByText(SAVE.title)).toBeNull(); // 실패하면 시트는 닫히고 알림만 (§9 확정)
    const after = await session();
    expect(after?.user.id).toBe(before?.user.id);
    expect(after?.user.is_anonymous).toBe(true);
    expect(authFake.signIns()).toBe(1); // 새 익명 계정 없음
    expect(accountPaths()).toEqual([]);
    expect(server.sent('POST /trips')).toEqual([]);
    expect(screen.getByTestId('day-row-day-t1')).toBeTruthy(); // 시작한 화면(날짜 목록) 위
    expectNoTripDeletion();
  });

  test('T12_Q9_실패_알림은_6초_뒤_사라진다_5999ms엔_남아_있다', async () => {
    jest.useRealTimers();
    freezeDate(NOW_ISO, true);
    authFake.failLink(1);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await toSaveSheet();
    await pressGoogle();
    await screen.findByText(FAILED);
    await act(async () => {
      jest.advanceTimersByTime(5999);
    });
    expect(screen.getByText(FAILED)).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  test('T12_Q9_실패_알림을_누르면_바로_닫힌다', async () => {
    authFake.failLink(1);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await toSaveSheet();
    await pressGoogle();
    await tap(await screen.findByText(FAILED));
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  test('T12_Q9_실패_뒤_아바타_저장하기로_다시_하면_연결된다', async () => {
    authFake.failLink(1);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await toSaveSheet();
    await pressGoogle();
    await screen.findByText(FAILED);
    await openMenu();
    await tap(screen.getByText(MENU.save));
    await screen.findByText(SAVE.title);
    await pressGoogle();
    await waitFor(async () => expect((await session())?.user.is_anonymous).toBe(false));
    expect(authFake.linkCalls()).toHaveLength(2);
  });
});

// ---------- C4 이미 있는 계정 ----------

describe('C4 이미 있는 Google 계정', () => {
  beforeEach(() => authFake.googleAccount({ existing: true }));

  test('T12_C4_이미_있는_계정이면_그_계정으로_로그인하고_claim에_익명_토큰을_싣는다·계정에_여행이_없으면_옮긴_여행', async () => {
    server.on(CLAIM, json(200, { result: 'moved' }));
    await toSaveSheetFromMenu();
    const anon = await session();
    await pressGoogle();
    await waitFor(() => expect(server.sent(CLAIM)).toHaveLength(1));

    expect(authFake.oauthCalls()).toEqual([{ provider: 'google', options: expect.objectContaining({ redirectTo: REDIRECT, skipBrowserRedirect: true }) }]);
    expect(authFake.browserCalls().map((call) => call.redirectUrl)).toEqual([REDIRECT, REDIRECT]);
    const account = await session();
    expect(account?.user.id).toBe(EXISTING_USER_ID);
    const [sent] = server.sent(CLAIM);
    expect(bearerOf(sent)).toBe(`Bearer ${account?.access_token}`);
    expect(sent.body).toEqual({ anonymous_token: anon?.access_token });
    // 옮긴 뒤 지금 여행을 그 계정 토큰으로 다시 묻는다. 어느 여행 시트는 없다
    await waitFor(() => expect(server.sent(CURRENT).some((one) => bearerOf(one) === `Bearer ${account?.access_token}`)).toBe(true));
    expect(screen.queryByText(PICK.title)).toBeNull();
    expect(await screen.findByTestId('day-row-day-t1')).toBeTruthy();
    expectNoTripDeletion();
  });

  test('T12_C4_Q6_두_쪽_다_여행이면_어느_여행_시트_한_번·칸에_이름·날짜·진행·고르기_전_비활성', async () => {
    server.on(CLAIM, json(200, CHOICES));
    await toSaveSheetFromMenu();
    await pressGoogle();
    await screen.findByText(PICK.title);
    for (const line of [PICK.body, PICK.device, PICK.account, '오사카 2박 3일', '오사카 3박 4일', PICK.confirm, PICK.cancel]) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getByText('12월 11일 ~ 13일 · 3일 중 1일 계획 완료')).toBeTruthy();
    expect(screen.getByText('1월 8일 ~ 11일 · 4일 중 3일 계획 완료')).toBeTruthy();
    expect(isDisabled(screen.getByRole('button', { name: PICK.confirm }))).toBe(true); // 기본으로 고른 칸 없음 (리뷰 §4)
    expect(server.sent(CHOOSE)).toEqual([]);
  });

  test.each([
    ['기기_여행', PICK.device, TRIP_PLANNED, '오사카 2박 3일'],
    ['계정_여행', PICK.account, ACCOUNT_TRIP, '오사카 3박 4일'],
  ])('T12_C4_%s을_고르고_이걸로_할래면_choose에_그_여행·응답_여행의_날짜_목록', async (_name, cell, chosen, title) => {
    server.on(CLAIM, json(200, CHOICES)).on(CHOOSE, json(200, chosen));
    await toSaveSheetFromMenu();
    const anon = await session();
    await pressGoogle();
    await screen.findByText(PICK.title);
    await tap(screen.getByText(cell));
    expect(isDisabled(screen.getByRole('button', { name: PICK.confirm }))).toBe(false);
    await tap(screen.getByRole('button', { name: PICK.confirm }));
    await waitFor(() => expect(server.sent(CHOOSE)).toHaveLength(1));
    const [sent] = server.sent(CHOOSE);
    expect(sent.body).toEqual({ anonymous_token: anon?.access_token, trip_id: chosen.trip_id });
    expect(bearerOf(sent)).toBe(`Bearer ${(await session())?.access_token}`);
    await waitFor(() => expect(screen.queryByText(PICK.title)).toBeNull());
    expect(await screen.findByText(title)).toBeTruthy();
    expectNoTripDeletion();
  });

  test('T12_S9_3_연결_취소면_서버_호출_없이_연결_전_익명_세션으로·두_여행_그대로·알림_없음', async () => {
    server.on(CLAIM, json(200, CHOICES));
    await toSaveSheetFromMenu();
    const anon = await session();
    await pressGoogle();
    await screen.findByText(PICK.title);
    await tap(screen.getByText(PICK.cancel));
    await waitFor(() => expect(screen.queryByText(PICK.title)).toBeNull());
    await settleAll();
    const back = await session();
    expect(back?.user).toEqual(anon?.user); // 같은 익명 사용자 (§9 3: 보관한 세션으로 되돌림)
    expect(authFake.signIns()).toBe(1); // 새 익명 계정을 만들지 않았다
    expect(server.sent(CHOOSE)).toEqual([]);
    expect(server.sent(CLAIM)).toHaveLength(1); // 요약을 받은 한 번뿐 (바꾸는 호출 없음)
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('day-row-day-t1')).toBeTruthy();
    expectNoTripDeletion();
  });

  test('T12_S9_3_연결_취소_뒤_요청은_익명_토큰으로_간다', async () => {
    server.on(CLAIM, json(200, CHOICES));
    await toSaveSheetFromMenu();
    await pressGoogle();
    await screen.findByText(PICK.title);
    await tap(screen.getByText(PICK.cancel));
    await waitFor(() => expect(screen.queryByText(PICK.title)).toBeNull());
    screen.unmount();
    await startHome();
    await screen.findByTestId('day-row-day-t1');
    const last = server.sent(CURRENT).at(-1)!;
    expect(bearerOf(last)).toBe(`Bearer ${(await session())?.access_token}`);
    expect((await session())?.user.is_anonymous).toBe(true);
  });

  test.each([
    ['서버_500', apiError(500, 'INTERNAL_ERROR')],
    ['저장소_503', apiError(503, 'STORAGE_UNAVAILABLE')],
    ['네트워크', networkDown],
    ['이미_처리됨_409', apiError(409, 'ALREADY_CLAIMED')],
  ])('T12_S6_S16_Q13_claim이_실패하면(%s)_계정_로그아웃·익명으로_돌아가고_한_줄_알림', async (_name, reply) => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    server.on(CLAIM, reply);
    await toSaveSheetFromMenu();
    const anon = await session();
    await pressGoogle();
    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect((await session())?.user).toEqual(anon?.user);
    expect(authFake.signOuts()).toBeGreaterThanOrEqual(1); // 계정 세션을 로그아웃
    expect(authFake.signIns()).toBe(1);
    expect(server.sent(CHOOSE)).toEqual([]);
    expect(screen.getByTestId('day-row-day-t1')).toBeTruthy();
  });

  test('T12_S6_C4_그_계정_로그인을_브라우저에서_닫으면_알림_없이_익명', async () => {
    authFake.browser('pick', 'cancel'); // 연결 시도 -> 이미 있는 계정 -> 그 계정 로그인 창을 닫음
    await toSaveSheetFromMenu();
    const anon = await session();
    await pressGoogle();
    await settleAll();
    await waitFor(() => expect(authFake.browserCalls()).toHaveLength(2));
    await settleAll();
    expect((await session())?.user).toEqual(anon?.user);
    expect(accountPaths()).toEqual([]);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.getByText(SAVE.title)).toBeTruthy(); // §16 Q7
  });

  test('T12_S16_Q6_moved_뒤에는_기기에_보관한_익명_세션을_지운다', async () => {
    server.on(CLAIM, json(200, { result: 'moved' }));
    await toSaveSheetFromMenu();
    const anon = await session();
    await pressGoogle();
    await waitFor(() => expect(server.sent(CLAIM)).toHaveLength(1));
    await screen.findByTestId('day-row-day-t1');
    await settleAll();
    expect(storedValues().filter((value) => value.includes(anon!.refresh_token))).toEqual([]);
  });

  test('T12_S16_Q6_choose_성공_뒤에는_기기에_보관한_익명_세션을_지운다', async () => {
    server.on(CLAIM, json(200, CHOICES)).on(CHOOSE, json(200, TRIP_PLANNED));
    await toSaveSheetFromMenu();
    const anon = await session();
    await pressGoogle();
    await screen.findByText(PICK.title);
    await tap(screen.getByText(PICK.device));
    await tap(screen.getByRole('button', { name: PICK.confirm }));
    await waitFor(() => expect(server.sent(CHOOSE)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(PICK.title)).toBeNull());
    await settleAll();
    expect(storedValues().filter((value) => value.includes(anon!.refresh_token))).toEqual([]);
  });

  test.each([
    ['59초_뒤_만료면_먼저_갱신', 59, true],
    ['61초_뒤_만료면_그대로', 61, false],
  ])('T12_S16_Q6_claim_직전_익명_토큰이_%s', async (_name, seconds, renewed) => {
    const kept = await authFake.keepSession({ expiresIn: seconds });
    server.on(CLAIM, json(200, { result: 'moved' }));
    await toSaveSheetFromMenu();
    await pressGoogle();
    await waitFor(() => expect(server.sent(CLAIM)).toHaveLength(1));
    const sentToken = (server.sent(CLAIM)[0].body as { anonymous_token?: string }).anonymous_token;
    expect(authFake.userOfAccess(sentToken)?.id).toBe(kept.user.id); // 늘 익명 사용자의 토큰
    if (renewed) expect(sentToken).not.toBe(kept.access_token);
    else expect(sentToken).toBe(kept.access_token);
  });
});

// ---------- C5 프로필 메뉴 · §9 4 머리 아바타 · §9 5 처음부터 다시 ----------

describe('C5 프로필 메뉴', () => {
  test('T12_S9_4_날짜_목록_머리_왼쪽에_내_프로필_아바타·SOS보다_앞', async () => {
    await toList();
    const avatar = screen.getByRole('button', { name: '내 프로필' }) as unknown as Host;
    const sos = screen.getByTestId('sos-button') as unknown as Host;
    expect(treeIndex(avatar)).toBeLessThan(treeIndex(sos));
    expect(screen.getAllByRole('button', { name: '내 프로필' })).toHaveLength(1);
  });

  test('T12_S9_4_계획_대화·코스안_머리엔_아바타가_없다', async () => {
    await toList(TRIP);
    server.on('POST /days/day-t1/planning', json(201, course())).on(`GET /planning/${SID}`, json(200, course()));
    await tap(screen.getByTestId('card-auto-day-t1'));
    await screen.findByTestId('option-relaxed');
    expect(screen.queryByRole('button', { name: '내 프로필' })).toBeNull();
  });

  test('T12_C5_C6_익명이면_저장_안_됨·저장하기·처음부터_다시·닫기_로그아웃은_없다', async () => {
    await toList();
    await openMenu();
    for (const line of [MENU.anon, MENU.anonLine, MENU.save, MENU.restart, MENU.close]) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.queryByText(MENU.logout)).toBeNull(); // C6: 연결 전 로그아웃 없음
    expect(screen.queryByText(SAVE.google)).toBeNull(); // §9 2: Google 버튼은 저장 권유 시트 안에만
  });

  test('T12_S9_2_저장하기를_누르면_저장_권유_시트가_올라온다', async () => {
    await toSaveSheetFromMenu();
    for (const line of [SAVE.title, SAVE.body, SAVE.google, SAVE.later]) expect(screen.getByText(line)).toBeTruthy();
    expect(authFake.linkCalls()).toEqual([]); // 누르기 전엔 연결을 시작하지 않는다
  });

  test('T12_C5_닫기는_메뉴만_닫고_서버_요청이_없다', async () => {
    await toList();
    const before = server.requests.length;
    await openMenu();
    await tap(screen.getByText(MENU.close));
    expect(screen.queryByText(MENU.anon)).toBeNull();
    expect(server.requests).toHaveLength(before);
  });

  test('T12_C5_연결됐으면_로그아웃은_새_익명_계정으로·여행을_지우는_요청_없음', async () => {
    const linked = await authFake.keepSession({ email: 'seunghyun@gmail.com' });
    server.once(CURRENT, json(200, TRIP_PLANNED)).on(CURRENT, NO_TRIP);
    await startHome();
    await screen.findByTestId('day-row-day-t1');
    await openMenu();
    expect(screen.getByText(MENU.email)).toBeTruthy();
    await tap(screen.getByText(MENU.logout));
    await waitFor(() => expect(authFake.signOuts()).toBe(1));
    await waitFor(async () => expect((await session())?.user.is_anonymous).toBe(true));
    const fresh = await session();
    expect(fresh?.user.id).not.toBe(linked.user.id);
    expect(authFake.signIns()).toBe(1);
    await waitFor(() => expect(bearerOf(server.sent(CURRENT).at(-1)!)).toBe(`Bearer ${fresh?.access_token}`));
    expect(await screen.findByText('여행 만들기')).toBeTruthy(); // 새 익명 계정에는 여행이 없다 (여행은 계정에 남음)
    expectNoTripDeletion();
    expect(server.sent('POST /trips')).toEqual([]);
  });

  test('T12_S9_5_실제_여행에서_처음부터_다시는_새_여행_확인과_같은_시트', async () => {
    await toList();
    await openMenu();
    await tap(screen.getByText(MENU.restart));
    for (const line of Object.values(RESTART_CONFIRM)) expect(await screen.findByText(line)).toBeTruthy();
  });

  test('T12_S9_5_확인에서_그대로_둘게면_날짜_목록_그대로_서버_요청_없음', async () => {
    await toList();
    const before = server.requests.length;
    await openMenu();
    await tap(screen.getByText(MENU.restart));
    await tap(await screen.findByText(RESTART_CONFIRM.keep));
    expect(screen.queryByText(RESTART_CONFIRM.title)).toBeNull();
    expect(screen.getByTestId('day-row-day-t1')).toBeTruthy();
    expect(server.requests).toHaveLength(before);
  });

  test('T12_S9_5_S17_2_확인에서_새로_만들기면_여행_만들기_화면으로만·서버를_바꾸는_요청_없음', async () => {
    await toList();
    await openMenu();
    await tap(screen.getByText(MENU.restart));
    const before = server.requests.length;
    await tap(await screen.findByText(RESTART_CONFIRM.yes));
    expect(await screen.findByTestId('create-trip-submit')).toBeTruthy();
    expect(screen.queryByTestId('day-row-day-t1')).toBeNull();
    // §17 2: 새 API 없음. 보관은 새 여행을 만들 때(POST /trips). 그 전에는 서버를 바꾸는 요청이 없다
    expect(server.requests.slice(before).filter((r) => r.method !== 'GET')).toEqual([]);
    expectNoTripDeletion();
  });

  test('T12_S17_2_여행_만들기를_그만두면_이전_여행이_지금_여행으로_남는다', async () => {
    await toList();
    await openMenu();
    await tap(screen.getByText(MENU.restart));
    await tap(await screen.findByText(RESTART_CONFIRM.yes));
    await screen.findByTestId('create-trip-submit');
    await tap(screen.getByTestId('header-back'));
    expect(await screen.findByTestId('day-row-day-t1')).toBeTruthy();
    expect(server.sent('POST /trips')).toEqual([]);
  });
});

// ---------- C6 규칙 3 · 버튼 문구 ----------

describe('C6 · §9 1', () => {
  test('T12_S9_1_Google_버튼_글자는_승인_문구_하나뿐·Google만_쓴_버튼이_없다', async () => {
    await toSaveSheet();
    expect(screen.getAllByText(SAVE.google)).toHaveLength(1);
    expect(screen.queryByText('Google로 저장')).toBeNull();
    expect(screen.queryByText(/^Google$/)).toBeNull();
  });
});

// ---------- TASK-012 §15 2단계 보안 규칙 ----------

describe('§15 보안', () => {
  /** console에 나간 모든 글자 (개발 경고 포함) */
  function captureConsole() {
    const said: string[] = [];
    for (const name of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      jest.spyOn(console, name).mockImplementation((...args: unknown[]) => {
        said.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg) ?? String(arg))).join(' '));
      });
    }
    return said;
  }

  test.each([
    ['코드_교환_실패', () => authFake.failExchange(1), null],
    ['공급자_오류', () => authFake.browser('error'), null],
    ['claim_500', () => authFake.googleAccount({ existing: true }), apiError(500, 'INTERNAL_ERROR')],
  ] as const)('T12_S15_S4_연결이_실패해도(%s)_토큰·code·이메일을_console에_남기지_않는다', async (_name, arrange, claimReply) => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true; // 개발 경고가 켜진 상태에서도 값이 없어야 한다
    const said = captureConsole();
    arrange();
    if (claimReply) server.on(CLAIM, claimReply);
    await toSaveSheetFromMenu();
    const anon = await session();
    await pressGoogle();
    await screen.findByText(FAILED);
    const secrets = [anon?.access_token, anon?.refresh_token, 'fake-code-', 'fake-access-', 'fake-refresh-', 'seunghyun@gmail.com'].filter(Boolean) as string[];
    expect(said.filter((line) => secrets.some((secret) => line.includes(secret)))).toEqual([]);
  });

  test('T12_S15_S1_code_교환은_PKCE_클라이언트로', async () => {
    // 앱 주소(tripfriends://)는 다른 앱도 등록할 수 있다: code만으로는 세션을 못 만들게 pkce (§15 S1). 설정 값은 lib 테스트도 본다
    await toList();
    const { createClientCalls } = require('../test-support/supabase-mock');
    expect(createClientCalls.at(-1)?.options?.auth?.flowType).toBe('pkce');
  });
});
