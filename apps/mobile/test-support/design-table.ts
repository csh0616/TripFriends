// DESIGN-001에서 옮겨 적은 표 (유일한 출처). 값을 고칠 때는 문서를 먼저 고친다.
// §1·§2·§4-1 색
export const COLORS: Record<string, string> = {
  brand: '#FF5A00',
  'brand-soft': '#FFF1E8',
  'sunset-start': '#FF8C42',
  'sunset-end': '#FFA140',
  ink: '#333333',
  muted: '#666C7A',
  line: '#E5E7EB',
  'bg-2': '#F3F4F6',
  surface: '#FFFFFF',
  'on-brand': '#1A1A1A',
  ok: '#15803D',
  'ok-bg': '#DCFCE7',
  warn: '#92400E',
  'warn-bg': '#FEF3C7',
  alert: '#C2410C',
  'alert-bg': '#FFEDD5',
  danger: '#B42318',
  // §4-6 지도·핀·앱 아이콘 (v2.4)
  'map-land': '#EEF0F2',
  'map-building': '#E6E9ED',
  'map-park': '#E3EBE0',
  'map-water': '#DDE6EE',
  'map-edge': '#E2E5E9',
  'map-edge-big': '#CDD2D9',
  'map-label': '#5F6573',
  'route-done': '#7C828F',
  'ink-strong': '#1A1A1A',
  // §4-7 고르기·입력 (11-09, TASK-010 §E1): sel-bg = brand-soft, field-error-bg/field-error = alert-bg/alert (별명)
  'sel-bg': '#FFF1E8',
  'field-error-bg': '#FFEDD5',
  'field-error': '#C2410C',
  // §4-10 여행 만들기 부품 (TASK-010 §13 질문 3): 도시 표지 = cat-landmark 별명
  'city-osaka-a': '#87919C',
  'city-osaka-b': '#576069',
};

// §4-3 글꼴 이름 (Q15)
export const FONTS: Record<string, string> = { 'font-text': 'Noto Sans KR', 'font-mono': 'DM Mono' };

// §4-2 크기 (필드 이름 size·lineHeight·weight·family는 §12-3에서 계약으로 승인)
export const TYPE: Record<string, { size: number; lineHeight: number; weight: number; family?: string; color?: string }> = {
  'num-xl': { size: 44, lineHeight: 44, weight: 500, family: 'DM Mono' },
  title: { size: 22, lineHeight: 30, weight: 700 },
  heading: { size: 17, lineHeight: 24, weight: 600 },
  body: { size: 15, lineHeight: 22, weight: 400 },
  caption: { size: 13, lineHeight: 18, weight: 500 },
  label: { size: 12, lineHeight: 16, weight: 600 },
  'num-md': { size: 14, lineHeight: 20, weight: 500, family: 'DM Mono' },
  // §4-10 출처 글자 (TASK-010 §13 질문 3)
  src: { size: 12, lineHeight: 16, weight: 500 },
  'src-google': { size: 12, lineHeight: 16, weight: 400, family: 'Roboto', color: '#5E5E5E' },
};

// §4-3 숫자 토큰 (Q15 r-full·icon-stroke, Q28 r-xl·r-tail)
export const NUMBERS: Record<string, number> = {
  'space-1': 4,
  'space-2': 8,
  'space-3': 12,
  'space-4': 16,
  'space-5': 20,
  'space-6': 24,
  'space-8': 32,
  'space-10': 40,
  'touch-min': 44,
  btn: 52,
  'btn-sm': 44,
  chip: 36,
  input: 48,
  sos: 44,
  avatar: 32,
  icon: 24,
  'icon-stroke': 1.75,
  'r-xs': 8,
  'r-sm': 12,
  'r-md': 16,
  'r-lg': 20,
  'r-xl': 24,
  'r-sheet': 28,
  'r-full': 999,
  'r-tail': 6,
  'dur-fast': 120,
  'dur-base': 200,
  'dur-sheet': 320,
  'dur-draw': 420,
  // §4-6 핀·동선 (v2.4)
  'pin-later': 28,
  'pin-done': 32,
  'pin-now': 32,
  'pin-next': 36,
  'route-width': 5,
  'route-casing': 9,
  // §4-7 고르기·입력 (11-09, TASK-010 §E1)
  radio: 24,
  'action-bar': 68,
  'row-alt': 64,
  'row-drop': 52,
  'thumb-sm': 44,
  field: 64,
  'notice-limit': 16, // 넘침 안내 상자 모서리
  'sheet-form': 500,
  // §4-10 여행 만들기 부품 (TASK-010 §13 질문 3)
  'sheet-cal': 626,
  'cal-band': 38,
  'cal-today-dot': 4,
  'cal-head': 28,
  'cal-slot': 60,
  'input-icon': 20,
  'add-dot': 36,
  'lodge-thumb': 44,
  'list-max': 324,
  'g-footer': 34,
};

