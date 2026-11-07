// 가짜 서버 응답. 모양은 TASK-003 §6 + TASK-004 A2·A3·A6. 타입은 api-types에서만 가져온다 (A5 전에는 tsc가 day·name을 오류로 알려 준다).
import type { components } from 'api-types';

type S = components['schemas'];
export type Place = S['Place'];
export type PlanningSession = S['PlanningSession'];
export type CandidateBatch = S['CandidateBatch'];
export type CourseResult = S['CourseResult'];
export type Picks = S['Picks'];
export type SeedResult = S['SeedResult'];
export type SelectResult = S['SelectResult'];

export const SID = 'session-1';
export const DAY_ID = 'day-2';
const LODGING = { lat: 35, lng: 135 };
const M_PER_DEGREE = (Math.PI / 180) * 6371000;
export const northLat = (metres: number, base = LODGING.lat) => base + metres / M_PER_DEGREE;

export const day = {
  day_id: DAY_ID,
  day_number: 2,
  date: '2026-12-02',
  start: '10:00',
  end: '20:00',
  lodging: LODGING,
  must_visits: [{ place_id: 'D20', name: '꼭 갈 박물관', stay_min: 60 }], // stay_min: TASK-006 §11 Q19
  fixed: [] as { place_id: string | null; name: string; start: string; end: string }[],
};

export const seed: SeedResult = { trip_id: 'trip-1', day_ids: ['day-1', DAY_ID, 'day-3'] };

// §13-1 A8: 코스 항목의 좌표. 숙소(35, 135)와 일렬이 아니고, 후보 카드의 좌표(모두 경도 135)와도 일부러 다르다.
export const SPOT = {
  D01: { lat: 35.01, lng: 135.01 },
  D20: { lat: 35.02, lng: 134.99 },
  D30: { lat: 35.0, lng: 135.02 },
};

// 서버 문구가 앱 고정 문구를 이기는지 보려고 문서 대본과 일부러 다른 글을 쓴다 (§6)
export const session: PlanningSession = {
  session_id: SID,
  stage: 'asking',
  question: {
    text: '서버가_준_첫_질문',
    choices: [
      { id: 'walk_alley', label: '골목 산책' },
      { id: 'food_tour', label: '맛집 투어' },
      { id: 'shopping', label: '쇼핑' },
      { id: 'night_view', label: '야경' },
      { id: 'cafe', label: '카페' },
      { id: 'museum_experience', label: '전시·체험' },
    ],
    allow_text: true,
    allow_auto: true,
  },
  day,
};

export function place(
  id: string,
  metres: number,
  value: string | null,
  status: 'confirmed' | 'unverified' | 'unknown',
): Place {
  return {
    id,
    name: `장소 ${id}`,
    category: 'cafe',
    lat: northLat(metres),
    lng: LODGING.lng,
    crowd_level: 2,
    price_level: 2,
    mood_tags: ['골목'],
    facts: [{ field: 'opening_hours', value, status, source_type: 'demo', checked_at: null }],
  };
}

const PLACES: Place[] = [
  place('D01', 650, '10:00-18:00', 'confirmed'),
  place('D02', 1200, '11:00-14:00,17:00-22:00', 'unverified'),
  place('D03', 300, null, 'unknown'),
  place('D04', 400, null, 'confirmed'),
  place('D05', 500, null, 'unverified'),
  place('D06', 600, '09:00-21:00', 'confirmed'),
];

export const batch = (over: Partial<CandidateBatch> = {}): CandidateBatch => ({
  session_id: SID,
  stage: 'browsing',
  round: 1,
  message: '서버가_준_묶음_말',
  candidates: PLACES.map((p) => ({ place: p, why: `이유 ${p.id}` })),
  directions: [
    { id: 'quieter', label: '좀 더 한적한 데' },
    { id: 'closer', label: '숙소랑 가까운 데' },
  ],
  clarify: null,
  picks_count: 0,
  exhausted: false,
  direction_relaxed: false,
  day,
  picks: [],
  ...over,
});

export const picks = (ids: string[], count = ids.length): Picks => ({ picks: ids, picks_count: count });

export const relaxed = (id = 'opt-relaxed', over: object = {}) => ({
  option_id: id,
  label: 'relaxed' as const,
  items: [
    {
      seq: 1,
      place_id: 'D01',
      name: '장소 D01',
      ...SPOT.D01,
      start: '10:10',
      end: '11:40',
      stay_min: 90,
      stay_source: 'auto' as const,
      travel_min: 12,
      wait_min: 0,
      is_fixed: false,
      hours_status: 'confirmed' as const,
    },
    {
      seq: 2,
      place_id: 'D20',
      name: '꼭 갈 박물관',
      ...SPOT.D20,
      start: '12:00',
      end: '13:00',
      stay_min: 60,
      stay_source: 'user' as const,
      travel_min: 20,
      wait_min: 0,
      is_fixed: false,
      hours_status: 'unverified' as const,
    },
    {
      seq: 3,
      place_id: 'D30',
      name: '예약한 공연장',
      ...SPOT.D30,
      start: '15:00',
      end: '16:00',
      stay_min: 60,
      stay_source: 'auto' as const,
      travel_min: 48,
      wait_min: 0,
      is_fixed: true,
      hours_status: 'confirmed' as const,
    },
  ],
  dropped: [
    { place_id: 'D02', name: '장소 D02', reason: 'closed_at_time' as const },
    { place_id: 'D03', name: '장소 D03', reason: 'no_time' as const },
    { place_id: 'D04', name: '장소 D04', reason: 'fixed_conflict' as const },
  ],
  go_home_min: 25,
  total_travel_min: 80,
  ...over,
});

export const packed = (id = 'opt-packed') => ({
  option_id: id,
  label: 'packed' as const,
  items: [
    {
      seq: 1,
      place_id: 'D01',
      name: '장소 D01',
      ...SPOT.D01,
      start: '10:10',
      end: '10:55',
      stay_min: 45,
      stay_source: 'auto' as const,
      travel_min: 12,
      wait_min: 0,
      is_fixed: false,
      hours_status: 'confirmed' as const,
    },
  ],
  dropped: [],
  go_home_min: 30,
  total_travel_min: 42,
});

export const course = (options: object[] = [relaxed(), packed()]): CourseResult =>
  ({ session_id: SID, stage: 'composing', options, day }) as CourseResult;

export const selected: SelectResult = { day_id: DAY_ID, option_id: 'opt-relaxed' };
export const done = { day_id: DAY_ID, option_id: 'opt-relaxed', stage: 'done' as const };
