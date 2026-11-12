// TASK-012 §9 1·리뷰 §2·DESIGN-001 §4-12 google-btn: Google "밝은 모양" 버튼. 글자는 승인 문구 「Google 계정으로 계속」 하나뿐.
// G 로고: Google 공식 SVG(docs/design/google/g-logo.svg -> assets/google/g-logo.svg)가 아직 없다. 지어낸 그림을 넣지 않고 자리(20)만 비워 둔다.
// 글꼴은 기기 기본 (TASK-012 §16 Q10): fontFamily를 주지 않는다.
import { Pressable, StyleSheet, View, type TextStyle } from 'react-native';

import { Text } from '@/components/app-text';
import { account } from '@/planning/theme';

const BTN = account['google-btn'];

export function GoogleButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable testID="google-continue" accessibilityRole="button" disabled={disabled} onPress={onPress} style={styles.button}>
      {/* G 로고 자리 (공식 파일이 오면 여기에 그대로 그린다) */}
      <View accessible={false} style={styles.logoSlot} />
      <Text numberOfLines={1} style={styles.label}>
        Google 계정으로 계속
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: BTN.height,
    borderRadius: BTN.radius,
    backgroundColor: BTN.bg,
    borderWidth: BTN.borderWidth,
    borderColor: BTN.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: BTN.paddingLeft,
    paddingRight: BTN.paddingRight,
  },
  logoSlot: { width: BTN.logo, height: BTN.logo, marginRight: BTN.logoGap },
  label: {
    fontSize: BTN.size,
    lineHeight: BTN.lineHeight,
    fontWeight: String(BTN.weight) as TextStyle['fontWeight'],
    color: BTN.fg,
  },
});
