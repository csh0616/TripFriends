// TASK-010 §9 Q17 달력 시트의 날짜 규칙 (JS만, 네이티브 모듈 없음). 날짜는 "YYYY-MM-DD" 글자로만 다룬다.
export type DateRange = { start: string | null; end: string | null };

const DAY_MS = 86400000;
const START_WINDOW_DAYS = 180; // §B1·§11 D2: 시작일 = 오늘 ~ 180일 뒤
const MAX_SPAN_DAYS = 6; // 끝 = 시작 ~ 시작 + 6일 (기간 1~7일)
const DAYS_PER_WEEK = 7;

const twoDigits = (value: number): string => String(value).padStart(2, '0');
const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/** 두 날짜 사이의 일 수 (a - b) */
export const daysBetween = (a: string, b: string): number => dayNumber(a) - dayNumber(b);

export function addDays(day: string, count: number): string {
  return new Date((dayNumber(day) + count) * DAY_MS).toISOString().slice(0, 10);
}

/** 도시 시간대의 날짜·시각 (§9 Q18). minutes = 그날 0시부터 분 */
export function cityClock(nowMs: number, timezone: string = 'Asia/Tokyo'): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(nowMs);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export const cityToday = (nowMs: number, timezone: string = 'Asia/Tokyo'): string => cityClock(nowMs, timezone).date;

/** 한 달 칸: 주마다 7칸, 일요일부터, 그 달 밖은 null */
export function monthGrid(month: string): (string | null)[][] {
  const first = `${month}-01`;
  const lead = new Date(`${first}T00:00:00Z`).getUTCDay(); // 0 = 일요일
  const count = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => `${month}-${twoDigits(i + 1)}`),
  ];
  while (cells.length % DAYS_PER_WEEK !== 0) cells.push(null);
  return Array.from({ length: cells.length / DAYS_PER_WEEK }, (_, week) => cells.slice(week * DAYS_PER_WEEK, (week + 1) * DAYS_PER_WEEK));
}

export function startSelectable(date: string, today: string): boolean {
  const gap = daysBetween(date, today);
  return gap >= 0 && gap <= START_WINDOW_DAYS;
}

export function endSelectable(date: string, start: string): boolean {
  const gap = daysBetween(date, start);
  return gap >= 0 && gap <= MAX_SPAN_DAYS;
}

/** 첫 번째 누름 = 시작, 두 번째 = 끝. 시작보다 앞 날이면 그 날이 새 시작 (§10 Q28). 범위 밖 끝은 무시 */
export function pickDate(range: DateRange, date: string): DateRange {
  if (range.start === null || range.end !== null) return { start: date, end: null };
  if (daysBetween(date, range.start) < 0) return { start: date, end: null };
  if (!endSelectable(date, range.start)) return range;
  return { start: range.start, end: date };
}