// §4-6 목록 값: route-dash = 선 길이, 빈 길이
export const LISTS: Record<string, number[]> = {
  'route-dash': [10, 8],
  'tab-day': [36, 44], // §4-7: [보이는 높이, 누르는 높이]
  // §4-10 (TASK-010 §13 질문 3): 크기 두 개는 [폭, 높이] 또는 [보이는, 누르는]
  'cal-cell': [50, 44],
  'cal-disc': [38, 2], // [원 지름, 고리 굵기]
  'cal-off': [40, 40],
  'cal-nav': [36, 44],
  'g-slot': [16, 19], // [가장 낮은, 가장 높은] 높이
  'cover-lg': [316, 316],
  'cover-tile': [120, 144],
  'cover-banner': [350, 88],
};

// §4-9 날 상태 알약 색 (11-09, TASK-010 §14 답 2). 필드 이름 bg·fg는 trip-days.tsx PILL_LOOK을 따름, border·dot은 이 테스트가 정한 이름(승인 대기)
// bg = 바탕, fg = 글자·아이콘, border = 테두리 1px (pill-today는 "없음" → 키 없음), dot = 점선 동그라미 (pill-planning만)
export const PILLS: Record<string, { bg: string; fg: string; border?: string; dot?: string }> = {
  'pill-planning': { bg: '#FFFFFF', fg: '#333333', border: '#666C7A', dot: '#666C7A' },
  'pill-planned': { bg: '#DCFCE7', fg: '#15803D', border: '#15803D' },
  'pill-today': { bg: '#1A1A1A', fg: '#FFFFFF' },
  'pill-past': { bg: '#D1D5DB', fg: '#333333', border: '#666C7A' },
};

