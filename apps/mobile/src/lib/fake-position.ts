// TASK-006 B7·§11 Q15·§12 R6: 데모 시계의 "코스대로" 위치. 같은 입력은 같은 출력인 순수 함수.
//  - 첫 일정 출발(시작 - travel_min) 전 = 숙소, 출발 뒤 시작 전 = 숙소 -> 1번을 이동 시간 비율로
//  - 일정 안 = 그 장소 (끝 시각 정각은 막 떠난 자리)
//  - 일정 사이 = 앞뒤 장소를 "빈 시간 전체"를 분모로 직선 보간
//  - 마지막 일정 뒤 = 마지막 장소 -> 숙소를 go_home_min 동안 보간, 그 뒤 숙소
import { minutesOfAt, toMinutes } from './demo-clock';

type Spot = { lat: number; lng: number };
export type FakeCourseItem = Spot & { start: string; end: string; travel_min: number };
// go_home_min이 null이면(숙소까지 시간을 아직 모름) 마지막 장소에 머문다 // 미정(TASK-006): 문서에 없는 경우
export type FakeCourse = { lodging: Spot; items: FakeCourseItem[]; go_home_min: number | null };

const between = (from: Spot, to: Spot, ratio: number): Spot => ({
  lat: from.lat + (to.lat - from.lat) * ratio,
  lng: from.lng + (to.lng - from.lng) * ratio,
});

export function fakePosition(at: string, course: FakeCourse): Spot | null {
  const now = minutesOfAt(at);
  const { items, lodging } = course;
  if (now === null || items.length === 0) return null;

  const first = items[0];
  const leave = toMinutes(first.start) - first.travel_min;
  if (now < leave) return { lat: lodging.lat, lng: lodging.lng };
  if (now < toMinutes(first.start)) return between(lodging, first, (now - leave) / first.travel_min);

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const [start, end] = [toMinutes(item.start), toMinutes(item.end)];
    if (now >= start && now < end) return { lat: item.lat, lng: item.lng };
    const next = items[i + 1];
    if (next && now >= end && now < toMinutes(next.start)) {
      return between(item, next, (now - end) / (toMinutes(next.start) - end));
    }
  }

  const last = items[items.length - 1];
  const passed = now - toMinutes(last.end);
  const home = course.go_home_min;
  if (home === null) return { lat: last.lat, lng: last.lng };
  if (home > 0 && passed < home) return between(last, lodging, passed / home);
  return { lat: lodging.lat, lng: lodging.lng };
}
