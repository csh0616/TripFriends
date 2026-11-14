// TASK-014 §21 1·§22 Q2: 연습 지도는 "지금 구간"만 비춘다.
//   머무는 중(state "now" 핀이 있음): 그 장소 가운데, 동서 약 800m
//   이동 중: 지금 자리(응답 position) + 출발(마지막 지난 핀, 없으면 숙소) + 도착(다음 핀, 없으면 숙소)
// 구간 키가 같으면(같은 구간 안에서 시각만 바뀜) 다시 맞추지 않는다. 구간이 바뀌면 다시 맞춘다.
import type { NowPin } from '@/lib/now-api';

export type FitPoint = { latitude: number; longitude: number };
type At = { lat: number; lng: number };

const STAY_SPAN_M = 800;
const METERS_PER_DEGREE = (Math.PI / 180) * 6371000;

const asPoint = (at: At): FitPoint => ({ latitude: at.lat, longitude: at.lng });

export function rehearsalFit(pins: NowPin[], position: At | null, lodging: At): { key: string; coordinates: FitPoint[] } {
  const now = pins.find((pin) => pin.state === 'now');
  if (now) {
    const half = STAY_SPAN_M / 2;
    const dLat = half / METERS_PER_DEGREE;
    const dLng = half / (METERS_PER_DEGREE * Math.cos((now.lat * Math.PI) / 180));
    return {
      key: `stay-${now.seq}`,
      coordinates: [
        { latitude: now.lat - dLat, longitude: now.lng - dLng },
        { latitude: now.lat + dLat, longitude: now.lng + dLng },
      ],
    };
  }
  const done = pins.filter((pin) => pin.state === 'done');
  const from = done.length > 0 ? done.reduce((a, b) => (b.seq > a.seq ? b : a)) : null;
  const to = pins.find((pin) => pin.state === 'next') ?? null;
  const coordinates = [from ? asPoint(from) : asPoint(lodging), to ? asPoint(to) : asPoint(lodging)];
  if (position) coordinates.unshift(asPoint(position));
  return { key: `move-${from ? from.seq : 'home'}-${to ? to.seq : 'home'}`, coordinates };
}
