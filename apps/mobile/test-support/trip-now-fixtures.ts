// 가짜 NowView. 모양은 TASK-006 §A-1. 시각 값 형식(leave_at 등)은 질문 Q8의 답이 나오면 맞춘다.
import { day, DAY_ID, SPOT } from './planning-fixtures';

type Status = 'confirmed' | 'unverified' | 'unknown';

export const NOW_ROUTE = `GET /days/${DAY_ID}/now`;

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
  fixed: { name: '서버_예약_공연', start: '15:00', end: '16:00' },
  leave_by: '14:40',
  leave_in_min: 15,
  ...over,
});
export const t08 = (over: object = {}) => ({ type: 'T-08', go_home_min: 25, lodging: day.lodging, ...over });

export const pins = [
  { seq: 1, place_id: 'D01', name: first.name, ...SPOT.D01, state: 'done' },
  { seq: 2, place_id: 'D02', name: second.name, ...SPOT.D20, state: 'now' },
  { seq: 3, place_id: 'D03', name: third.name, ...SPOT.D30, state: 'next' },
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
  ...over,
});
