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
};

// §4-3 글꼴 이름 (Q15)
export const FONTS: Record<string, string> = { 'font-text': 'Noto Sans KR', 'font-mono': 'DM Mono' };

// §4-2 크기 (필드 이름 size·lineHeight·weight·family는 §12-3에서 계약으로 승인)
export const TYPE: Record<string, { size: number; lineHeight: number; weight: number; family?: string }> = {
  'num-xl': { size: 44, lineHeight: 44, weight: 500, family: 'DM Mono' },
  title: { size: 22, lineHeight: 30, weight: 700 },
  heading: { size: 17, lineHeight: 24, weight: 600 },
  body: { size: 15, lineHeight: 22, weight: 400 },
  caption: { size: 13, lineHeight: 18, weight: 500 },
  label: { size: 12, lineHeight: 16, weight: 600 },
  'num-md': { size: 14, lineHeight: 20, weight: 500, family: 'DM Mono' },
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
};

// §4-6 목록 값: route-dash = 선 길이, 빈 길이
export const LISTS: Record<string, number[]> = { 'route-dash': [10, 8] };

// §4-3 글자 값
export const STRINGS: Record<string, string> = {
  'sh-0': 'none', // Q15
  'sh-float': '0 6px 20px rgba(26,26,26,.14), 0 1px 2px rgba(26,26,26,.08)',
  'sh-sheet': '0 -10px 32px rgba(26,26,26,.16)',
  'sh-raise': '0 1px 2px rgba(26,26,26,.08), 0 2px 8px rgba(26,26,26,.08)', // v2.3, TASK-005 §9 Q14
  'ease-out': 'cubic-bezier(.2,.8,.2,1)',
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
