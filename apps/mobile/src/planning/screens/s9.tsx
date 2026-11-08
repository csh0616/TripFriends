// S9 완료 (TASK-004 §B-2, §12 Q4). [여행 중 화면 보기(데모)]는 TASK-006 B9.
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { CheckIcon } from '@/components/planning/icons';
import { PrimaryButton } from '@/components/planning/primary-button';
import { ScreenFrame } from '@/components/planning/screen-frame';
import { SecondaryButton } from '@/components/planning/secondary-button';

import { layout } from '../layout';
import { color, radius, space, text } from '../theme';

type Props =
  | { onRestart: () => void; onEnterNow: () => void; onClose?: undefined }
  // TASK-010: 실제 여행의 날이면 데모 버튼 없이 날짜 목록으로 돌아간다
  | { onClose: () => void; onRestart?: undefined; onEnterNow?: undefined };

export function S9Screen({ onRestart, onEnterNow, onClose }: Props) {
  return (
    <ScreenFrame>
      <View style={styles.center}>
        <View style={styles.badge}>
          <CheckIcon color={color['on-brand']} size={layout.successCheck} />
        </View>
        <Text style={text('title')}>코스 저장했어</Text>
      </View>
      <View style={styles.actions}>
        {onClose ? (
          <PrimaryButton testID="s9-close" label="날짜 목록으로" onPress={onClose} />
        ) : (
          <>
            {/* TASK-006 B9: 데모 시계로 여행 중 화면을 본다 */}
            <PrimaryButton label="여행 중 화면 보기(데모)" onPress={onEnterNow} />
            <SecondaryButton label="처음부터" onPress={onRestart} />
          </>
        )}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  actions: { gap: space['space-3'] },
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
