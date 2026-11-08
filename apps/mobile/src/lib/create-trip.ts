// TASK-010 §C2 여행 만들기 폼 규칙. 화면은 이 함수들이 정한 대로만 그린다.
import { addDays, daysBetween } from './calendar';

export type TripForm = {
  startDate: string | null;
  endDate: string | null;
  lodging: { place_id: string; name: string } | null;
  mustVisits: Record<string, string[]>;
};

export type CreateTripBody = {
  city_code: 'osaka';
  start_date: string;
  end_date: string;
  lodging_place_id?: string;
  must_visits: { date: string; place_id: string }[];
};

export const LODGING_TIMEOUT_MS = 3000; // §6: 숙소 검색 시간 초과
export const MAX_MUST_VISITS_PER_DAY = 5; // TASK-005 A3

export function emptyForm(): TripForm {
  return { startDate: null, endDate: null, lodging: null, mustVisits: {} };
}

/** 못 누르는 이유 한 줄. 누를 수 있으면 null (숙소·꼭 갈 곳은 선택) */
export function createBlocker(form: TripForm): string | null {
  return form.startDate === null || form.endDate === null ? '여행 날짜를 먼저 골라 줘' : null;
}

/** 시작~끝 날짜 (끝 포함) */
export function tripDates(start: string, end: string): string[] {
  return Array.from({ length: daysBetween(end, start) + 1 }, (_, i) => addDays(start, i));
}

export function canAddMustVisit(form: TripForm, date: string): boolean {
  return (form.mustVisits[date] ?? []).length < MAX_MUST_VISITS_PER_DAY;
}

/** §11 D1: 그 장소가 담긴 날이 몇 일째인지 (1부터), 없으면 null */
export function mustVisitDayNumber(form: TripForm, placeId: string): number | null {
  if (form.startDate === null) return null;
  const date = Object.keys(form.mustVisits).find((day) => form.mustVisits[day].includes(placeId));
  return date === undefined ? null : daysBetween(date, form.startDate) + 1;
}

/** 5곳이면, 또는 어느 날에든 이미 담긴 곳이면 그대로 (새 객체) */
export function addMustVisit(form: TripForm, date: string, placeId: string): TripForm {
  if (!canAddMustVisit(form, date) || mustVisitDayNumber(form, placeId) !== null) return { ...form };
  return { ...form, mustVisits: { ...form.mustVisits, [date]: [...(form.mustVisits[date] ?? []), placeId] } };
}

export function createTripBody(form: TripForm): CreateTripBody {
  const start = form.startDate as string;
  const end = form.endDate as string;
  const body: CreateTripBody = {
    city_code: 'osaka',
    start_date: start,
    end_date: end,
    must_visits: tripDates(start, end).flatMap((date) => (form.mustVisits[date] ?? []).map((place_id) => ({ date, place_id }))),
  };
  if (form.lodging) body.lodging_place_id = form.lodging.place_id;
  return body;
}

/** §B4·Q14: 앞뒤 공백을 지우고 한 글자부터 */
export const placeQueryReady = (q: string): boolean => q.trim().length >= 1;

/** §B5·Q14: 앞뒤 공백을 지우고 두 글자부터 */
export const lodgingQueryReady = (q: string): boolean => q.trim().length >= 2;

/** §B3: 계획을 고른 날의 고정 일정 변경은 409 PLAN_EXISTS. 그 밖에는 null (화면의 기본 문장을 쓴다) */
export function fixedEventError(status: number, code: string | null): string | null {
  return status === 409 && code === 'PLAN_EXISTS' ? '이미 계획을 고른 날이야. 일정을 바꾸려면 계획을 다시 짜야 해' : null;
}
