// 토큰(packages/design-tokens)을 React Native 스타일로 옮긴다. 화면 코드는 색·글자 크기·모서리를 여기서만 가져온다.
import type { TextStyle, ViewStyle } from 'react-native';
import tokens from 'design-tokens';


export const color = tokens.color;
export const space = tokens.space;
export const control = tokens.control;
export const radius = tokens.radius;
export const motion = tokens.motion;
/** TASK-011 DESIGN-001 §4-11 디자인 맞추기 토큰 12개 (한 토큰에 값이 여럿이라 묶음) */
export const fit = tokens.fit;

export type TypeName = keyof typeof tokens.type;

// @expo-google-fonts가 등록하는 글꼴 이름. RN은 굵기를 글꼴 이름으로 고른다.
const NOTO: Record<number, string> = {
  400: 'NotoSansKR_400Regular',
  500: 'NotoSansKR_500Medium',
  600: 'NotoSansKR_600SemiBold',
  700: 'NotoSansKR_700Bold',
};
const MONO: Record<number, string> = { 500: 'DMMono_500Medium' };

/** 글자 토큰 -> 글꼴·크기·줄 높이. 글꼴을 못 읽으면 시스템 글꼴로 보인다(막지 않음). */
export function text(name: TypeName, tone: keyof typeof tokens.color = 'ink'): TextStyle {
  const spec: { size: number; lineHeight: number; weight: number; family?: string } = tokens.type[name];
  const mono = spec.family === tokens.font['font-mono'];
  return {
    fontFamily: (mono ? MONO : NOTO)[spec.weight],
    fontSize: spec.size,
    lineHeight: spec.lineHeight,
    color: color[tone],
  };
}

/** §4-11 토큰 안의 글자 값({size, lineHeight, weight, family, fg}) -> 글꼴·크기·색. 줄 높이·굵기가 없으면 label(12/16)·500 */
export function fitText(spec: { size: number; lineHeight?: number; weight?: number; family?: string; fg?: string }, tone: keyof typeof tokens.color = 'ink'): TextStyle {
  const weight = spec.weight ?? 500;
  const mono = spec.family === tokens.font['font-mono'];
  return {
    fontFamily: (mono ? MONO : NOTO)[weight],
    fontSize: spec.size,
    lineHeight: spec.lineHeight ?? tokens.type.label.lineHeight,
    color: spec.fg ?? color[tone],
  };
}

/** 토큰의 그림자 글자("x y 번짐 색(r,g,b,알파)")에서 첫 겹을 RN 그림자로 옮긴다. 색은 같은 값인 on-brand 토큰을 쓴다. */
function shadowFrom(spec: string): ViewStyle {
  // 토큰은 "0 6px 20px ..."처럼 0에는 px가 없다. 그래서 앞 두 값의 px는 있어도 없어도 된다.
  const first = /(-?\d+(?:\.\d+)?)(?:px)?\s+(-?\d+(?:\.\d+)?)(?:px)?\s+(\d+(?:\.\d+)?)px\s+\w+\([^)]*,\s*(\.?\d+(?:\.\d+)?)\)/.exec(spec);
  if (!first) return {};
  const [, x, y, blur, alpha] = first.map(Number);
  return {
    shadowColor: color['on-brand'],
    shadowOffset: { width: x, height: y },
    shadowOpacity: alpha,
    shadowRadius: blur / 2,
    elevation: Math.round(blur / 3),
  };
}

/** 굵은 글자(700): 토큰 type에 없는 굵기가 필요한 곳(B4 토글 고른 칸)에서만 쓴다 */
export function bold(name: TypeName, tone: keyof typeof tokens.color = 'ink'): TextStyle {
  return { ...text(name, tone), fontFamily: NOTO[700] };
}

// 미정(TASK-005): sh-raise는 두 겹 중 첫 겹만 RN 그림자로 옮긴다 (shadowFrom이 첫 겹만 읽음)
export const shadow = {
  float: shadowFrom(tokens.shadow['sh-float']),
  sheet: shadowFrom(tokens.shadow['sh-sheet']),
  raise: shadowFrom(tokens.shadow['sh-raise']),
} as const;

/** src-google (DESIGN-001 §4-10): "Google Maps" 글자. Roboto 400, 12/16, 줄바꿈 없음, 번역 금지 (TASK-010 §11 G1). 글자 크기·색은 토큰에서 */
const SRC_GOOGLE = tokens.type['src-google'];
export const googleText: TextStyle = {
  fontFamily: 'Roboto_400Regular',
  fontSize: SRC_GOOGLE.size,
  lineHeight: SRC_GOOGLE.lineHeight,
  color: SRC_GOOGLE.color,
};
