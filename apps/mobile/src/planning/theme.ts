// 토큰(packages/design-tokens)을 React Native 스타일로 옮긴다. 화면 코드는 색·글자 크기·모서리를 여기서만 가져온다.
import type { TextStyle, ViewStyle } from 'react-native';
import tokens from 'design-tokens';

export const color = tokens.color;
export const space = tokens.space;
export const control = tokens.control;
export const radius = tokens.radius;
export const motion = tokens.motion;

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

export const shadow = {
  float: shadowFrom(tokens.shadow['sh-float']),
  sheet: shadowFrom(tokens.shadow['sh-sheet']),
} as const;