// §4-11 디자인 맞추기 (TASK-011 B1). 한 토큰에 값이 여럿이라 묶음으로 둔다. 필드 이름은 이 테스트가 정한 이름(승인 대기).
// 색은 §4-11 표의 값 그대로(별명이 아니라 실제 값). 문서에 없는 칸은 키도 없다.
//   bg 바탕 · fg 글자 · border 테두리 색 · borderWidth 테두리 굵기 · height 높이 · minHeight 최소 높이 · hit 누르는 높이 · radius 모서리
//   size/lineHeight/weight/family 글자 · icon 아이콘 크기 · paddingVertical/paddingHorizontal 안쪽 ("안쪽 6/12" = 위아래 6, 좌우 12)
export const FIT: Record<string, Record<string, unknown>> = {
  // 투명 · 높이 44 · 안쪽 6/12 · 아이콘 20 + "날짜" 15/22·600 ink-strong · 비활성 bg-2 + muted · 머리 칸 [84 | 1fr | 84]
  'back-day': {
    bg: 'transparent',
    height: 44,
    paddingVertical: 6,
    paddingHorizontal: 12,
    icon: 20,
    size: 15,
    lineHeight: 22,
    weight: 600,
    fg: '#1A1A1A',
    disabledBg: '#F3F4F6',
    disabledFg: '#666C7A',
    side: 84, // 머리 양옆 칸 폭 (가운데는 나머지)
  },
  // 높이 52 이상 · 번호 원 28 · 이름 15/22·600 · 보조 13/18 muted 한 줄(…)
  'row-read': {
    minHeight: 52,
    badge: 28,
    name: { size: 15, lineHeight: 22, weight: 600 },
    sub: { size: 13, lineHeight: 18, weight: 500 }, // TASK-011 §9 Q14
    subFg: '#666C7A',
    subLines: 1,
  },
  // 12/16 · 500 · muted
  'read-note': { size: 12, lineHeight: 16, weight: 500, fg: '#666C7A' },
  // 높이 36 (누르는 44) · 흰 바탕 · 테두리 1px #666C7A · 13/18·600 ink-strong · r999 · + 16
  'btn-add-event': {
    height: 36,
    hit: 44,
    bg: '#FFFFFF',
    borderWidth: 1,
    border: '#666C7A',
    size: 13,
    lineHeight: 18,
    weight: 600,
    fg: '#1A1A1A',
    radius: 999,
    icon: 16,
  },
  // 350(화면 − 40) × 52 · bg-2 · 15/22·600 ink-strong · r16 · 내용이 짧으면 화면 맨 아래(아래 34)까지 (TASK-011 §10 E3)
  // 너비는 "화면 − 40"이라 고정 값으로 두지 않는다. bottom = 맨 아래 여백
  'btn-new-trip': { height: 52, bottom: 34, bg: '#F3F4F6', size: 15, lineHeight: 22, weight: 600, fg: '#1A1A1A', radius: 16 },
  // scrim 40% · r-sheet 28 · 손잡이 36×4 · 글 17/24·700 · 한 줄 14/20·500 #333333 (글 아래 4) · 버튼 52 + 52 세로 (한 줄 아래 16), 사이 8 · 아래 34 · 높이 234
  'sheet-confirm': {
    scrim: 'rgba(26,26,26,0.40)', // §4-1 scrim과 같은 값
    radius: 28,
    handle: [36, 4],
    size: 17,
    lineHeight: 24,
    weight: 700,
    note: { size: 14, lineHeight: 20, weight: 500, fg: '#333333', top: 4 }, // TASK-011 §10 E4 (muted 아님)
    button: 52,
    buttonTop: 16, // 한 줄 아래
    gap: 8,
    bottom: 34,
    height: 234,
  },
  // TASK-011 §12 Q1: 28/36 · 700 · ink-strong · 왼쪽 정렬 (날짜 목록 머리 제목 "오사카 2박 3일")
  'title-trip': { size: 28, lineHeight: 36, weight: 700, fg: '#1A1A1A', align: 'left' },
  // TASK-011 §10 E1·E6: 원 40 bg-2 + 체크 20 · 제목 17/24·700 · 설명 14/20·500 #333333 폭 300 · 가운데 · 마지막 날 줄 아래 20
  'end-note': {
    circle: 40,
    circleBg: '#F3F4F6',
    icon: 20,
    title: { size: 17, lineHeight: 24, weight: 700 },
    body: { size: 14, lineHeight: 20, weight: 500, fg: '#333333' },
    width: 300,
    top: 20,
  },
  // 칩 · 값 · 거리 한 줄(24) + 출처 줄 4px 아래(19) · 값 자리 "늘 열려 있어" 14/20·500 · 시각 범위 엔 대시
  'fact-line': {
    height: 24,
    sourceGap: 4,
    sourceHeight: 19,
    value: { size: 14, lineHeight: 20, weight: 500 },
    rangeDash: '–',
  },
  // 흰 바탕 · 테두리 1px #666C7A · 큰 [같이 고르기] 52 17/24·700 · [알아서 짜 줘] 52 15/22·600 · 작은 [같이 고르기] 44
  'btn-card-secondary': {
    bg: '#FFFFFF',
    borderWidth: 1,
    border: '#666C7A',
    large: { height: 52, size: 17, lineHeight: 24, weight: 700 },
    auto: { height: 52, size: 15, lineHeight: 22, weight: 600 },
    small: { height: 44, size: 15, lineHeight: 22, weight: 600 }, // TASK-011 §9 Q14
  },
  // 주황 #FF5A00 · 52 · 17/24·700 on-brand #1A1A1A · 밑 한 줄 12/16·500 muted
  'bottom-primary': {
    bg: '#FF5A00',
    height: 52,
    size: 17,
    lineHeight: 24,
    weight: 700,
    fg: '#1A1A1A',
    sub: { size: 12, lineHeight: 16, weight: 500, fg: '#666C7A' },
  },
  // 높이 24 · 흰 바탕 · 테두리 1px #666C7A · 글자 #333333 12/16·600 · 시계 14 · r999
  'chip-hint': {
    height: 24,
    bg: '#FFFFFF',
    borderWidth: 1,
    border: '#666C7A',
    fg: '#333333',
    size: 12,
    lineHeight: 16,
    weight: 600,
    icon: 14,
    radius: 999,
  },
  // 높이 24 · 안쪽 10 · 흰 바탕 · 글자 #1A1A1A · DM Mono 12 · r999 ("안쪽 10"은 높이 24라 좌우로 읽음)
  'pill-count': { height: 24, paddingHorizontal: 10, bg: '#FFFFFF', fg: '#1A1A1A', family: 'DM Mono', size: 12, radius: 999 },
};

