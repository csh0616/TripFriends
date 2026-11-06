// TASK-004 §B-5: WCAG 대비 계산 (G2 테스트용). 입력은 '#RRGGBB'
function channel(hex: string, start: number): number {
  const value = parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const text = hex.replace('#', '');
  return 0.2126 * channel(text, 0) + 0.7152 * channel(text, 2) + 0.0722 * channel(text, 4);
}

export function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
