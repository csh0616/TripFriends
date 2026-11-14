// TASK-006 B7: 데모 시계 패널. 시각 막대(하루 시작~끝, 5분 단위), [+10분], [재생](1초 = 5분).
// 이 부품은 시각만 바꾼다. 카드·지도는 바뀐 시각으로 서버에 다시 물어서 그린다 (B8).
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { PauseIcon, PlayIcon, PlusIcon } from '@/components/planning/icons';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { barTime, DEMO_STEP_MIN, toClock, toMinutes } from '@/lib/demo-clock';
import { layout } from '@/planning/layout';
import { color, control, radius, shadow, space, text } from '@/planning/theme';

function DemoBar({
  ratio,
  onRatio,
  onStep,
  thumb = layout.demoThumb,
}: {
  thumb?: number;
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
      <View testID="demo-thumb" pointerEvents="none" style={[styles.thumb, { left: percent, width: thumb, height: thumb, marginLeft: -thumb / 2 }]} />
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
  delay,
  onDelay,
  onDelayReset,
  rehearsal = false,
}: {
  start: string;
  end: string;
  minutes: number;
  playing: boolean;
  onMinutes: (minutes: number) => void;
  onPlus: () => void;
  onTogglePlay: () => void;
  /** TASK-007 C2: 위치만 이만큼 앞 시각 자리로 둔다 (분) */
  delay: number;
  onDelay: () => void;
  onDelayReset: () => void;
  /** TASK-014 §D4: 연습 시계 = 같은 부품, 이름만 다르고 늦어짐 흉내 버튼은 없다 */
  rehearsal?: boolean;
}) {
  const [from, to] = [toMinutes(start), toMinutes(end)];
  const ratio = to > from ? Math.min(1, Math.max(0, (minutes - from) / (to - from))) : 0;
  const step = (direction: 1 | -1) => onMinutes(Math.min(to, Math.max(from, minutes + direction * DEMO_STEP_MIN)));

  if (rehearsal) {
    // DESIGN-001 §4-13 reh-clock: 높이 112 · 안쪽 12/16 · 모서리 24. 윗줄 44(이름+시각 · [+10분] 84 · [재생] 96), 아랫줄 44(시작 · 막대 · 끝)
    return (
      <View testID="demo-panel" style={styles.rehPanel}>
        <View style={styles.rehRow}>
          <View style={styles.rehHead}>
            <Text style={text('label', 'muted')}>연습 시계</Text>
            <View testID="demo-time">
              <Text style={styles.rehTime}>{toClock(minutes)}</Text>
            </View>
          </View>
          <Pressable testID="demo-plus-10" accessibilityRole="button" onPress={onPlus} style={[styles.rehButton, styles.rehPlus]}>
            <PlusIcon color={color.ink} size={layout.rehButtonIcon} />
            <Text style={text('caption', 'ink')}>+10분</Text>
          </Pressable>
          <Pressable testID="demo-play" accessibilityRole="button" onPress={onTogglePlay} style={[styles.rehButton, styles.rehPlay]}>
            {playing ? <PauseIcon color={color.surface} size={layout.rehButtonIcon} /> : <PlayIcon color={color.surface} size={layout.rehButtonIcon} />}
            <Text style={text('caption', 'surface')}>{playing ? '멈춤' : '재생'}</Text>
          </Pressable>
        </View>
        <View style={styles.rehRow}>
          <Text style={styles.rehEnd}>{start}</Text>
          <View style={styles.rehBar}>
            <DemoBar thumb={layout.rehThumb} ratio={ratio} onRatio={(value) => onMinutes(toMinutes(barTime(value, start, end)))} onStep={step} />
          </View>
          <Text style={styles.rehEnd}>{end}</Text>
        </View>
      </View>
    );
  }

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
      <View style={styles.buttons}>
        <View style={styles.grow}>
          <SecondaryButton small testID="demo-delay-10" label="+10분 늦게" onPress={onDelay} />
        </View>
        <View style={styles.grow}>
          <SecondaryButton small testID="demo-delay-reset" label="지연 초기화" onPress={onDelayReset} />
        </View>
      </View>
      {delay > 0 ? <Text style={text('caption', 'muted')}>{`지연 ${delay}분`}</Text> : null}
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
  rehPanel: {
    height: layout.rehClock,
    backgroundColor: color.surface,
    borderRadius: radius['r-xl'],
    paddingVertical: space['space-3'],
    paddingHorizontal: space['space-4'],
    ...shadow.float,
  },
  rehRow: { height: control['touch-min'], flexDirection: 'row', alignItems: 'center', gap: space['space-2'] },
  rehHead: { flex: 1, height: control['touch-min'], justifyContent: 'center' },
  rehTime: text('num-lg'),
  rehButton: { height: control['touch-min'], flexDirection: 'row', gap: space['space-1'], alignItems: 'center', justifyContent: 'center', borderRadius: radius['r-md'] },
  rehPlus: { width: layout.rehPlusWidth, backgroundColor: color['bg-2'] },
  rehPlay: { width: layout.rehPlayWidth, backgroundColor: color.ink },
  rehBar: { flex: 1 },
  rehEnd: text('num-sm', 'muted'),
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
