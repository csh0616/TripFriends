// TASK-004 §B-5. 껍데기: 구현은 frontend가 한다.
export type LatLng = { lat: number; lng: number };

export function distanceLabel(_from: LatLng, _to: LatLng): string {
  throw new Error('not implemented');
}
