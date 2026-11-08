// DESIGN-001 §4-8: 종류마다 그림 하나 (docs/design/place-images/{종류}-glyph.svg의 24칸 그림). 28 이상일 때만 얹는다 (D4).
// 흰 그림은 색 토큰 surface. 모르는 종류는 landmark (cat-fallback).
import Svg, { Path } from 'react-native-svg';

import { layout } from '@/planning/layout';
import { color } from '@/planning/theme';

type Glyph = { fill: string; line: string };

const GLYPHS: Readonly<Record<string, Glyph>> = {
  cafe: {
    fill: 'M5.5 10.5h11v3.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z',
    line: 'M5.5 10.5h11v3.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16.5 11.5h1.2a2.4 2.4 0 0 1 0 4.8h-1.6M9 3.5c-1.2 1.3 1.2 2.2 0 3.8M12.5 3.5c-1.2 1.3 1.2 2.2 0 3.8M4.5 21h14',
  },
  experience: {
    fill: 'M3.5 8.5A1.5 1.5 0 0 1 5 7h14a1.5 1.5 0 0 1 1.5 1.5v2.3a1.9 1.9 0 0 0 0 3.4v2.3A1.5 1.5 0 0 1 19 17H5a1.5 1.5 0 0 1-1.5-1.5v-2.3a1.9 1.9 0 0 0 0-3.4z',
    line: 'M3.5 8.5A1.5 1.5 0 0 1 5 7h14a1.5 1.5 0 0 1 1.5 1.5v2.3a1.9 1.9 0 0 0 0 3.4v2.3A1.5 1.5 0 0 1 19 17H5a1.5 1.5 0 0 1-1.5-1.5v-2.3a1.9 1.9 0 0 0 0-3.4zM7.5 10.8h4M7.5 13.2h2.6M14.5 7.5v9',
  },
  food: {
    fill: 'M4 12.5h16c0 4.4-3.5 7.5-8 7.5s-8-3.1-8-7.5z',
    line: 'M4 12.5h16c0 4.4-3.5 7.5-8 7.5s-8-3.1-8-7.5zM13.5 9L19 3.5M16.5 10.5L21 6M9.5 21.5h5',
  },
  landmark: {
    fill: 'M8 7.5h8l1 3.5H7z',
    line: 'M12 2.5v3.5M8 7.5h8l1 3.5H7zM10 11l-1.2 9.5M14 11l1.2 9.5M9.4 16h5.2M7 20.5h10',
  },
  museum: {
    fill: 'M3.5 9L12 4l8.5 5z',
    line: 'M3.5 9L12 4l8.5 5zM6.5 11.5v6M10 11.5v6M14 11.5v6M17.5 11.5v6M4 20h16',
  },
  night: {
    fill: 'M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7z',
    line: 'M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7zM17 3.5v3.5M15.25 5.25h3.5',
  },
  shop: {
    fill: 'M5.5 8.5h13l-1 11.5a1 1 0 0 1-1 .9H7.5a1 1 0 0 1-1-.9z',
    line: 'M5.5 8.5h13l-1 11.5a1 1 0 0 1-1 .9H7.5a1 1 0 0 1-1-.9zM9 8.5V7a3 3 0 0 1 6 0v1.5',
  },
  walk: {
    fill: 'M6.5 9a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0',
    line: 'M6.5 9a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0M12 14.5V21M12 17.5l2.6-2.2M7.5 21h9',
  },
};

export function PlaceGlyph({ category, size }: { category: string; size: number }) {
  const glyph = Object.prototype.hasOwnProperty.call(GLYPHS, category) ? GLYPHS[category] : GLYPHS.landmark;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={glyph.fill} fill={color.surface} fillOpacity={layout.glyphFillOpacity} />
      <Path d={glyph.line} stroke={color.surface} strokeWidth={layout.glyphLine} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
