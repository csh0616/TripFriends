// TASK-004 §B-5, §12 Q12: 위도/경도 목록을 상자 안 좌표로. 북쪽이 위, 동쪽이 오른쪽.
// 도식이라서 가로·세로를 각각 상자에 맞춰 늘린다 (모든 점이 반드시 상자 안, 0으로 나누지 않음).
export function projectRoute(
  points: readonly { lat: number; lng: number }[],
  w: number,
  h: number,
  pad: number,
): { x: number; y: number }[] {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const innerW = w - 2 * pad;
  const innerH = h - 2 * pad;

  const place = (value: number, min: number, max: number, inner: number, start: number, flip: boolean) => {
    if (max === min) return start + inner / 2;
    const ratio = (value - min) / (max - min);
    return start + (flip ? 1 - ratio : ratio) * inner;
  };

  return points.map((p) => ({
    x: place(p.lng, minLng, maxLng, innerW, pad, false),
    y: place(p.lat, minLat, maxLat, innerH, pad, true),
  }));
}
