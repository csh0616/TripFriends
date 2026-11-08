// TASK-011 btn-card-secondary: 카드 안 보조 버튼. 흰 바탕 + 1px 테두리(토큰), 주황 없음 (화면의 주황은 아래 큰 버튼 하나).
// large = 큰 [같이 고르기] 52 · auto = [알아서 짜 줘] 52 · small = 작은 [같이 고르기] 44
import { Pressable, StyleSheet } from 'react-native';

import { Text } from '@/components/app-text';
import { color, fit, fitText, radius, space } from '@/planning/theme';

const SPEC = { large: fit['btn-card-secondary'].large, auto: fit['btn-card-secondary'].auto, small: fit['btn-card-secondary'].small } as const;

export function CardButton({
  label,
  size,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  size: keyof typeof SPEC;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const spec = SPEC[size];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { minHeight: spec.height }, disabled && styles.disabled]}
    >
      <Text style={fitText(spec, disabled ? 'muted' : size === 'auto' ? 'ink' : 'ink-strong')}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: fit['btn-card-secondary'].small.height,
    paddingHorizontal: space['space-4'],
    borderRadius: radius['r-md'],
    backgroundColor: fit['btn-card-secondary'].bg,
    borderWidth: fit['btn-card-secondary'].borderWidth,
    borderColor: fit['btn-card-secondary'].border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 비활성은 opacity가 아니라 bg-2 바탕 + muted 글자
  disabled: { backgroundColor: color['bg-2'] },
});
