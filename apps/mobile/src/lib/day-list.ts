// TASK-010 §C3 날짜 목록 (DESIGN-001 §4-9). 껍데기: 시그니처만 (test-writer). 구현은 frontend.
export type DayState = 'planning' | 'planned' | 'today' | 'past';
export type DayDestination = 'planning' | 'course' | 'now' | 'review';

export function dayPill(_state: string): string {
  throw new Error('not implemented');
}

export function dayDestination(_state: string, _hasCourse: boolean): DayDestination {
  throw new Error('not implemented');
}
