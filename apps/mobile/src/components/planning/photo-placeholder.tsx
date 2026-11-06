// 사진 자리표시: 종류별 그라데이션 (사진 수집은 이번 범위 밖). 부모가 크기와 모서리를 정한다.
import { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { placeholderFor } from '@/lib/placeholder-for';

export function PhotoPlaceholder({
  category,
  style,
  children,
}: {
  category: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const id = `photo-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [from, to] = placeholderFor(category);
  return (
    <View style={[styles.box, style]}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ box: { overflow: 'hidden' } });
