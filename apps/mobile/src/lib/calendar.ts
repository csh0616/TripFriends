// TASK-010 §9 Q17 달력 시트의 날짜 규칙 (JS만, 네이티브 모듈 없음). 껍데기: 시그니처만 (test-writer). 구현은 frontend.
export type DateRange = { start: string | null; end: string | null };

export function cityToday(_nowMs: number, _timezone: string = 'Asia/Tokyo'): string {
  throw new Error('not implemented');
}

export function monthGrid(_month: string): (string | null)[][] {
  throw new Error('not implemented');
}

export function startSelectable(_date: string, _today: string): boolean {
  throw new Error('not implemented');
}

export function endSelectable(_date: string, _start: string): boolean {
  throw new Error('not implemented');
}

export function pickDate(_range: DateRange, _date: string): DateRange {
  throw new Error('not implemented');
}
