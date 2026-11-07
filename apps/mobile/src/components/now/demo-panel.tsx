// TASK-006 B7: 데모 시계 패널. 시각 막대(하루 시작~끝, 5분 단위), [+10분], [재생](1초 = 5분).
// 이 부품은 시각만 바꾼다. 카드·지도는 바뀐 시각으로 서버에 다시 물어서 그린다 (B8).
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { barTime, DEMO_STEP_MIN, toClock, toMinutes } from '@/lib/demo-clock';
import { layout } from '@/planning/layout';
import { color, control, radius, shadow, space, text } from '@/planning/theme';

function DemoBar({
  ratio,
  onRatio,
  onStep,
}: {
  ratio: number;
  onRatio: (ratio: number) => void;
  onStep: (direction: 1 | -1) => void;
}) {
  const [width, setWidth] = useState(0);
  const pick = (x: number) => {
    if (width > 0) onRatio(x / width);
  };
  const percent = `${Math.round(ratio * 1000) / 10}%` as const;
  return (
    <View
      testID="demo-bar"
      accessibilityRole="adjustable"
      accessibilityLabel="데모 시각"
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => onStep(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => pick(event.nativeEvent.locationX)}
      onResponderMove={(event) => pick(event.nativeEvent.locationX)}
      style={styles.hit}
    >
      {/* 안쪽은 터치를 받지 않는다: locationX가 늘 막대 기준이 되게 */}
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.fill, { width: percent }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: percent }]} />
    </View>
  );
}

export function DemoPanel({
  start,
  end,
  minutes,
  playing,
  onMinutes,
  onPlus,
  onTogglePlay,
}: {
  start: string;
  end: string;
  minutes: number;
  playing: boolean;
  onMinutes: (minutes: number) => void;
  onPlus: () => void;
  onTogglePlay: () => void;
}) {
  const [from, to] = [toMinutes(start), toMinutes(end)];
  const ratio = to > from ? Math.min(1, Math.max(0, (minutes - from) / (to - from))) : 0;
  const step = (direction: 1 | -1) => onMinutes(Math.min(to, Math.max(from, minutes + direction * DEMO_STEP_MIN)));

  return (
    <View testID="demo-panel" style={styles.panel}>
      <View style={styles.head}>
        <Text style={text('caption', 'muted')}>데모 시계</Text>
        <View testID="demo-time">
          <Text style={text('num-md')}>{toClock(minutes)}</Text>
        </View>
      </View>
      <DemoBar ratio={ratio} onRatio={(value) => onMinutes(toMinutes(barTime(value, start, end)))} onStep={step} />
      <View style={styles.buttons}>
        <View style={styles.grow}>
          <SecondaryButton small testID="demo-plus-10" label="+10분" onPress={onPlus} />
        </View>
        <View style={styles.grow}>
          <SecondaryButton small testID="demo-play" label={playing ? '멈춤' : '재생'} onPress={onTogglePlay} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: color.surface,
    borderRadius: radius['r-lg'],
    padding: space['space-4'],
    gap: space['space-3'],
    ...shadow.float,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grow: { flex: 1 },
  buttons: { flexDirection: 'row', gap: space['space-2'] },
  hit: { minHeight: control['touch-min'], justifyContent: 'center' },
  track: { height: layout.barHeight, borderRadius: radius['r-full'], backgroundColor: color['bg-2'], overflow: 'hidden' },
  fill: { height: layout.barHeight, backgroundColor: color.ink },
  thumb: {
    position: 'absolute',
    width: layout.demoThumb,
    height: layout.demoThumb,
    marginLeft: -layout.demoThumb / 2,
    borderRadius: radius['r-full'],
    backgroundColor: color.ink,
    borderWidth: layout.routeHomeStroke,
    borderColor: color.surface,
  },
});
