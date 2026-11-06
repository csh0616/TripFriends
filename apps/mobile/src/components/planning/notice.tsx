// 말풍선 아래 안내/오류 줄. [다시]가 있으면 버튼을 같이 보여 준다 (TASK-004 §7).
import { StyleSheet, Text, View } from 'react-native';

import { color, radius, space, text } from '@/planning/theme';

import { SecondaryButton } from './secondary-button';

export function Notice({
  message,
  tone = 'plain',
  onRetry,
  retryDisabled,
}: {
  message: string;
  tone?: 'plain' | 'problem';
  onRetry?: () => void;
  retryDisabled?: boolean;
}) {
  const problem = tone === 'problem';
  return (
    <View style={[styles.box, { backgroundColor: color[problem ? 'alert-bg' : 'bg-2'] }]}>
      <Text style={[styles.message, text('body', problem ? 'alert' : 'ink')]}>{message}</Text>
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
