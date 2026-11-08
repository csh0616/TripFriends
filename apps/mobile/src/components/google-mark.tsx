// TASK-010 §11 G2 · DESIGN-001 §4-10 g-slot / g-footer: 지도 없이 Google 값을 보여 줄 때의 Google Maps 로고 자리.
// 로고는 Google이 배포한 파일 그대로 (밝은 바탕은 Gray, 높이 18, 비율 유지). 모양을 바꾸지 않는다.
// 화면 읽기 도구와 시험을 위해 같은 이름의 글자를 보이지 않게 함께 둔다 (번역하지 않는다).
import { Image, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { sourceLabel } from '@/lib/source-label';
import { layout } from '@/planning/layout';
import { googleText } from '@/planning/theme';

export function GoogleMark({ testID }: { testID: 'g-slot' | 'g-footer' }) {
  return (
    <View testID={testID} style={testID === 'g-footer' ? styles.footer : styles.slot}>
      <Image
        accessible={false}
        source={require('../../assets/google/GoogleMaps_Logo_Gray.png')}
        resizeMode="contain"
        style={styles.logo}
      />
      <Text numberOfLines={1} style={styles.name}>
        {sourceLabel('google')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { height: layout.googleSlot, justifyContent: 'center' },
  footer: {
    height: layout.googleFooter,
    paddingTop: layout.googleFooterTop,
    paddingBottom: layout.googleFooterBottom,
    paddingLeft: layout.googleFooterTop,
    justifyContent: 'center',
  },
  logo: { width: layout.googleLogoWidth, height: layout.googleLogoHeight },
  // 로고가 보이므로 글자는 투명하게 겹쳐 둔다 (읽기 도구용, 불투명도 대신 투명 색)
  name: { ...googleText, position: 'absolute', color: 'transparent' },
});
