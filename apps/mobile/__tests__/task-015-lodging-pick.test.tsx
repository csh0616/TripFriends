/// <reference types="jest" />
// TASK-015 §12 Q6: a2 "지도에서 찍기" 화면 (앱). 로직·가드레일만 본다 — 색·간격·높이는 보지 않는다.
// 근거: TASK-015 §A ③(지도를 길게 눌러 핀, Google 호출 없음, "대략이어도 괜찮아") · §10 2-①(50km 밖 -> 안내 + 버튼 비활성) · §10 2-②(이름 붙이기는 a2에만, 30자 넘으면 입력 막기) ·
//       §11 Q1(too_far일 때 a2 안내) · §12 Q6(핀 없음 -> [여기로 정했어] 비활성 · too_far -> 안내 + 비활성 · 이름 칸 maxLength 30, 입력 글 그대로) ·
//       docs/design/reviews/task-015-design.md §1-3(위: SOS 없음 · pin-pick · pick-panel · 처음 상태 · 도시에서 멀 때 "안내는 보조 글을 바꿔 쓴다" · 이름 칸 규칙) · §7(글)
//
// 계약 (이 테스트가 정한 것, 승인 대기 — 화면 이름·testID는 문서에 없어 test-writer 제안):
//   모듈 '@/trips/lodging-pick-screen' · LodgingPickScreen({ cityCode, onConfirm, onBack })
//     onConfirm({ lat, lng, label }) -> Promise<{ ok: true } | { ok: false, status, code, reason }>  (부르는 쪽이 서버에 보낸다. 화면은 Google·서버를 부르지 않는다)
//   testID: 지도 `pick-map`(react-native-maps MapView, onLongPress의 nativeEvent.coordinate) · 찍은 핀 `pin-pick`(Marker, coordinate) ·
//           아래 시트 `pick-panel` · 이름 칸 `pick-label`(TextInput) · [여기로 정했어] `pick-confirm`
//   처음(핀 없음): 제목 "지도를 길게 눌러 숙소를 찍어 줘" · 보조 "대략이어도 괜찮아" · 이름 칸 없음 · pin-pick 없음 · [여기로 정했어] 비활성(눌러도 onConfirm 0)
//   길게 누름: pin-pick = 누른 좌표 · 제목 "여기쯤이 숙소야?" · 이름 칸(maxLength 30) · [여기로 정했어] 누를 수 있음
//   too_far(400 INVALID_LODGING): 보조 글이 "오사카에서 너무 멀어. 여행할 도시 근처로 찍어 줘"로 바뀜("대략이어도 괜찮아" 자리) + [여기로 정했어] 비활성
//   다른 reason · 성공: too_far 안내 없음
//   §13 Q2 (center prop 더함): LodgingPickScreen({ cityCode, center, onConfirm, onBack }) — center = 여행 만들기 화면이 받은 도시 정보의 center.
//     핀이 center에서 50km 이상(경계 50km는 밖)이면 **onConfirm을 부르기 전에** 바로 too_far 안내 + [여기로 정했어] 비활성 (@/lib/lodging-pick)
//   §13 Q3: too_far 뒤(앱 검사든 onConfirm의 400이든) 핀을 다시 찍거나 옮기면 다시 검사 -> 50km 안이면 켜짐 · 보조 글은 "대략이어도 괜찮아"로
//   §13 Q4: 이름 칸이 비면 label: null (빈 글을 보내지 않는다). 공백·탭·줄바꿈만이어도 빈 글 (§13 Q7② 서버·앱 같은 자르기)
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { LodgingPickScreen, type LodgingPickResult, type PickedLodging } from '@/trips/lodging-pick-screen';

import { tap } from '../test-support/planning-driver';

