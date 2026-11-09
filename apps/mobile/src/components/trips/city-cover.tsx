// DESIGN-001 §4-10 도시 표지: landmark 색 그라데이션 + 해 + 물결 세 겹 + 성 그림 (docs/design/city-images/osaka.svg를 코드로 옮긴 것).
// 그림 파일의 도형을 그대로 따르고, 색은 토큰/placeholderFor(landmark = city-osaka)에서만 가져온다.
import { useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { placeholderFor } from '@/lib/placeholder-for';
import { layout } from '@/planning/layout';
import { color } from '@/planning/theme';

export type CoverSize = 'large' | 'tile' | 'banner';

// 큰 표지는 정사각형(그림 파일과 같은 316). 나머지는 DESIGN-001 §4-10의 크기
const SPEC: Record<CoverSize, { width: number; height: number; glyph: number; line: number }> = {
  large: { width: layout.photo, height: layout.photo, glyph: layout.coverGlyphLarge, line: layout.coverLineLarge },
  tile: { width: layout.coverTile[0], height: layout.coverTile[1], glyph: layout.coverGlyphTile, line: layout.coverLine },
  banner: { width: layout.coverBanner[0], height: layout.coverBanner[1], glyph: layout.coverGlyphBanner, line: layout.coverLineBanner },
};

const CASTLE_FILL = 'M8.5 8.2L12 4.6l3.5 3.6zM7 12.8l1.5-2.6h7l1.5 2.6zM5 17.6l1.6-2.6h10.8l1.6 2.6zM4 21l.9-3.4h14.2L20 21z';
const CASTLE_LINE =
  'M12 2.4v2.2M8.5 8.2L12 4.6l3.5 3.6zM9.6 8.2v2M14.4 8.2v2M7 12.8l1.5-2.6h7l1.5 2.6zM9 12.8v2.2M15 12.8v2.2M5 17.6l1.6-2.6h10.8l1.6 2.6zM4 21l.9-3.4h14.2L20 21z';

const WAVE_ROWS: [number, number][] = [
  [122, 0],
  [138, 16],
  [154, 0],
  [170, 16],
]; // [y, 첫 물결의 x 어긋남] (그림 파일의 160칸 좌표)
const WAVE_RADII = [16, 10.56, 4.96];
const WAVE_STEP = 32;

/** 물결 한 줄: 반지름이 다른 반원 세 겹을 같은 간격으로 이어 그린다 */
function waves(unitsWide: number): { alpha: number; d: string }[] {
  return WAVE_RADII.map((radius, layer) => {
    const inset = WAVE_RADII[0] - radius;
    const parts: string[] = [];
    for (const [y, shift] of WAVE_ROWS) {
      for (let x = shift - WAVE_STEP; x < unitsWide; x += WAVE_STEP) {
        parts.push(`M${x + inset} ${y}a${radius} ${radius} 0 0 1 ${2 * radius} 0`);
      }
    }
    return { alpha: layout.waveOpacity[layer], d: parts.join('') };
  });
}

/** width를 넘기면 그 너비로 그린다 (날짜 목록 표지: 화면 - 40. TASK-011 review 7번 줄). 높이·그림 크기는 그대로 */
export function CityCover({ size, width: wide, style }: { size: CoverSize; width?: number; style?: StyleProp<ViewStyle> }) {
  const id = `city-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [from, to] = placeholderFor('landmark');
  const { width: baseWidth, height, glyph, line } = SPEC[size];
  const width = wide ?? baseWidth;
  const k = Math.min(width, height) / layout.coverUnit; // 160칸 좌표 -> 화면
  const glyphScale = glyph / layout.iconGrid;
  return (
    <View accessible accessibilityLabel="오사카 표지" style={[{ width, height, overflow: 'hidden' }, style]}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
        <G scale={k}>
          <Circle cx={layout.sunX} cy={layout.sunY} r={layout.sunRadius} fill={color.surface} fillOpacity={layout.sunOpacity} />
          {waves(width / k).map((wave) => (
            <Path key={wave.alpha} d={wave.d} fill="none" stroke={color.surface} strokeWidth={layout.waveStroke} strokeLinecap="round" strokeOpacity={wave.alpha} />
          ))}
        </G>
        <G x={(width - glyph) / 2} y={(height - glyph) / 2} scale={glyphScale}>
          <Path d={CASTLE_FILL} fill={color.surface} fillOpacity={layout.glyphFillOpacity} />
          <Path d={CASTLE_LINE} fill="none" stroke={color.surface} strokeWidth={line / glyphScale} strokeLinecap="round" strokeLinejoin="round" />
        </G>
      </Svg>
    </View>
  );
}
