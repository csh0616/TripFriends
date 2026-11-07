// TASK-006 B7: 데모 시계의 시각 계산. 화면이 아니라 시각 글자("HH:MM")만 다룬다. 판단은 서버가 한다.
export const DEMO_STEP_MIN = 5; // 시각 막대·재생의 단위 (재생은 1초에 한 단위)
export const DEMO_PLUS_MIN = 10; // [+10분]
export const DEMO_TICK_MS = 1000; // 재생 한 칸의 실제 시간
export const NOW_DEBOUNCE_MS = 300; // B8: 시각이 바뀐 뒤 요청까지 기다리는 시간

export const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function toClock(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** 서버에 보내는 시각. 시간대 없이 "2026-12-02T10:00:00" (TASK-006 §12 R9) */
export const atOf = (date: string, minutes: number): string => `${date}T${toClock(minutes)}:00`;

/** "2026-12-02T10:05:00" -> 10시 5분 = 605. 모양이 다르면 null */
export function minutesOfAt(at: string): number | null {
  const found = /T(\d{2}):(\d{2})/.exec(at);
  return found ? Number(found[1]) * 60 + Number(found[2]) : null;
}

/** 시각 막대 위치(0~1) -> 하루 시작~끝 사이 5분 단위 시각. 하루 밖으로 나가지 않는다 */
export function barTime(ratio: number, start: string, end: string): string {
  const from = toMinutes(start);
  const to = toMinutes(end);
  const clamped = Math.min(1, Math.max(0, Number.isNaN(ratio) ? 0 : ratio));
  const stepped = Math.round((from + clamped * (to - from)) / DEMO_STEP_MIN) * DEMO_STEP_MIN;
  return toClock(Math.min(to, Math.max(from, stepped)));
}
