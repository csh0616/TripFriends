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
  pickedOverlap: 12, // 동그라미가 겹치는 정도
  pickedMark: 36, // 사진 위 담음 표시 동그라미
  numberCircle: 24, // P3 번호 원
  routePad: 24, // 동선 그림 안쪽 여백
  routeNode: 11, // 동선 번호 원 반지름
  routeHome: 8, // 동선 숙소 표시 반지름
  routeLine: 3, // 동선 선 굵기
  barHeight: 8, // 시간표 막대 굵기
  timeColumn: 48, // P3 시각 칸 폭
  stayColumn: 88, // P3 머문 시간 칸 폭
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
  // 누르는 영역 보강: 칩 36 -> 44
  chipSlop: (touchMin - chip) / 2,
} as const;
