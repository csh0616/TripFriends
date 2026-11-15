// SOS를 누르면 올라오는 준비 중 시트. 계획 화면(ScreenFrame)과 여행 중 화면이 함께 쓴다.
import { Modal, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { layout } from '@/planning/layout';
import { color, fit, radius, shadow, space, text } from '@/planning/theme';

import { SecondaryButton } from './secondary-button';

/** located: 좋은 좌표가 있으면 "위치 확인됨"만 (TASK-014 A5·§10 Q11). 없으면 그 줄 자체가 없다. 주소 변환은 TASK-015 */
export function SosSheet({ onClose, located = false }: { onClose: () => void; located?: boolean }) {
  // Modal: 스크림이 연습 띠·SOS 같은 위쪽 컨트롤까지 화면 전체를 덮는다 (TASK-014 §19)
  return (
    <Modal transparent animationType="none" statusBarTranslucent visible onRequestClose={onClose}>
      <View testID="sheet-scrim" style={styles.overlay}>
        <View testID="sos-sheet" style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={text('heading')}>긴급 도움은 준비 중이야</Text>
          {located ? <Text style={text('caption', 'muted')}>위치 확인됨</Text> : null}
          {/* 글자만: 눌러서 전화 걸기는 TASK-016 SOS */}
          <Text style={text('caption', 'muted')}>경찰 110 · 구급·소방 119</Text>
          <SecondaryButton label="닫기" onPress={onClose} />
        </View>
      </View>
    </Modal>
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
  handle: {
    alignSelf: 'center',
    width: fit['sheet-confirm'].handle[0],
    height: fit['sheet-confirm'].handle[1],
    borderRadius: radius['r-full'],
    backgroundColor: color.line,
  },
});
