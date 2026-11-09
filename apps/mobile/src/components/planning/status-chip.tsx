// TASK-004 §B-6 G6: 상태는 색 + 글자를 항상 같이 보여 준다 (확인됨/미확인/모름).
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import type { HoursChip } from '@/lib/today-hours-text';
import { color, fit, fitText, radius, space, text } from '@/planning/theme';

import { ClockIcon } from './icons';

type Status = 'confirmed' | 'unverified' | 'unknown';

const LOOK: Record<Status, { label: string; fg: keyof typeof color; bg: keyof typeof color }> = {
  confirmed: { label: '확인됨', fg: 'ok', bg: 'ok-bg' },
  unverified: { label: '미확인', fg: 'warn', bg: 'warn-bg' },
  unknown: { label: '모름', fg: 'muted', bg: 'bg-2' },
};

export function StatusChip({ status }: { status: Status }) {
  const look = LOOK[status];
  return (
    <View style={[styles.chip, { backgroundColor: color[look.bg] }]}>
      <Text style={text('label', look.fg)}>{look.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    alignSelf: 'flex-start',
    height: fit['chip-hint'].height,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-1'],
    paddingHorizontal: space['space-2'],
    backgroundColor: fit['chip-hint'].bg,
    borderWidth: fit['chip-hint'].borderWidth,
    borderColor: fit['chip-hint'].border,
    borderRadius: fit['chip-hint'].radius,
  },
  chip: {
    minHeight: fit['fact-line'].height, // 사실 줄 칩 24
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: space['space-2'],
    paddingVertical: space['space-1'] / 2,
    borderRadius: radius['r-full'],
  },
});

/** chip-hint "추천 시간대": 윤곽 칩. 채운 칩(확인됨·미확인·모름)은 사실을 확인했나, 이 칩은 우리가 추천한 값 (색으로 섞이지 않는다) */
export function HintChip() {
  const hint = fit['chip-hint'];
  return (
    <View style={styles.hint}>
      <ClockIcon color={hint.fg} size={hint.icon} />
      <Text style={fitText(hint)}>추천 시간대</Text>
    </View>
  );
}

/** 영업시간 칸의 칩 하나: 없음 / 추천 시간대 / 확인 상태 */
export function HoursChipView({ chip }: { chip: HoursChip }) {
  if (chip === null) return null;
  return chip === 'hint' ? <HintChip /> : <StatusChip status={chip} />;
}
