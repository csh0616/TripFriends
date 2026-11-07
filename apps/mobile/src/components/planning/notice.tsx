// 말풍선 아래 안내/오류 줄. [다시]가 있으면 버튼을 같이 보여 준다 (TASK-004 §7).
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { color, radius, space, text } from '@/planning/theme';

import { SecondaryButton } from './secondary-button';

export function Notice({
  message,
  tone = 'plain',
  onRetry,
  retryDisabled,
}: {
  message: string;
  tone?: 'plain' | 'problem' | 'warn';
  onRetry?: () => void;
  retryDisabled?: boolean;
}) {
  // warn: 연결이 끊겨 저장된 값만 보일 때의 띠 (TASK-006 §13 E5)
  const look = tone === 'problem' ? (['alert', 'alert-bg'] as const) : tone === 'warn' ? (['warn', 'warn-bg'] as const) : (['ink', 'bg-2'] as const);
  return (
    <View style={[styles.box, { backgroundColor: color[look[1]] }]}>
      <Text style={[styles.message, text('body', look[0])]}>{message}</Text>
      {onRetry ? <SecondaryButton small label="다시" onPress={onRetry} disabled={retryDisabled} testID="retry-button" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius['r-lg'],
    padding: space['space-4'],
    gap: space['space-3'],
    alignItems: 'flex-start',
  },
  message: { alignSelf: 'stretch' },
});
