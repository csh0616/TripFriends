// B8: 하루 길이에서 고정 일정(하루 안에 걸친 부분만)을 뺀 비어 있는 시간 글자. 표시용 계산이다.
// 1시간 단위로 반올림하고 30분은 올린다(TASK-005 §9 Q6). 반올림 뒤 0 이하면 null(줄 숨김, §9 Q7).
import { timeToMinutes } from '@/planning/format';

type Span = { start: string; end: string };

export function freeHoursText(day: Span & { fixed: Span[] }): string | null {
  const dayStart = timeToMinutes(day.start);
  const dayEnd = timeToMinutes(day.end);
  // 하루 안쪽으로 잘라 겹치는 구간끼리 합친 뒤 길이를 센다
  const inside = day.fixed
    .map((item) => [Math.max(dayStart, timeToMinutes(item.start)), Math.min(dayEnd, timeToMinutes(item.end))] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  let busy = 0;
  let reach = dayStart;
  for (const [from, to] of inside) {
    const begin = Math.max(from, reach);
    if (to > begin) busy += to - begin;
    reach = Math.max(reach, to);
  }
  const hours = Math.round((dayEnd - dayStart - busy) / 60);
  return hours > 0 ? `${hours}시간 비어 있어` : null;
}
