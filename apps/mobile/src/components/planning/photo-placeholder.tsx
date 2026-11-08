// 사진 자리표시: 종류별 그라데이션 (사진 수집은 이번 범위 밖). 부모가 크기와 모서리를 정한다.
import { useId, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop, SvgXml } from 'react-native-svg';

import { placeholderFor } from '@/lib/placeholder-for';

import { PLACE_IMAGES } from '../../../assets/place-images';

import { PlaceGlyph } from './place-glyph';

export function PhotoPlaceholder({
  category,
  style,
  glyph,
  pattern,
  children,
}: {
  category: string;
  style?: StyleProp<ViewStyle>;
  /** 그림 크기. 28 이상일 때만 넘긴다 (24 이하는 색만, DESIGN-001 §4-8) */
  glyph?: number;
  /** 큰 카드: 무늬 + 그림이 든 그림 파일(docs/design/place-images/{종류}.svg)을 그린다. 못 읽으면 그림 + 색 (TASK-011 §9 Q13, §6). glyph는 못 읽을 때 쓰는 그림 크기 */
  pattern?: boolean;
  children?: React.ReactNode;
}) {
  const id = `photo-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [from, to] = placeholderFor(category);
  const [unreadable, setUnreadable] = useState(false);
  const xml = Object.prototype.hasOwnProperty.call(PLACE_IMAGES, category) ? PLACE_IMAGES[category] : PLACE_IMAGES.landmark; // 모르는 종류 = landmark (cat-fallback)
  const drawPattern = pattern === true && !unreadable && typeof xml === 'string';
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
      {drawPattern ? (
        <View testID="place-pattern" pointerEvents="none" style={StyleSheet.absoluteFill}>
          <SvgXml xml={xml} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" onError={() => setUnreadable(true)} />
        </View>
      ) : glyph !== undefined ? (
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
