// TASK-004 §B-6 G6: 상태는 색 + 글자를 항상 같이 보여 준다 (확인됨/미확인/모름).
import { StyleSheet, Text, View } from 'react-native';

import { color, radius, space, text } from '@/planning/theme';

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
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: space['space-2'],
    paddingVertical: space['space-1'] / 2,
    borderRadius: radius['r-full'],
  },
});
