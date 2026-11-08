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
  sheetFractions: [0.16, 0.44, 0.88], // §14 승인: 시트 3단 높이(낮게·중간·높게)가 시트 영역에서 차지하는 비율
  sheetHandleWidth: 40, // §14 승인: 시트 손잡이
  sheetHandleHeight: 4,
  demoThumb: 20, // §14 승인: 데모 시각 막대의 손잡이 지름
  mapEdge: 60, // §14 승인: 카메라 맞춤 좌우 여백 (핀 반쪽 + 이름 말풍선이 잘리지 않게)
  // TASK-009 / DESIGN-001 §4-7 고르기 방식. 값은 tokens.json(select)에서 읽는다 (TASK-010 §E1)
  radio: tokens.select.radio, // 칸의 선택 표시
  actionBar: tokens.select['action-bar'], // 시트 아래 확정 버튼 줄
  rowAlt: tokens.select['row-alt'], // T-06 대안 칸
  rowDrop: tokens.select['row-drop'], // T-06 [빼고 가기] 칸
  thumbSm: tokens.select['thumb-sm'], // 칸 안 사진 자리
  selRing: Number(/(\d+(?:\.\d+)?)px/.exec(tokens.select['sel-ring'])?.[1]), // sel-ring: 고른 칸 안쪽 고리 굵기 (색은 brand, 바탕 sel-bg)
  actionBarLine: 1, // action-bar 윗선 굵기 (문서에 없는 크기)
  radioDot: 12, // 고른 radio 안 채움 지름 (문서에 없는 크기)
  // TASK-010 DESIGN-001 §4-10 여행 만들기 부품. 값은 tokens.json(trip)에서 읽는다 (TASK-010 §13 질문 3)
  sheetCal: tokens.trip['sheet-cal'], // 달력 시트 높이 상한 (짧은 화면은 min(626, 화면 높이 - 48))
  sheetCalMargin: 48,
  calCellW: tokens.trip['cal-cell'][0], // 날 칸 누르는 영역
  calCellH: tokens.trip['cal-cell'][1],
  calDisc: tokens.trip['cal-disc'][0], // 가는 날·오는 날 원
  calRing: tokens.trip['cal-disc'][1],
  calOff: tokens.trip['cal-off'][0], // 고를 수 없는 날
  calBand: tokens.trip['cal-band'], // 범위 띠
  calTodayDot: tokens.trip['cal-today-dot'],
  calHead: tokens.trip['cal-head'], // 요일 줄
  calNav: tokens.trip['cal-nav'][0], // 달 넘기기 (누르는 영역은 cal-nav[1])
  calSlot: tokens.trip['cal-slot'], // 안내 자리
  calHandle: 20, // 시트 핸들 자리
  calTitle: 44,
  coverTile: tokens.trip['cover-tile'], // 도시 카드 폭·높이
  coverBanner: tokens.trip['cover-banner'], // 여행 머리 표지
  coverGlyphTile: 64,
  coverGlyphBanner: 56,
  coverGlyphLarge: 120,
  coverLine: 2.4,
  coverLineLarge: 3.4,
  coverLineBanner: 2.2,
  glyphFillOpacity: 0.24, // cat-glyph-fill: 흰색 24%
  sunX: 38, // 해 중심 (도시 그림 파일의 160칸 좌표)
  sunY: 42,
  sunRadius: 13,
  waveStroke: 2.5,
  sunOpacity: 0.3, // city-pat: 해 흰색 30%
  waveOpacity: [0.26, 0.2, 0.15], // 물결 세 겹
  coverUnit: 160, // 도시 그림 파일의 좌표 칸 (316 = 160 x 1.975)
  iconGrid: 24, // 그림 24칸
  glyphLine: 1.75, // 장소 그림 선 (icon-stroke와 같음)
  field: tokens.select.field, // 날짜·시각·제목 입력 칸 높이
  tabDay: tokens.select['tab-day'][0], // 날 탭 보이는 높이 (누르는 영역 tab-day[1])
  addDot: tokens.trip['add-dot'], // 담기 표시 원
  listRow: 64, // 검색 결과 줄
  listMax: tokens.trip['list-max'], // 보이는 결과 5줄
  listHairInset: 66, // 결과 줄 사이 선의 왼쪽
  lodgeThumb: tokens.trip['lodge-thumb'],
  lodgeIcon: 24,
  emptyDot: tokens.trip['lodge-thumb'], // 결과 없음 원
  otherDayPill: 28,
  googleLogoWidth: 98, // GoogleMaps_Logo_Gray 원본 98x18 (높이 18, 비율 유지)
  googleLogoHeight: 18,
  googleSlot: tokens.trip['g-slot'][1], // g-slot / g-text 겉 높이 (그림 19)
  googleFooter: tokens.trip['g-footer'], // g-footer
  googleFooterTop: 10,
  googleFooterBottom: 5,
  sheetForm: tokens.select['sheet-form'], // 고정 일정 입력 시트
  rowPast: 68, // 날 줄 높이: 지난 날
  rowPlanned: 84, // 계획 완료
  inputFocus: Number(/(\d+(?:\.\d+)?)px/.exec(tokens.trip['input-focus'])?.[1]), // input-focus 안쪽 굵기
  fieldErrorLine: 2,
  // 누르는 영역 보강: 칩 36 -> 44
  chipSlop: (touchMin - chip) / 2,
} as const;