// §4-3 글자 값
export const STRINGS: Record<string, string> = {
  'sh-0': 'none', // Q15
  'sh-float': '0 6px 20px rgba(26,26,26,.14), 0 1px 2px rgba(26,26,26,.08)',
  'sh-sheet': '0 -10px 32px rgba(26,26,26,.16)',
  'sh-raise': '0 1px 2px rgba(26,26,26,.08), 0 2px 8px rgba(26,26,26,.08)', // v2.3, TASK-005 §9 Q14
  'ease-out': 'cubic-bezier(.2,.8,.2,1)',
  'sel-ring': 'inset 0 0 0 2px #FF5A00',
  'input-focus': 'inset 0 0 0 2px #1A1A1A', // §4-10: 안쪽 2px ink-strong // §4-7: 안쪽 2px brand (§4-3 선 표기 'inset 0 0 0 1px'와 같은 모양)
  scrim: 'rgba(26,26,26,0.40)', // §4-1 v2.2, TASK-004 §13-3 #2
};

// §4-4 대비 표 (글자, 바탕, 문서의 숫자)
export const CONTRAST_PAIRS: [string, string, number][] = [
  ['ink', 'surface', 12.63],
  ['ink', 'bg-2', 11.48], // Q15
  ['muted', 'surface', 5.26],
  ['muted', 'bg-2', 4.78],
  ['muted', 'brand-soft', 4.76],
  ['on-brand', 'brand', 5.56],
  ['ink', 'brand-soft', 11.43],
  ['ok', 'ok-bg', 4.57],
  ['warn', 'warn-bg', 6.37],
  ['alert', 'alert-bg', 4.52],
  ['surface', 'danger', 6.57], // SOS: 흰 글자 (§2)
  // §4-6 지도 글자
  ['map-label', 'map-land', 5.11],
  ['map-label', 'map-building', 4.8],
  ['map-label', 'map-park', 4.79],
  ['map-label', 'map-water', 4.62],
];

// §4-4 탈락 조합 (글자, 바탕, 문서의 숫자)
export const REJECTED_PAIRS: [string, string, number][] = [
  ['#FFFFFF', '#FF5A00', 3.13],
  ['#333333', '#FF5A00', 4.04],
  ['#6B7280', '#F3F4F6', 4.39],
  // §4-6: 땅 위 주황은 흰 테두리 없이 쓰지 않는다, line 트랙 위 주황 금지, muted는 지도 위 글자로 쓰지 않는다
  ['#FF5A00', '#EEF0F2', 2.74],
  ['#FF5A00', '#E5E7EB', 2.53],
  ['#666C7A', '#E6E9ED', 4.32],
  ['#666C7A', '#DDE6EE', 4.17],
];

