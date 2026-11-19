// TASK-015 §28 질문 5: 지도 SDK가 그리는 Google 로고 자리 (화면 좌표, pt). 이름표가 로고 · 출처 표시를 가리지 않게 장애물로 쓴다 (순수 함수).
// 계약: __tests__/task-015-s26-pick-name-tag.test.tsx "§28 질문 5" 묶음
import type { MapPadding } from './map-project';
import type { Rect } from './pin-overlap';

// 로고 크기 · 안쪽 여백은 Google 지도 iOS SDK가 정해 문서에 없다. 11-18 iPhone 17 시뮬레이터(402×874, 3배) a2 화면 스크린샷 두 장
// (키보드 닫힘: mapPadding.bottom 258 · 키보드 열림: 띠 아래)에서 로고 바깥 테두리(진한 회색, 밝기 140 미만) 픽셀 범위를 잰 값 (px ÷ 3):
// 왼쪽 끝 = 보이는 영역 왼쪽 + 5 · 아래 끝 = 보이는 영역 아래 − 6 · 폭 58 · 높이 21. 두 장에서 같은 값(보이는 영역을 따라 움직임)
const LOGO_LEFT = 5;
const LOGO_BOTTOM = 6;
const LOGO_WIDTH = 58;
const LOGO_HEIGHT = 21;

/** 지도 화면 크기 size와 MapView mapPadding으로 Google 로고가 그려지는 사각형 (보이는 영역 왼쪽 아래 안쪽) */
export function googleLogoRect(size: { width: number; height: number }, padding: MapPadding): Rect {
  const visibleBottom = size.height - padding.bottom;
  return { x: padding.left + LOGO_LEFT, y: visibleBottom - LOGO_BOTTOM - LOGO_HEIGHT, width: LOGO_WIDTH, height: LOGO_HEIGHT };
}
