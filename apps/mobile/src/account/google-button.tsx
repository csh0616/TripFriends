// TASK-012 §9 1·리뷰 §2·DESIGN-001 §4-12 google-btn: Google "밝은 모양" 버튼. 글자는 승인 문구 「Google 계정으로 계속」 하나뿐.
// G 로고: Google 공식 PNG(docs/design/google/g-logo.png·@2x·@3x -> assets/google/, 같은 바이트). 색·모양 손대지 않음 (TASK-012 §19 F3).
// 글꼴은 기기 기본 (TASK-012 §16 Q10): fontFamily를 주지 않는다.
import { Image, Pressable, StyleSheet, type TextStyle } from 'react-native';

import { Text } from '@/components/app-text';
import { account } from '@/planning/theme';

const BTN = account['google-btn'];

export function GoogleButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable testID="google-continue" accessibilityRole="button" disabled={disabled} onPress={onPress} style={styles.button}>
      {/* 공식 G 로고. 읽기 도구에는 따로 읽히지 않고 버튼 이름은 글자 하나 */}
      <Image source={require('../../assets/google/g-logo.png')} accessible={false} style={styles.logo} />
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
  logo: { width: BTN.logo, height: BTN.logo, marginRight: BTN.logoGap },
  label: {
    fontSize: BTN.size,
    lineHeight: BTN.lineHeight,
    fontWeight: String(BTN.weight) as TextStyle['fontWeight'],
    color: BTN.fg,
  },
});