// §4-12 계정 연결 (11-09, TASK-012 2단계). 값의 정본은 docs/design/reviews/task-012-design.md §2·§3·§4·§8 (DESIGN-001 §4-12가 가리킴).
// 토큰 이름 5개는 §4-12 표 그대로. 필드 이름은 이 테스트가 정한 이름(승인 대기), FIT과 같은 뜻으로 쓴다:
//   bg 바탕 · fg 글자 · border 테두리 색 · borderWidth 테두리 굵기 · height 높이 · radius 모서리 · size/lineHeight/weight 글자 · icon 아이콘 크기
//   paddingLeft/paddingRight/paddingVertical/paddingHorizontal 안쪽 ("안쪽 14/16" = 위아래 14, 좌우 16) · 문서에 없는 칸은 키도 없다
export const ACCOUNT: Record<string, Record<string, unknown>> = {
  // 리뷰 §2: 밝은 모양 흰 바탕 · 테두리 #747775 1px · 글자 #1F1F1F 14/20 Medium(500) · G 20 · iOS 안쪽 왼쪽 16 · G 오른쪽 12 · 글자 오른쪽 16
  //          높이 52 · 모서리 16 (문구는 화면 테스트가 본다). 글꼴 이름은 문서끼리 달라(Roboto / Google Sans) 넣지 않는다 (질문)
  'google-btn': {
    bg: '#FFFFFF',
    border: '#747775',
    borderWidth: 1,
    fg: '#1F1F1F',
    size: 14,
    lineHeight: 20,
    weight: 500,
    logo: 20,
    paddingLeft: 16,
    logoGap: 12,
    paddingRight: 16,
    height: 52,
    radius: 16,
  },
  // 리뷰 §4: 카드 bg-2 · 모서리 20 · 안쪽 14/16 · 아바타 흰 원 44
  'acct-card': { bg: '#F3F4F6', radius: 20, paddingVertical: 14, paddingHorizontal: 16, avatar: 44, avatarBg: '#FFFFFF' },
  // 리뷰 §4: 칸 높이 84 · 안쪽 좌 12 · 우 14 · 썸네일 44 · 고르면 sel-bg + 안쪽 2px #FF5A00 고리 + radio 24
  //          3줄: 어디서 온 여행 12/16·600·muted / 이름 15/22·600 / 날짜 · 진행 12/16·500·muted
  'trip-pick': {
    height: 84,
    paddingLeft: 12,
    paddingRight: 14,
    thumb: 44,
    selBg: '#FFF1E8',
    ring: 'inset 0 0 0 2px #FF5A00',
    radio: 24,
    origin: { size: 12, lineHeight: 16, weight: 600, fg: '#666C7A' },
    name: { size: 15, lineHeight: 22, weight: 600 },
    meta: { size: 12, lineHeight: 16, weight: 500, fg: '#666C7A' },
  },
  // 리뷰 §8-4: 한 줄 44 · r16 · #FFEDD5 · 안쪽 좌우 12 · 경고 16 #C2410C · 13/18·700 #1A1A1A · 머리 아래 8 · 좌우 20 · 그림자(sh-float와 같은 값) · 6초
  'notice-fail': {
    height: 44,
    radius: 16,
    bg: '#FFEDD5',
    paddingHorizontal: 12,
    icon: 16,
    iconFg: '#C2410C',
    size: 13,
    lineHeight: 18,
    weight: 700,
    fg: '#1A1A1A',
    top: 8,
    side: 20,
    shadow: '0 6px 20px rgba(26,26,26,.14), 0 1px 2px rgba(26,26,26,.08)',
    duration: 6000,
  },
  // 리뷰 §8-2: 44×44 원 · bg-2 · 사람 아이콘 #333333 · 머리 왼쪽 16
  'head-avatar': { size: 44, bg: '#F3F4F6', fg: '#333333', left: 16 },
};
