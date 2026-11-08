// 사진 자리표시: 종류별 그라데이션 (사진 수집은 이번 범위 밖). 부모가 크기와 모서리를 정한다.
import { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { placeholderFor } from '@/lib/placeholder-for';

import { PlaceGlyph } from './place-glyph';

export function PhotoPlaceholder({
  category,
  style,
  glyph,
  children,
}: {
  category: string;
  style?: StyleProp<ViewStyle>;
  /** 그림 크기. 28 이상일 때만 넘긴다 (24 이하는 색만, DESIGN-001 §4-8) */
  glyph?: number;
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
      {glyph !== undefined ? (
        <View pointerEvents="none" style={styles.glyph}>
          <PlaceGlyph category={category} size={glyph} />
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
  glyph: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
