// TASK-012 §6·리뷰 ①-25 / DESIGN-001 §4-12 notice-fail: 연결 실패 알림 한 줄. 머리 아래 8, 좌우 20, 화면 위에 떠 있음.
// role="alert", 누르면 바로 닫히고 6초 뒤에도 사라진다 (닫는 일은 부른 쪽이 맡는다: onClose).
import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/app-text';
import { AlertIcon } from '@/components/planning/icons';
import { layout } from '@/planning/layout';
import { account, fitText, shadow, space } from '@/planning/theme';

const NOTICE = account['notice-fail'];
export const FAIL_MESSAGE = '연결하지 못했어. 지금 여행은 그대로야';

export function FailNotice({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    const timer = setTimeout(onClose, NOTICE.duration);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <Pressable
      testID="fail-notice"
      accessibilityRole="alert"
      onPress={onClose}
      style={[styles.box, { top: insets.top + layout.header + NOTICE.top }]}
    >
      <AlertIcon color={NOTICE.iconFg} size={NOTICE.icon} />
      <Text numberOfLines={1} style={styles.text}>
        {FAIL_MESSAGE}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    left: NOTICE.side,
    right: NOTICE.side,
    height: NOTICE.height,
    borderRadius: NOTICE.radius,
    backgroundColor: NOTICE.bg,
    paddingHorizontal: NOTICE.paddingHorizontal,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-2'],
    ...shadow.notice,
  },
  text: { flex: 1, ...fitText(NOTICE) },
});