const TOO_FAR = '오사카에서 너무 멀어. 여행할 도시 근처로 찍어 줘';
const ROUGHLY = '대략이어도 괜찮아';
const FIRST_TITLE = '지도를 길게 눌러 숙소를 찍어 줘';
const PIN_TITLE = '여기쯤이 숙소야?';
const SPOT = { latitude: 34.657913, longitude: 135.506271 }; // 찍은 자리 (지어낸 값, 도시 중심에서 약 1km)
const CENTER = { lat: 34.6662, lng: 135.501 }; // 시드 v3 center (§9 Q6)
const KM_PER_LAT_DEG = (6371.0 * Math.PI) / 180; // 서버 테스트 north_of_center와 같은 식
const northKm = (km: number) => ({ latitude: CENTER.lat + km / KM_PER_LAT_DEG, longitude: CENTER.lng });

const isDisabled = (id: string) => {
  const host = screen.getByTestId(id) as unknown as { props: Record<string, any> };
  return host.props.accessibilityState?.disabled === true || host.props['aria-disabled'] === true || host.props.disabled === true;
};

let confirm: jest.Mock<Promise<LodgingPickResult>, [PickedLodging]>;
let fetchSpy: jest.SpyInstance;

async function show(result: LodgingPickResult = { ok: true }) {
  confirm = jest.fn(async (_picked: PickedLodging) => result);
  await render(<LodgingPickScreen cityCode="osaka" center={CENTER} onConfirm={confirm} onBack={jest.fn()} />);
}

async function longPress(at = SPOT) {
  await act(async () => {
    fireEvent(screen.getByTestId('pick-map'), 'longPress', { nativeEvent: { coordinate: at } });
  });
}

