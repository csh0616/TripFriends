// B8: 하루 길이에서 고정 일정(하루 안에 걸친 부분만)과 꼭 갈 곳의 머문 시간을 뺀 비어 있는 시간 글자. 표시용 계산이다.
// 1시간 단위로 반올림하고 30분은 올린다(TASK-005 §9 Q6). 반올림 뒤 0 이하면 null(줄 숨김, §9 Q7).
// TASK-006 D2: 꼭 갈 곳의 머문 시간(stay_min, 서버 값)도 뺀다. 같은 장소의 고정 일정과 겹치면 긴 쪽만 뺀다 (§11 Q19, §12 R11).
import { timeToMinutes } from '@/planning/format';

type Span = { start: string; end: string };
type Fixed = Span & { place_id?: string | null };
type MustVisit = { place_id: string; stay_min: number };

export function freeHoursText(day: Span & { fixed: Fixed[]; must_visits?: MustVisit[] }): string | null {
  const dayStart = timeToMinutes(day.start);
  const dayEnd = timeToMinutes(day.end);
  // 하루 안쪽으로 자른 고정 일정 (장소 id를 같이 들고 있다)
  const clipped = day.fixed
    .map((item) => ({
      place_id: item.place_id ?? null,
      from: Math.max(dayStart, timeToMinutes(item.start)),
      to: Math.min(dayEnd, timeToMinutes(item.end)),
    }))
    .filter(({ from, to }) => to > from)
    .sort((a, b) => a.from - b.from);
  // 겹치는 고정 일정끼리 합친 뒤 길이를 센다
  let busy = 0;
  let reach = dayStart;
  for (const { from, to } of clipped) {
    const begin = Math.max(from, reach);
    if (to > begin) busy += to - begin;
    reach = Math.max(reach, to);
  }
  // 꼭 갈 곳: 같은 장소의 고정 일정이 있으면 그 길이를 넘는 만큼만 더 뺀다
  for (const must of day.must_visits ?? []) {
    const fixedLength = clipped
      .filter((item) => item.place_id !== null && item.place_id === must.place_id)
      .reduce((sum, item) => sum + (item.to - item.from), 0);
    busy += Math.max(0, must.stay_min - fixedLength);
  }
  const hours = Math.round((dayEnd - dayStart - busy) / 60);
  return hours > 0 ? `${hours}시간 비어 있어` : null;
}
