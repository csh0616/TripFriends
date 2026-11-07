// SOS를 누르면 올라오는 준비 중 시트. 계획 화면(ScreenFrame)과 여행 중 화면이 함께 쓴다.
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { layout } from '@/planning/layout';
import { color, radius, shadow, space, text } from '@/planning/theme';

import { SecondaryButton } from './secondary-button';

export function SosSheet({ onClose }: { onClose: () => void }) {
  return (
    <View testID="sheet-scrim" style={styles.overlay}>
      <View testID="sos-sheet" style={styles.sheet}>
        <Text style={text('heading')}>긴급 도움은 준비 중이야</Text>
        <SecondaryButton label="닫기" onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', backgroundColor: color.scrim },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius['r-sheet'],
    borderTopRightRadius: radius['r-sheet'],
    padding: layout.screenMargin,
    paddingBottom: space['space-8'],
    gap: space['space-4'],
    ...shadow.sheet,
  },
});
