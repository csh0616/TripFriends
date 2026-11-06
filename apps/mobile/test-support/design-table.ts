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
};

// §4-2 글꼴 (이름 font-text, font-mono는 test-writer의 임시 이름. 문서에 토큰 이름이 없다: 질문 Q15)
export const FONTS: Record<string, string> = { 'font-text': 'Noto Sans KR', 'font-mono': 'DM Mono' };

// §4-2 크기 (필드 이름 size·lineHeight·weight·family는 임시)
export const TYPE: Record<string, { size: number; lineHeight: number; weight: number; family?: string }> = {
  'num-xl': { size: 44, lineHeight: 44, weight: 500, family: 'DM Mono' },
  title: { size: 22, lineHeight: 30, weight: 700 },
  heading: { size: 17, lineHeight: 24, weight: 600 },
  body: { size: 15, lineHeight: 22, weight: 400 },
  caption: { size: 13, lineHeight: 18, weight: 500 },
  label: { size: 12, lineHeight: 16, weight: 600 },
  'num-md': { size: 14, lineHeight: 20, weight: 500, family: 'DM Mono' },
};

// §4-3 숫자 토큰 (icon-stroke 이름은 임시. 문서는 "icon 24(선 1.75)")
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
  'r-sheet': 28,
  'dur-fast': 120,
  'dur-base': 200,
  'dur-sheet': 320,
  'dur-draw': 420,
};

// §4-3 글자 값
export const STRINGS: Record<string, string> = {
  'sh-float': '0 6px 20px rgba(26,26,26,.14), 0 1px 2px rgba(26,26,26,.08)',
  'sh-sheet': '0 -10px 32px rgba(26,26,26,.16)',
  'ease-out': 'cubic-bezier(.2,.8,.2,1)',
};

// 문서에 값이 없어 있는지만 보는 이름 (질문 Q15)
export const NAME_ONLY = ['r-full', 'sh-0'];
// §4-1의 sunset: sunset-start·end와 같은 값을 다른 이름으로 적었다. 있어도 되고 없어도 된다 (질문 Q15)
export const OPTIONAL = ['sunset'];

// §4-4 대비 표 (글자, 바탕, 문서의 숫자)
export const CONTRAST_PAIRS: [string, string, number][] = [
  ['ink', 'surface', 12.63],
  ['muted', 'surface', 5.26],
  ['muted', 'bg-2', 4.78],
  ['muted', 'brand-soft', 4.76],
  ['on-brand', 'brand', 5.56],
  ['ink', 'brand-soft', 11.43],
  ['ok', 'ok-bg', 4.57],
  ['warn', 'warn-bg', 6.37],
  ['alert', 'alert-bg', 4.52],
  ['surface', 'danger', 6.57], // SOS: 흰 글자 (§2)
];

// §4-4 탈락 조합 (글자, 바탕, 문서의 숫자)
export const REJECTED_PAIRS: [string, string, number][] = [
  ['#FFFFFF', '#FF5A00', 3.13],
  ['#333333', '#FF5A00', 4.04],
  ['#6B7280', '#F3F4F6', 4.39],
];
