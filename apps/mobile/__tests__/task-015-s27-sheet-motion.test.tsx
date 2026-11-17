/// <reference types="jest" />
// TASK-015 §27 시트 움직임 (task-015-design §14-5 "같이 정해 둘 넷" — PM 승인). 로직 · 가드레일만 (움직임의 느낌은 폰 확인 AC-6 몫).
// 근거: TASK-015 §27 표 "시트 들썩임 250ms로 충분한가 -> 충분, 높이 상한 없음 · 디자이너 §14-5 넷 승인: 높이는 카드 종류가 바뀔 때만 움직임 ·
//       내용은 교차 페이드 · 지도 카메라 여백은 움직임이 끝난 뒤 한 번만 · '동작 줄이기' 설정이면 즉시. 250ms는 폰 확인 때 200~300 사이에서 조정" ·
//       task-015-design §14-5 ①~④(교차 페이드 약 120ms · 카메라 아래 여백 B10은 움직임이 끝난 뒤 한 번만 · 동작 줄이기면 즉시) · §26(250ms, `822a093`)
//
// 계약 (이 파일이 정한 것):
//   '@/now/sheet-motion'의 sheetMotion(reduceMotion) -> { durationMs, fadeMs } 한 곳에서 값을 정한다 (폰 확인 때 이 값만 바꾼다)
//     보통: durationMs 200 이상 300 이하(지금 250) · fadeMs 120(디자인 "약 120ms") · fadeMs <= durationMs
//     동작 줄이기: durationMs 0 · fadeMs 0 (즉시)
//   여행 중 화면: BottomSheet animationConfigs.duration = sheetMotion(지금 동작 줄이기 값).durationMs
//     동작 줄이기 값 = AccessibilityInfo.isReduceMotionEnabled() 결과, 바뀌면 'reduceMotionChanged' 알림으로 따라감
//   카메라 (③): 메인 카드 종류가 바뀌어 접힌 단이 움직여도 지도 카메라 호출(fit · 영역 이동)이 늘지 않는다 (실제 여행 · 데모는 처음 한 번만 맞춤, B10)
//   ① "높이는 종류가 바뀔 때만": 같은 종류에서 숫자만 바뀌고(21 -> 20분) 잰 값이 같으면 접힌 단이 그대로 (같은 종류 안에서 잰 높이가 달라질 때는 질문)
//   ② 교차 페이드의 화면 모습은 가짜 애니메이션으로 볼 수 없어 값(fadeMs)만 본다
import { act, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { sheetMotion } from '@/now/sheet-motion';

import { sheetControl } from '../test-support/bottom-sheet-mock';
import { mapControl } from '../test-support/maps-mock';
import { pressId, resetDevice } from '../test-support/planning-driver';
import { installConfig, nowServer, TEST_KEY, toNow } from '../test-support/trip-now-driver';
import { nowView, t01, t02 } from '../test-support/trip-now-fixtures';

const nowCard = (card: object) => nowView({ main: card, subs: [] });

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

describe('§27 시트 움직임 값 — 한 곳에서 (sheetMotion)', () => {
  test('T15_S27_보통은_200~300ms_안이고_교차_페이드_120ms_이하로_움직임_안', () => {
    const motion = sheetMotion(false);
    expect(motion.durationMs).toBeGreaterThanOrEqual(200);
    expect(motion.durationMs).toBeLessThanOrEqual(300);
    expect(motion.fadeMs).toBe(120);
    expect(motion.fadeMs).toBeLessThanOrEqual(motion.durationMs);
  });

  test('T15_S27_지금_시간은_250ms(§26_승인값)', () => {
    expect(sheetMotion(false).durationMs).toBe(250);
  });

  test('T15_S27_동작_줄이기면_즉시(0)', () => {
    expect(sheetMotion(true)).toEqual({ durationMs: 0, fadeMs: 0 });
  });
});

describe('§27 시트 움직임 — 여행 중 화면', () => {
  const duration = () => (sheetControl.props?.animationConfigs as { duration?: number } | undefined)?.duration;

  test('T15_S27_동작_줄이기가_꺼져_있으면_시트_움직임_시간은_sheetMotion(false)', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    await toNow(nowServer(nowCard(t01())));
    await waitFor(() => expect(duration()).toBe(sheetMotion(false).durationMs));
  });

  test('T15_S27_동작_줄이기가_켜져_있으면_시트가_즉시(시간_0)', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await toNow(nowServer(nowCard(t01())));
    await waitFor(() => expect(duration()).toBe(0));
  });

  test('T15_S27_여행_중에_동작_줄이기를_켜면_알림을_따라_즉시로', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const listeners: ((on: boolean) => void)[] = [];
    const real = AccessibilityInfo.addEventListener.bind(AccessibilityInfo);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((name: string, handler: (on: boolean) => void) => {
      if (name === 'reduceMotionChanged') listeners.push(handler);
      return real(name as never, handler as never);
    }) as never);
    await toNow(nowServer(nowCard(t01())));
    await waitFor(() => expect(duration()).toBe(sheetMotion(false).durationMs));
    expect(listeners.length).toBeGreaterThanOrEqual(1);
    await act(async () => {
      for (const listener of listeners) listener(true);
    });
    expect(duration()).toBe(0);
  });

  test('T15_S27_메인_카드_종류가_바뀌어도_지도_카메라_호출이_늘지_않는다(카메라_여백은_시트를_따라_매번_안_바뀜)', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const { control } = await toNow(nowServer(nowCard(t01())));
    const calls = () => mapControl.fits.length + mapControl.moves.length + mapControl.regions.length;
    const before = calls();
    control.show(nowCard(t02()));
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await waitFor(() => expect(sheetControl.props).not.toBeNull());
    await act(async () => undefined);
    expect(calls()).toBe(before);
  });

  test('T15_S27_같은_종류에서_숫자만_바뀌면_접힌_단이_그대로', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const { control } = await toNow(nowServer(nowCard(t01({ ends_in_min: 21 }))));
    const low = () => (sheetControl.props?.snapPoints as (string | number)[])[0];
    const before = low();
    control.show(nowCard(t01({ ends_in_min: 20 })));
    await pressId('demo-toggle');
    await pressId('demo-plus-10');
    await act(async () => undefined);
    expect(low()).toBe(before);
  });
});