beforeEach(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockImplementation((() => {
    throw new Error('a2 화면은 네트워크를 부르지 않는다');
  }) as never);
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('a2 처음 상태 (핀 없음)', () => {
  test('T15_S12_Q6_핀이_없으면_여기로_정했어가_비활성이고_눌러도_보내지_않는다', async () => {
    await show();
    expect(isDisabled('pick-confirm')).toBe(true);
    await tap(screen.getByTestId('pick-confirm'));
    expect(confirm).not.toHaveBeenCalled();
  });

  test('T15_S12_Q6_처음엔_제목_지도를_길게_눌러_숙소를_찍어_줘·대략이어도_괜찮아·이름_칸과_핀이_없다', async () => {
    await show();
    const panel = screen.getByTestId('pick-panel');
    expect(within(panel).getByText(FIRST_TITLE)).toBeTruthy();
    expect(within(panel).getByText(ROUGHLY)).toBeTruthy();
    expect(screen.queryByTestId('pick-label')).toBeNull();
    expect(screen.queryByTestId('pin-pick')).toBeNull();
  });

  test('T15_S12_Q6_만들기_중이라_SOS가_없다', async () => {
    await show();
    expect(screen.queryByTestId('sos-button')).toBeNull();
  });
});

describe('a2 길게 눌러 핀', () => {
  test('T15_S12_Q6_길게_누르면_그_자리에_핀이_서고_여기로_정했어를_누를_수_있다', async () => {
    await show();
    await longPress();
    expect(screen.getByTestId('pin-pick').props.coordinate).toEqual(SPOT);
    expect(within(screen.getByTestId('pick-panel')).getByText(PIN_TITLE)).toBeTruthy();
    expect(within(screen.getByTestId('pick-panel')).getByText(ROUGHLY)).toBeTruthy();
    expect(isDisabled('pick-confirm')).toBe(false);
  });

  test('T15_S12_Q6_다시_길게_누르면_핀이_옮겨지고_마지막_자리를_보낸다', async () => {
    await show();
    await longPress();
    const moved = { latitude: 34.6662, longitude: 135.501 };
    await longPress(moved);
    expect(screen.getByTestId('pin-pick').props.coordinate).toEqual(moved);
    await tap(screen.getByTestId('pick-confirm'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({ lat: moved.latitude, lng: moved.longitude });
  });

  test('T15_S12_Q6_이름_칸에_친_글이_label로_간다', async () => {
    await show();
    await longPress();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('pick-label'), '친구 집');
    });
    await tap(screen.getByTestId('pick-confirm'));
    expect(confirm.mock.calls[0][0]).toEqual({ lat: SPOT.latitude, lng: SPOT.longitude, label: '친구 집' });
  });

  test('T15_S12_Q6_이름_칸은_입력_글_그대로_30자에서_막는다_maxLength_30', async () => {
    await show();
    await longPress();
    const field = screen.getByTestId('pick-label');
    expect(field.props.maxLength).toBe(30);
  });

  test('T15_S12_Q6_찍고_보내도_화면은_네트워크를_부르지_않는다', async () => {
    await show();
    await longPress();
    await tap(screen.getByTestId('pick-confirm'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('a2 도시에서 멀 때 (too_far)', () => {
  test('T15_S12_Q6_too_far면_보조_글이_안내로_바뀌고_여기로_정했어가_비활성', async () => {
    await show({ ok: false, status: 400, code: 'INVALID_LODGING', reason: 'too_far' });
    await longPress();
    await tap(screen.getByTestId('pick-confirm'));
    const panel = screen.getByTestId('pick-panel');
    expect(within(panel).getByText(TOO_FAR)).toBeTruthy();
    expect(within(panel).queryByText(ROUGHLY)).toBeNull(); // 안내는 보조 글 자리를 바꿔 쓴다 (§1-3)
    expect(isDisabled('pick-confirm')).toBe(true);
  });

  test('T15_S12_Q6_too_far_뒤_비활성_버튼을_눌러도_다시_보내지_않는다', async () => {
    await show({ ok: false, status: 400, code: 'INVALID_LODGING', reason: 'too_far' });
    await longPress();
    await tap(screen.getByTestId('pick-confirm'));
    await tap(screen.getByTestId('pick-confirm'));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test.each<[string, LodgingPickResult]>([
    ['성공', { ok: true }],
    ['label_too_long', { ok: false, status: 400, code: 'INVALID_LODGING', reason: 'label_too_long' }],
    ['다른_코드_too_far', { ok: false, status: 400, code: 'VALIDATION_ERROR', reason: 'too_far' }],
    ['503', { ok: false, status: 503, code: 'PROVIDER_UNAVAILABLE', reason: null }],
  ])('T15_S12_Q6_경계_%s면_too_far_안내가_없다', async (_name, result) => {
    await show(result);
    await longPress();
    await tap(screen.getByTestId('pick-confirm'));
    expect(screen.queryByText(TOO_FAR)).toBeNull();
  });
});

describe('§13 Q2 앱이 먼저 50km 검사 (서버에 묻기 전)', () => {
  test('T15_S13_Q2_50km_밖에_찍으면_보내기_전에_바로_안내하고_비활성', async () => {
    await show();
    await longPress(northKm(50.5));
    const panel = screen.getByTestId('pick-panel');
    expect(within(panel).getByText(TOO_FAR)).toBeTruthy();
    expect(within(panel).queryByText(ROUGHLY)).toBeNull();
    expect(isDisabled('pick-confirm')).toBe(true);
    await tap(screen.getByTestId('pick-confirm'));
    expect(confirm).not.toHaveBeenCalled();
  });

  test('T15_S13_Q2_경계_정확히_50km는_밖이라_안내하고_비활성', async () => {
    await show();
    await longPress(northKm(50));
    expect(within(screen.getByTestId('pick-panel')).getByText(TOO_FAR)).toBeTruthy();
    expect(isDisabled('pick-confirm')).toBe(true);
  });

  test('T15_S13_Q2_경계_49_999km는_안이라_안내_없이_켜짐', async () => {
    await show();
    await longPress(northKm(49.999));
    expect(screen.queryByText(TOO_FAR)).toBeNull();
    expect(isDisabled('pick-confirm')).toBe(false);
  });

  test('T15_S13_Q2_기준은_center_prop이다', async () => {
    // 같은 자리라도 center를 교토로 주면 오사카 남쪽 45km는 밖 (교토에서 약 84km)
    confirm = jest.fn(async (_picked: PickedLodging) => ({ ok: true }) as LodgingPickResult);
    await render(<LodgingPickScreen cityCode="osaka" center={{ lat: 34.9858, lng: 135.7588 }} onConfirm={confirm} onBack={jest.fn()} />);
    await longPress({ latitude: CENTER.lat - 45 / KM_PER_LAT_DEG, longitude: CENTER.lng });
    expect(within(screen.getByTestId('pick-panel')).getByText(TOO_FAR)).toBeTruthy();
    expect(isDisabled('pick-confirm')).toBe(true);
  });
});

describe('§13 Q3 too_far 뒤 다시 찍기 · 옮기기', () => {
  test('T15_S13_Q3_밖에_찍은_뒤_안으로_다시_찍으면_켜지고_보조_글이_돌아온다', async () => {
    await show();
    await longPress(northKm(50.5));
    expect(isDisabled('pick-confirm')).toBe(true);
    await longPress(northKm(49.5));
    const panel = screen.getByTestId('pick-panel');
    expect(within(panel).queryByText(TOO_FAR)).toBeNull();
    expect(within(panel).getByText(ROUGHLY)).toBeTruthy();
    expect(isDisabled('pick-confirm')).toBe(false);
    await tap(screen.getByTestId('pick-confirm'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({ lat: northKm(49.5).latitude, lng: northKm(49.5).longitude });
  });

  test('T15_S13_Q3_안에_찍은_뒤_밖으로_옮기면_다시_꺼진다', async () => {
    await show();
    await longPress();
    expect(isDisabled('pick-confirm')).toBe(false);
    await longPress(northKm(50));
    expect(isDisabled('pick-confirm')).toBe(true);
    expect(within(screen.getByTestId('pick-panel')).getByText(TOO_FAR)).toBeTruthy();
  });

  test('T15_S13_Q3_서버가_too_far를_준_뒤_다시_찍으면_다시_검사해_50km_안이면_켜진다', async () => {
    await show({ ok: false, status: 400, code: 'INVALID_LODGING', reason: 'too_far' });
    await longPress();
    await tap(screen.getByTestId('pick-confirm'));
    expect(isDisabled('pick-confirm')).toBe(true);
    const moved = { latitude: 34.6662, longitude: 135.501 };
    await longPress(moved);
    expect(isDisabled('pick-confirm')).toBe(false);
    expect(within(screen.getByTestId('pick-panel')).getByText(ROUGHLY)).toBeTruthy();
    await tap(screen.getByTestId('pick-confirm'));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1][0]).toMatchObject({ lat: moved.latitude, lng: moved.longitude });
  });

  test('T15_S13_Q3_경계_서버가_too_far를_준_뒤_밖으로_다시_찍으면_꺼진_채', async () => {
    await show({ ok: false, status: 400, code: 'INVALID_LODGING', reason: 'too_far' });
    await longPress();
    await tap(screen.getByTestId('pick-confirm'));
    await longPress(northKm(50.5));
    expect(isDisabled('pick-confirm')).toBe(true);
    expect(within(screen.getByTestId('pick-panel')).getByText(TOO_FAR)).toBeTruthy();
  });
});

describe('§13 Q4 이름 칸이 비면 label: null', () => {
  test('T15_S13_Q4_이름_칸을_건드리지_않으면_label_null', async () => {
    await show();
    await longPress();
    await tap(screen.getByTestId('pick-confirm'));
    expect(confirm.mock.calls[0][0]).toEqual({ lat: SPOT.latitude, lng: SPOT.longitude, label: null });
  });

  test.each(['', '   ', '\t', ' \n '])('T15_S13_Q4_Q7_이름_칸이_%j면_빈_글을_보내지_않고_label_null', async (typed) => {
    await show();
    await longPress();
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('pick-label'), '친구 집');
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('pick-label'), typed);
    });
    await tap(screen.getByTestId('pick-confirm'));
    expect(confirm.mock.calls[0][0]).toEqual({ lat: SPOT.latitude, lng: SPOT.longitude, label: null });
  });
});
