// TASK-006 D4: 시스템 글자 크기를 1.3배까지만 따른다. 앱의 모든 글자는 react-native의 Text 대신 이 부품을 쓴다.
import { Text as NativeText, TextInput as NativeTextInput, type TextInputProps, type TextProps } from 'react-native';

import { layout } from '@/planning/layout';

export function Text(props: TextProps) {
  return <NativeText {...props} maxFontSizeMultiplier={layout.fontScaleMax} />;
}

export function TextInput(props: TextInputProps) {
  return <NativeTextInput {...props} maxFontSizeMultiplier={layout.fontScaleMax} />;
}
