// 화면 글자를 만드는 작은 함수들 (판단·계산이 아니라 표시용 글자). 날짜·시각은 서버가 준 값을 그대로 옮긴다.
import { withParticle } from '@/lib/particle';
import type { DaySummary } from '@/lib/planning-api';

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const EN_DASH = '\u2013';

/** TASK-011 DESIGN-001 §4-11: 모든 화면 "N일째" ("첫째 날"·"Day N"을 쓰지 않는다) */
export function dayName(dayNumber: number): string {
  return `${dayNumber}일째`;
}

/** 요일 한 글자 ("2026-12-12" -> "토") */
export function weekdayChar(isoDate: string): string {
  const [year, month, date] = isoDate.split('-').map(Number);
  return WEEKDAY[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
}

/** TASK-011 §4-11 시각 범위: 엔 대시 "17:00–23:00" */
export function timeRange(start: string, end: string): string {
  return `${start}${EN_DASH}${end}`;
}

/** 서버 영업시간 글자("10:00-18:00", "11:00-14:00,17:00-22:00")를 화면 글자로: 범위는 엔 대시, 두 구간은 가운데 점 (TASK-011 §9 Q7·Q8). 모르는 모양은 그대로 */
export function hoursRangeText(value: string): string {
  const parts = value.split(',').map((part) => /^(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})$/.exec(part.trim()));
  if (parts.some((part) => part === null)) return value;
  return parts.map((part) => timeRange(part![1], part![2])).join(' \u00b7 ');
}

/** TASK-011 §4-11 부제: "12월 2일 수 · 10:00–20:00" (요일 한 글자) */
export function daySubtitle(day: DaySummary): string {
  const [, month, date] = day.date.split('-').map(Number);
  return `${month}월 ${date}일 ${weekdayChar(day.date)} · ${timeRange(day.start, day.end)}`;
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** TASK-004 Q6·Q40: 꼭 갈 곳 줄. 하나면 "{이름}{은/는} 먼저 넣어 뒀어", 여럿이면 조사를 피해 쉼표로 */
export function mustVisitLine(names: string[]): string {
  if (names.length === 1) {
    return `${withParticle(names[0], '은/는')} 먼저 넣어 뒀어`; // TASK-009 B2: 영문·숫자도 읽는 소리로 조사를 붙인다
  }
  return `${names.join(', ')}, 먼저 넣어 뒀어`;
}

export const pad2 = (value: number) => String(value).padStart(2, '0');
