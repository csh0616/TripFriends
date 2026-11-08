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

// ---------- TASK-011 A0 화면 규칙 함수 (껍데기: 테스트가 먼저, 구현은 frontend) ----------
type Schemas = import('api-types').components['schemas'];
type DayLike = Pick<Schemas['TripDay'], 'day_id' | 'date' | 'state' | 'chosen_option_id'>;
type TripLike = Pick<Schemas['Trip'], 'city_code' | 'start_date' | 'end_date'> & { trip_days: DayLike[] };

/** 날짜 목록 아래 큰 버튼 하나. 없으면 null (TASK-011 A0) */
export type DayListPrimary = { label: string; dayId: string; sublabel: string | null };

/** 날짜 목록 머리 (TASK-011 A0): title "오사카 2박 3일", dots "●○○", line "D-35 · 3일 중 1일 계획 완료" */
export type TripHeader = { title: string; dots: string; line: string };

export function dayListPrimary(_days: readonly DayLike[], _today: string): DayListPrimary | null {
  throw new Error('not implemented');
}

export function tripHeader(_trip: TripLike, _today: string): TripHeader {
  throw new Error('not implemented');
}
