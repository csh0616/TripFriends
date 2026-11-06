// 담은 곳 표시 둘레에 주황 동그라미가 그려진다 (TASK-004 §B-4, §13-2 #8). 그리는 시간은 useDraw(dur-draw).
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useDraw } from '@/planning/draw';
import { layout } from '@/planning/layout';
import { color } from '@/planning/theme';

export function DrawnRing({ size }: { size: number }) {
  const progress = useDraw();
  const radius = (size - layout.ringBrand) / 2;
  const length = 2 * Math.PI * radius;
  const [offset, setOffset] = useState(length);
  useEffect(() => {
    const id = progress.addListener(({ value }) => setOffset(length * (1 - value)));
    return () => progress.removeListener(id);
  }, [progress, length]);

  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color.brand}
        strokeWidth={layout.ringBrand}
        strokeDasharray={length}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </Svg>
  );
}
