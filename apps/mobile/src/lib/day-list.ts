import { dayName, weekdayChar } from '@/planning/format';

// TASK-010 §C3 날짜 목록 (DESIGN-001 §4-9). 날 상태는 서버가 계산해서 준다. 앱은 글자와 갈 곳만 고른다.
export type DayState = 'planning' | 'planned' | 'today' | 'past';
export type DayDestination = 'planning' | 'course' | 'now' | 'review';

export function dayPill(state: string): string {
  switch (state) {
    case 'planned':
      return '계획 완료';
    case 'today':
      return '오늘 · 여행 중';
    case 'past':
      return '지난 날';
    default:
      return '계획 전';
  }
}

/** 오늘인데 고른 코스가 없으면 계획 대화부터 (§9 Q6) */
export function dayDestination(state: string, hasCourse: boolean): DayDestination {
  switch (state) {
    case 'planned':
      return 'course';
    case 'past':
      return 'review';
    case 'today':
      return hasCourse ? 'now' : 'planning';
    default:
      return 'planning';
  }
}

// ---------- TASK-011 A0 화면 규칙 함수 ----------
type Schemas = import('api-types').components['schemas'];
type DayLike = Pick<Schemas['TripDay'], 'day_id' | 'date' | 'state' | 'chosen_option_id'>;
type TripLike = Pick<Schemas['Trip'], 'city_code' | 'start_date' | 'end_date'> & { trip_days: readonly DayLike[] };

/** 날짜 목록 아래 큰 버튼 하나. 없으면 null (TASK-011 A0) */
export type DayListPrimary = { label: string; dayId: string; sublabel: string | null };

/** 날짜 목록 머리 (TASK-011 A0): title "오사카 2박 3일", dots "●○○", line "D-35 · 3일 중 1일 계획 완료" */
export type TripHeader = { title: string; dots: string; line: string };

const CITY_NAME: Readonly<Record<string, string>> = { osaka: '오사카' };
const DAY_MS = 86_400_000;
const dayIndex = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

/** "12/12 토" */
export function shortDateLabel(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} ${weekdayChar(date)}`;
}

/** "2일째 · 12/12 토" (날 번호는 목록 순서 = 서버 day_number) */
export function dayHeading(index: number, date: string): string {
  return `${dayName(index + 1)} \u00b7 ${shortDateLabel(date)}`;
}

/** 오늘이 여행 중이면 [오늘 여행 보기], 아니면 다음 계획 전 날의 [같이 고르기]. 둘 다 없으면 null (주 버튼 없음) */
export function dayListPrimary(days: readonly DayLike[], _today: string): DayListPrimary | null {
  const todayAt = days.findIndex((day) => day.state === 'today');
  if (todayAt >= 0) return { label: '오늘 여행 보기', dayId: days[todayAt].day_id, sublabel: dayHeading(todayAt, days[todayAt].date) };
  const nextAt = days.findIndex((day) => day.state === 'planning');
  if (nextAt >= 0) return { label: '같이 고르기', dayId: days[nextAt].day_id, sublabel: dayHeading(nextAt, days[nextAt].date) };
  return null;
}

/** 머리: 제목, 날 순서 점(고른 코스가 있으면 ●), "D-35 · 3일 중 1일 계획 완료". 여행 중 "여행 중", 끝난 뒤 "여행 끝"만 */
export function tripHeader(trip: TripLike, today: string): TripHeader {
  const count = trip.trip_days.length;
  const city = CITY_NAME[trip.city_code] ?? trip.city_code;
  const title = count === 1 ? `${city} 당일 여행` : `${city} ${count - 1}박 ${count}일`;
  // 여행 중·여행 끝은 기기 시계가 아니라 서버가 계산한 날 상태를 따른다 (TASK-011 §13 3). 기기 시계는 D-숫자에만
  if (count > 0 && trip.trip_days.every((day) => day.state === 'past')) return { title, dots: '\u25cf'.repeat(count), line: '여행 끝' };
  const planned = trip.trip_days.filter((day) => day.chosen_option_id !== null).length;
  const dots = trip.trip_days.map((day) => (day.chosen_option_id !== null ? '\u25cf' : '\u25cb')).join('');
  const during = trip.trip_days.some((day) => day.state === 'today');
  const when = during ? '여행 중' : `D-${dayIndex(trip.start_date) - dayIndex(today)}`;
  return { title, dots, line: `${when} \u00b7 ${count}일 중 ${planned}일 계획 완료` };
}
