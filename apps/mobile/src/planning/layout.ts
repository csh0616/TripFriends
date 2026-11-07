// TASK-004 Q28: 레이아웃 크기 숫자(높이·너비·테두리 굵기·고리)를 모으는 유일한 파일.
// 글자 크기·줄 높이·모서리·색은 여기에 쓰지 않고 토큰(theme.ts)만 쓴다.
import tokens from 'design-tokens';

const touchMin = tokens.control['touch-min'];
const chip = tokens.control.chip;

export const layout = {
  // DESIGN-001 §4-3 / TASK-004 §B-3·§B-4
  header: 52, // 머리 높이
  tile: 108, // P1 사진 타일 높이
  photo: 316, // P2 후보 카드 사진 높이
  routeDiagram: 120, // P3 동선 그림 높이
  floatingBar: 72, // 떠 있는 줄 높이
  ringBrand: 2.5, // 고른 타일 고리: brand
  ringWhite: 2, // 고른 타일 고리: 흰색
  cardGutter: 72, // 후보 카드 폭 = 화면 폭 - 72 (다음 카드가 보인다)
  screenMargin: tokens.space['space-5'], // 화면 좌우 20
  // 이 앱에서 정한 크기
  pickedCircle: 40, // 떠 있는 줄의 담은 곳 동그라미
  pickedMark: 36, // 사진 위 담음 표시 동그라미
  numberCircle: 24, // P3 번호 원
  routePad: 24, // 동선 그림 안쪽 여백
  routeNode: 11, // 동선 번호 원 반지름
  routeHome: 12, // 동선 숙소 원 반지름 (지름 24, TASK-005 §9 Q15)
  routeHomeStroke: 2, // 숙소 원 테두리 // 미정(TASK-005)
  routeHomeIcon: 14, // 숙소 원 안의 집 아이콘
  courseRow: 52, // P3 코스 줄 높이 (TASK-005 B5)
  courseLine: 2, // 번호 원을 잇는 세로선
  emptyBorder: 1.5, // 떠 있는 줄 빈 자리 점선 굵기
  routeLine: 3, // 동선 선 굵기
  barHeight: 8, // 시간표 막대 굵기
  timeColumn: 48, // P3 시각 칸 폭 // 미정(TASK-005)
  stayColumn: 88, // P3 머문 시간 칸 폭 // 미정(TASK-005)
  logoWidth: 200, // S0 확정 로고 (원본 669x373)
  logoHeight: 112,
  markRing: 4, // 담음 표시 둘레에 그려지는 동그라미가 벌어진 정도
  checkSmall: 16, // 작은 체크 아이콘 (P1 고른 알약)
  successCheck: 36, // S9 체크 아이콘
  avatarEye: 4, // 친구 아바타 눈 지름
  avatarEyeGap: 8, // 눈 사이
  avatarMouthWidth: 12, // 입 폭
  avatarMouthHeight: 6, // 입 높이
  avatarLine: 2, // 입 선 굵기
  avatarFace: 3, // 눈·입 사이
  ringFrom: 0.9, // P1 고른 고리가 나타날 때 시작 크기 비율
  successCircle: 72, // S9 체크 원
  dot: 6, // 작은 점
  // TASK-006 D4: 시스템 글자 크기를 따르는 상한
  fontScaleMax: 1.3,
  // TASK-006 SC-04 여행 중 화면. 문서에 없는 크기는 §14 승인
  // 핀 크기는 DESIGN-001 §4-6 (토큰 map.pin-*). 누르는 영역은 모두 44
  pinLater: tokens.map['pin-later'],
  pinDone: tokens.map['pin-done'],
  pinNow: tokens.map['pin-now'],
  pinNext: tokens.map['pin-next'],
  pinRing: 3, // §14 승인: 다음 핀 brand 고리 굵기 (문서에 굵기 없음)
  pinBubble: 24, // §14 승인: 다음 핀 이름 말풍선 높이 (label 줄 높이 16 + 위아래 4)
  pinBubbleMax: 160, // §14 승인: 말풍선 최대 폭
  homePin: 28, // §14 승인: 지도 숙소 원 지름 (테두리는 routeHomeStroke)
  homeWall: [12, 8], // §14 승인: 지도 숙소 아이콘 벽 폭·높이 (Svg 없이 View로 그린다)
  homeRoof: 9, // §14 승인: 지붕 정사각형 한 변 (45도 돌려서 지붕 모양)
  homeStroke: 2, // §14 승인: 숙소 아이콘 선 굵기 (지도 쪽은 View 테두리라 icon-stroke를 못 쓴다)
  positionDot: 16, // §14 승인: 내 위치 ink 점 지름
  positionBorder: 3, // §14 승인: 내 위치 점의 흰 테두리
  mapDelta: 0.05, // §14 승인: 지도 첫 영역과 [내 위치] 확대 정도(도)
  routeDash: [8, 8], // §14 승인: 남은 길 점선 (선 길이, 빈 길이)
  sheetFractions: [0.16, 0.44, 0.88], // §14 승인: 시트 3단 높이(낮게·중간·높게)가 시트 영역에서 차지하는 비율
  sheetHandleWidth: 40, // §14 승인: 시트 손잡이
  sheetHandleHeight: 4,
  demoThumb: 20, // §14 승인: 데모 시각 막대의 손잡이 지름
  mapEdge: 60, // §14 승인: 카메라 맞춤 좌우 여백 (핀 반쪽 + 이름 말풍선이 잘리지 않게)
  // 누르는 영역 보강: 칩 36 -> 44
  chipSlop: (touchMin - chip) / 2,
} as const;
