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
