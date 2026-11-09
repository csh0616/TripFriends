// DESIGN-001 §4-9·§4-11 날 상태 알약: 높이 24(테두리 포함), 아이콘 상자 14 + 글자. 색은 pill-* 토큰. 알약에 주황 없음.
// 계획 전 점선 원 12 · 계획 완료 체크 원 · 오늘 흰 점 8 · 지난 날 체크
import tokens from 'design-tokens';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Text } from '@/components/app-text';
import { dayPill } from '@/lib/day-list';
import { layout } from '@/planning/layout';
import { radius, space, text } from '@/planning/theme';

const PILL_LOOK = {
  planning: tokens.pill['pill-planning'],
  planned: tokens.pill['pill-planned'],
  today: tokens.pill['pill-today'],
  past: tokens.pill['pill-past'],
} as const;

type Look = (typeof PILL_LOOK)[keyof typeof PILL_LOOK];

const CHECK = 'M4 7.4l2.2 2.2L10.2 5.2'; // 14칸 안의 체크
const HALF = layout.pillIcon / 2;

function PillIcon({ state, look, dayId }: { state: string; look: Look; dayId: string }) {
  return (
    <View testID={`day-pill-icon-${dayId}`} style={styles.icon}>
      {state === 'today' ? (
        <View style={[styles.whiteDot, { backgroundColor: look.fg }]} />
      ) : state === 'planned' ? (
        <Svg width={layout.pillIcon} height={layout.pillIcon} viewBox={`0 0 ${layout.pillIcon} ${layout.pillIcon}`} fill="none">
          <Circle cx={HALF} cy={HALF} r={HALF} fill={look.fg} />
          <Path d={CHECK} stroke={look.bg} strokeWidth={layout.pillStroke} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      ) : state === 'past' ? (
        <Svg width={layout.pillIcon} height={layout.pillIcon} viewBox={`0 0 ${layout.pillIcon} ${layout.pillIcon}`} fill="none">
          <Path d={CHECK} stroke={look.fg} strokeWidth={layout.pillStroke} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      ) : (
        <View testID={`day-pill-dot-${dayId}`} style={[styles.dot, { borderColor: 'dot' in look ? look.dot : look.fg }]} />
      )}
    </View>
  );
}

export function DayPill({ dayId, state }: { dayId: string; state: string }) {
  const look: Look = PILL_LOOK[state as keyof typeof PILL_LOOK] ?? PILL_LOOK.planning;
  const known = state in PILL_LOOK ? state : 'planning';
  return (
    <View
      testID={`day-pill-${dayId}`}
      style={[styles.pill, { backgroundColor: look.bg }, 'border' in look && { borderWidth: layout.pillBorder, borderColor: look.border }]}
    >
      <PillIcon state={known} look={look} dayId={dayId} />
      <Text numberOfLines={1} style={[text('label'), { color: look.fg }]}>
        {dayPill(state)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: layout.pillHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-1'],
    paddingHorizontal: space['space-2'],
    borderRadius: radius['r-full'],
  },
  icon: { width: layout.pillIcon, height: layout.pillIcon, alignItems: 'center', justifyContent: 'center' },
  dot: { width: layout.pillDot, height: layout.pillDot, borderRadius: radius['r-full'], borderStyle: 'dashed', borderWidth: layout.pillBorder },
  whiteDot: { width: layout.pillWhiteDot, height: layout.pillWhiteDot, borderRadius: radius['r-full'] },
});
