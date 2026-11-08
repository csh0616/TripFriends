/// <reference types="jest" />
// TASK-010 §11 G1·G2: 계획 후보 카드에 Google 값(영업시간 출처 google)이 있으면 카드 안에 Google 로고 자리 `g-slot`.
// 공식 로고 파일 전에는 글자 'Google Maps' (번역 금지). 출처가 google이 아닌 카드에는 없다. 모습(크기·색)은 시험하지 않는다.
import { screen, within } from '@testing-library/react-native';

import { json } from '../test-support/fake-server';
import { happyServer, R, resetDevice, toP2 } from '../test-support/planning-driver';
import { batch, PLACES } from '../test-support/planning-fixtures';

const withSource = (id: string, source: string, over: object = {}) =>
  PLACES.map((p) => (p.id === id ? { ...p, facts: p.facts.map((f) => (f.field === 'opening_hours' ? { ...f, source_type: source, ...over } : f)) } : p));

beforeEach(() => resetDevice());
afterEach(() => jest.restoreAllMocks());

test('T10_G2_Google_값이_있는_후보_카드에는_g_slot과_Google_Maps', async () => {
  const places = withSource('D01', 'google');
  happyServer().on(R.answer, json(200, batch({ candidates: places.map((p) => ({ place: p, why: `이유 ${p.id}` })) })));
  await toP2();
  const card = await screen.findByTestId('candidate-card-D01');
  const slot = within(card).getByTestId('g-slot');
  expect(within(slot).getByText('Google Maps')).toBeTruthy();
  expect(within(screen.getByTestId('candidate-card-D02')).queryByTestId('g-slot')).toBeNull(); // demo 출처
});

// TASK-010 §14 PM 답 2 (11-09): Google Maps 표기는 화면에 Google 값이 실제로 보일 때만.
// 후보 카드가 보여 주는 fact는 영업시간(opening_hours) 하나뿐이다 (p2.tsx: todayHoursText(place.facts), 이름·이유·거리는 fact가 아님).
// 그래서 "다른 Google 값"이 카드에 없다 -> 영업시간이 '모름'(값 없음·상태 unknown)이면 출처가 google이어도 g-slot이 없다.
test('T10_S14_PM2_Google_출처라도_영업시간_모름이면_g_slot이_없다', async () => {
  const places = withSource('D03', 'google'); // D03 = 값 null · 상태 unknown
  happyServer().on(R.answer, json(200, batch({ candidates: places.map((p) => ({ place: p, why: `이유 ${p.id}` })) })));
  await toP2();
  const card = await screen.findByTestId('candidate-card-D03');
  expect(within(card).getByText('영업시간 모름')).toBeTruthy();
  expect(within(card).queryByTestId('g-slot')).toBeNull();
  expect(within(card).queryByText('Google Maps')).toBeNull();
});

test('T10_S14_PM2_Google_영업시간이_보이면_미확인이어도_g_slot이_있다', async () => {
  const places = withSource('D02', 'google'); // D02 = 값 있음 · 상태 unverified
  happyServer().on(R.answer, json(200, batch({ candidates: places.map((p) => ({ place: p, why: `이유 ${p.id}` })) })));
  await toP2();
  const card = await screen.findByTestId('candidate-card-D02');
  expect(within(card).getByText('11:00-14:00,17:00-22:00')).toBeTruthy();
  expect(within(card).getByTestId('g-slot')).toBeTruthy();
});

test('T10_S14_PM2_한_묶음에서_Google_영업시간이_보이는_카드에만_g_slot', async () => {
  const places = withSource('D03', 'google').map((p) => (p.id === 'D01' ? withSource('D01', 'google').find((q) => q.id === 'D01')! : p));
  happyServer().on(R.answer, json(200, batch({ candidates: places.map((p) => ({ place: p, why: `이유 ${p.id}` })) })));
  await toP2();
  await screen.findByTestId('candidate-card-D01');
  expect(within(screen.getByTestId('candidate-card-D01')).getByTestId('g-slot')).toBeTruthy();
  expect(within(screen.getByTestId('candidate-card-D03')).queryByTestId('g-slot')).toBeNull();
});

// TASK-010 §13 O4: 늘 열림 = "늘 열려 있어" + 출처 "Tripfriends". 우리가 정한 값이라 Google 자리(g-slot)는 없다
test('T10_S13_O4_늘_열린_후보_카드는_늘_열려_있어와_Tripfriends', async () => {
  const places = withSource('D01', 'curated', { value: '00:00-24:00', status: 'confirmed' });
  happyServer().on(R.answer, json(200, batch({ candidates: places.map((p) => ({ place: p, why: `이유 ${p.id}` })) })));
  await toP2();
  const card = await screen.findByTestId('candidate-card-D01');
  expect(within(card).getByText('늘 열려 있어')).toBeTruthy();
  expect(within(card).getByText(/Tripfriends/)).toBeTruthy();
  expect(within(card).queryByTestId('g-slot')).toBeNull();
});

test('T10_S13_O4_우리가_정한_시간대_후보_카드는_시각과_Tripfriends', async () => {
  const places = withSource('D01', 'curated', { value: '17:00-24:00', status: 'confirmed' });
  happyServer().on(R.answer, json(200, batch({ candidates: places.map((p) => ({ place: p, why: `이유 ${p.id}` })) })));
  await toP2();
  const card = await screen.findByTestId('candidate-card-D01');
  expect(within(card).getByText(/17:00-24:00/)).toBeTruthy();
  expect(within(card).getByText(/Tripfriends/)).toBeTruthy();
});
