// TASK-004 §B-5. 껍데기: 구현은 frontend가 한다.
export function projectRoute(
  _points: readonly { lat: number; lng: number }[],
  _w: number,
  _h: number,
  _pad: number,
): { x: number; y: number }[] {
  throw new Error('not implemented');
}
