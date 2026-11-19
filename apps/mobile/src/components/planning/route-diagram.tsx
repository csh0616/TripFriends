// 동선 도식 (지도 SDK 없음). P3 코스안과 여행 중 화면의 지도 대체 화면이 함께 쓴다.
// 변환(G transform)과 중첩 Svg는 쓰지 않는다 (TASK-005에서 네이티브에 안 그려졌다). 집 아이콘은 home-icon.ts의 좌표 계산.
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline, Text as SvgText } from 'react-native-svg';

import { spreadDiagramPins } from '@/lib/diagram-spread';
import { homeIconLines } from '@/lib/home-icon';
import { projectRoute } from '@/lib/project-route';
import { layout } from '@/planning/layout';
import { color, control, radius, text } from '@/planning/theme';

function spreadAll(projected: { x: number; y: number }[], hasHome: boolean, stops: { seq: number }[], width: number, height: number) {
  const pins = hasHome ? projected.slice(1) : projected;
  const r = spreadDiagramPins({
    frame: { width, height },
    stops: pins.map((p, i) => ({ seq: stops[i].seq, ...p })),
    home: hasHome ? projected[0] : null,
  });
  const moved = r.stops.map(({ x, y }) => ({ x, y }));
  return r.home ? [r.home, ...moved] : moved;
}

/**
 * 동선 도식 (지도 SDK 없음). 숙소 + 코스 항목 좌표(A8)를 상자에 맞춰 그린다.
 * 좌표 없는 줄(장소 없는 고정 일정)은 그림에서 빼고 목록에는 둔다. 번호는 목록과 같은 seq.
 */
export function RouteDiagram({
  width,
  home,
  stops,
  spread = false,
}: {
  width: number;
  /** 숙소가 없으면 null: 집 그림 없이 핀만 (§29 ④) */
  home: { lat: number; lng: number } | null;
  stops: { seq: number; lat: number; lng: number }[];
  /** P3 코스안만 true: 겹친 핀을 벌린다 (TASK-015 §19). 여행 중 지도 대체 도식은 문서에 없어 안 벌린다 */
  spread?: boolean;
}) {
  const height = layout.routeDiagram;
  const projected = projectRoute(home ? [home, ...stops] : stops, width, height, layout.routePad);
  const all = spread ? spreadAll(projected, home !== null, stops, width, height) : projected;
  const points = home ? all : [{ x: 0, y: 0 }, ...all]; // 아래 코드는 points[0] = 집, points[i + 1] = 핀
  const homeLines = home ? homeIconLines(points[0].x, points[0].y, layout.routeHomeIcon) : [];
  const line = all.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <View testID="route-diagram" style={[styles.diagram, { width, height }]}>
      <Svg width={width} height={height}>
        {stops.length > 0 ? (
          <Polyline
            testID="route-line"
            points={line}
            fill="none"
            stroke={color.brand}
            strokeWidth={layout.routeLine}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {home ? (
        <Circle
          testID="route-home"
          cx={points[0].x}
          cy={points[0].y}
          r={layout.routeHome}
          fill={color.surface}
          stroke={color.ink}
          strokeWidth={layout.routeHomeStroke}
        />
        ) : null}
        {/* 집 아이콘: 변환 없이 좌표를 직접 계산한 Polyline 2개 (중첩 Svg는 안 그려졌다) */}
        {homeLines.map((points, i) => (
          <Polyline
            key={`home-${i}`}
            testID={`route-home-icon-${i}`}
            points={points}
            fill="none"
            stroke={color.ink}
            strokeWidth={control['icon-stroke']}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {stops.map((stop, i) => (
          <Circle
            key={`n-${stop.seq}`}
            testID={`route-stop-${stop.seq}`}
            cx={points[i + 1].x}
            cy={points[i + 1].y}
            r={layout.routeNode}
            fill={color.ink}
          />
        ))}
        {stops.map((stop, i) => (
          <SvgText
            key={`t-${stop.seq}`}
            x={points[i + 1].x}
            y={points[i + 1].y + layout.dot - 1}
            fill={color.surface}
            textAnchor="middle"
            fontFamily={text('num-md').fontFamily}
            fontSize={text('num-md').fontSize}
          >
            {/* 미정(§13): 번호는 좌표 없는 줄을 빼도 seq 그대로 (목록 번호와 같게) */}
            {String(stop.seq)}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  diagram: {
    borderRadius: radius['r-lg'],
    backgroundColor: color['bg-2'],
    overflow: 'hidden',
  },
});
