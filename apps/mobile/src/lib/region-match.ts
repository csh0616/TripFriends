// TASK-015 §22 막는 2 (껍데기, test-writer): 크게 보기에서 맞춤 뒤 먼저 오는 "처음 영역" 알림을 거를 때 쓰는 영역 비교 (순수 함수). 지도 SDK를 모른다.
// 계약: __tests__/task-015-s22-region-match.test.ts
import type { Region, Size } from '@/lib/map-project';

/** 승현 11-17: "같은 영역" 허용 오차 = 화면 0.5pt (정각 0.5pt는 같음) */
export const SAME_REGION_TOLERANCE_PT = 0.5;

/**
 * base를 보이는 영역(size)에 그렸을 때, other의 가운데와 네 모서리가 base의 가운데 · 네 모서리에서 각각 SAME_REGION_TOLERANCE_PT 이내(거리, 이하)인가.
 * 가운데가 같아도 넓이(확대)가 다르면 모서리가 벌어져 false
 */
export function sameRegionOnScreen(_base: Region, _other: Region, _size: Size): boolean {
  throw new Error('not implemented');
}

/**
 * 지도가 region을 보이는 영역(size)에 실제로 보여 줄 때의 영역: 가운데 그대로, region이 다 들어오는 한 배율(가로 · 세로 중 작은 축척)로,
 * 남는 축의 폭만 넓힌다. size나 폭이 0 이하면 null
 */
export function shownRegion(_region: Region, _size: Size): Region | null {
  throw new Error('not implemented');
}
