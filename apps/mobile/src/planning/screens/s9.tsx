// S9 완료 (TASK-004 §B-2, §12 Q4). 여행 중 화면은 TASK-005.
import { StyleSheet, Text, View } from 'react-native';

import { CheckIcon } from '@/components/planning/icons';
import { PrimaryButton } from '@/components/planning/primary-button';
import { ScreenFrame } from '@/components/planning/screen-frame';

import { layout } from '../layout';
import { color, radius, space, text } from '../theme';

export function S9Screen({ onRestart }: { onRestart: () => void }) {
  return (
    <ScreenFrame>
      <View style={styles.center}>
        <View style={styles.badge}>
          <CheckIcon color={color['on-brand']} size={layout.successCheck} />
        </View>
        <Text style={text('title')}>코스 저장했어</Text>
      </View>
      <PrimaryButton label="처음부터" onPress={onRestart} />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space['space-4'], minHeight: layout.photo },
  badge: {
    width: layout.successCircle,
    height: layout.successCircle,
    borderRadius: radius['r-full'],
    backgroundColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
