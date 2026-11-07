// 가짜 NowView. 모양은 TASK-006 §A-1·§11·§12 (Q8 HH:MM, Q15·R6 핀 시각·이동 분, Q21 fixed.facts, R4 fixed.title, E4 T-08 map_url).
import { day, DAY_ID, seed, SPOT } from './planning-fixtures';

type Status = 'confirmed' | 'unverified' | 'unknown';

// §14 Q1 결정: {"chosen": true} 응답만 둘째 날 요약(day)을 더한다. 일반 시드는 planning-fixtures의 seed 그대로
export const chosenSeed = (over: object = {}) => ({
  ...seed,
  day: {
    ...day,
    fixed: [{ place_id: 'D05', name: '서버_식당_이름', start: '18:30', end: '19:30' }],
    ...over,
  },
});

export const NOW_ROUTE = `GET /days/${DAY_ID}/now`;
export const CHECK_ROUTE = `POST /days/${DAY_ID}/check`; // TASK-007 B-4

export const nowItem = (seq: number, name: string, start: string, end: string, status: Status = 'confirmed', at = SPOT.D01) => ({
  seq,
  place_id: `D0${seq}`,
  name,
  start,
  end,
  lat: at.lat,
  lng: at.lng,
  is_fixed: false,
  facts: [{ field: 'opening_hours', value: '10:00-18:00', status, source_type: 'demo', checked_at: null }],
});

export const first = nowItem(1, '서버_첫째_장소', '10:12', '12:00');
export const second = nowItem(2, '서버_둘째_장소', '12:20', '14:00', 'unverified', SPOT.D20);
export const third = nowItem(3, '서버_셋째_장소', '14:30', '19:00', 'unknown', SPOT.D30);

export const MAP_URL = 'https://www.google.com/maps/dir/?api=1&destination=35.02,134.99&travelmode=transit';

export const t01 = (over: object = {}) => ({ type: 'T-01', item: second, ends_in_min: 40, ...over });
export const t02 = (over: object = {}) => ({
  type: 'T-02',
  next_item: second,
  leave_at: '12:00',
  leave_in_min: 5,
  travel_min: 20,
  map_url: MAP_URL,
  ...over,
});
export const t03 = (over: object = {}) => ({ type: 'T-03', items: [second, third], ...over });
export const t07 = (over: object = {}) => ({
  type: 'T-07',
  fixed: { name: '서버_식당_이름', title: '서버_예약_제목', start: '15:00', end: '16:00', facts: first.facts },
  leave_by: '14:40',
  leave_in_min: 15,
  ...over,
});
export const HOME_URL = 'https://www.google.com/maps/dir/?api=1&destination=35,135&travelmode=transit';
export const t08 = (over: object = {}) => ({ type: 'T-08', go_home_min: 25, lodging: day.lodging, map_url: HOME_URL, ...over }); // map_url: §13 E4

export const pins = [
  { seq: 1, place_id: 'D01', name: first.name, ...SPOT.D01, start: first.start, end: first.end, travel_min: 12, state: 'done' },
  { seq: 2, place_id: 'D02', name: second.name, ...SPOT.D20, start: second.start, end: second.end, travel_min: 20, state: 'now' },
  { seq: 3, place_id: 'D03', name: third.name, ...SPOT.D30, start: third.start, end: third.end, travel_min: 30, state: 'next' },
];

const point = (at: { lat: number; lng: number }) => [at.lat, at.lng];
export const route = {
  done: [point(day.lodging), point(SPOT.D01), point(SPOT.D20)],
  remaining: [point(SPOT.D20), point(SPOT.D30), point(day.lodging)],
};

export const POSITION = { lat: 35.015, lng: 135.0 };

export const nowView = (over: object = {}) => ({
  day,
  at: '2026-12-02T13:20:00',
  status: 'on_track',
  status_text: '서버_상태_글자',
  reason: '서버_바뀐_이유',
  main: t01(),
  subs: [t02(), t03()],
  chip: null,
  pins,
  route,
  position: POSITION,
  event: null, // TASK-007 B-5
  ...over,
});

// ---------- TASK-007 B-5: 사건·제안·T-04 ----------

// 제안의 일정은 지도 핀과 다른 자리에 둔다: 고르기 전에 지도에 그려지면 C6 테스트가 잡는다
export const PROPOSAL_SPOT = { lat: 35.4, lng: 135.4 };

export const proposal = (over: object = {}) => ({
  proposal_id: 'prop-relaxed',
  label: 'relaxed',
  reason: '서버_이유_여유',
  dropped: [{ place_id: 'D03', name: '서버_빠지는_곳' }],
  keeps_fixed: true,
  first_leave_at: '13:40',
  items: [{ ...nowItem(2, '서버_제안_장소', '14:10', '15:00', 'confirmed', PROPOSAL_SPOT) }],
  ...over,
});

export const proposalPacked = (over: object = {}) =>
  proposal({ proposal_id: 'prop-packed', label: 'packed', reason: '서버_이유_빠듯', dropped: [], first_leave_at: '13:35', ...over });

export const T04_FIXED = { title: '서버_예약_제목', start: '15:30' };

export const delayEvent = (over: object = {}) => ({
  event_id: 'ev-1',
  type: 'delay',
  severity: 'high',
  delay_min: 23,
  state: 'awaiting',
  proposals: [proposal(), proposalPacked()],
  ...over,
});

export const t04 = (over: object = {}) => ({
  type: 'T-04',
  event_id: 'ev-1',
  delay_min: 23,
  proposals: [proposal(), proposalPacked()],
  fixed: T04_FIXED,
  ...over,
});

export const ACCEPT_ROUTE = (id: string) => `POST /proposals/${id}/accept`;
export const DISMISS_ROUTE = (id: string) => `POST /events/${id}/dismiss`;

/** 메인 T-04가 떠 있는 화면 (awaiting) */
export const delayedView = (over: object = {}) =>
  nowView({ status: 'delayed', status_text: '23분 늦어지는 중', main: t04(), subs: [t07(), t03()], event: delayEvent(), ...over });
