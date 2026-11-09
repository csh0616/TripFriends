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

/** 날짜 목록 머리의 작은 줄: "12월 11일 ~ 13일" (같은 달), 달이 다르면 "12월 30일 ~ 1월 2일" */
export const periodLabel = (start: string, end: string): string => {
  const [startMonth, endMonth] = [Number(start.slice(5, 7)), Number(end.slice(5, 7))];
  const endDate = Number(end.slice(8, 10));
  return `${startMonth}월 ${Number(start.slice(8, 10))}일 ~ ${startMonth === endMonth ? '' : `${endMonth}월 `}${endDate}일`;
};

/** 날 줄 요약 "18:30 끝 · 8곳 · 이동 125분" (서버 summary 그대로, 걷기 km는 데이터가 없어 쓰지 않는다) */
export const summaryLine = (summary: { end_time: string; place_count: number; move_min: number }): string =>
  `${summary.end_time} 끝 · ${summary.place_count}곳 · 이동 ${summary.move_min}분`;
