// 날짜 글자 (표시용). 계산은 lib/calendar.ts가 한다.
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

export const weekdayOf = (day: string): string => WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()];

/** "12월 10일 (목)" */
export const dayLabel = (day: string): string => `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일 (${weekdayOf(day)})`;

/** "12/10" */
export const shortDay = (day: string): string => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

/** "2026년 12월" */
export const monthLabel = (month: string): string => `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;

export const WEEKDAYS = WEEKDAY;

export const AREA_NAME: Record<string, string> = { namba: '난바', shinsaibashi: '신사이바시', umeda: '우메다' };
