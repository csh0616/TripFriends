// TASK-015 §28 질문 5: 지도 SDK가 그리는 Google 로고 자리 (화면 좌표, pt). 이름표가 로고 · 출처 표시를 가리지 않게 장애물로 쓴다 (순수 함수).
// 계약: __tests__/task-015-s26-pick-name-tag.test.tsx "§28 질문 5" 묶음
import type { MapPadding } from './map-project';
import type { Rect } from './pin-overlap';

/** 지도 화면 크기 size와 MapView mapPadding으로 Google 로고가 그려지는 사각형 (보이는 영역 왼쪽 아래 안쪽) */
export function googleLogoRect(size: { width: number; height: number }, padding: MapPadding): Rect {
  void size;
  void padding;
  throw new Error('not implemented');
}
