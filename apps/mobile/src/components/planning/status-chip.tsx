// TASK-004 §B-6 G6: 상태는 색 + 글자를 항상 같이 보여 준다 (확인됨/미확인/모름).
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import type { HoursChip } from '@/lib/today-hours-text';
import { color, control, fit, fitText, radius, space, text } from '@/planning/theme';

import { ClockIcon } from './icons';

type Status = 'confirmed' | 'unverified' | 'unknown';

const LOOK: Record<Status, { label: string; fg: keyof typeof color; bg: keyof typeof color }> = {
  confirmed: { label: '확인됨', fg: 'ok', bg: 'ok-bg' },
  unverified: { label: '미확인', fg: 'warn', bg: 'warn-bg' },
  unknown: { label: '모름', fg: 'muted', bg: 'bg-2' },
};

/** TASK-015 §27 칩 ㉠ (task-014-design §10-1) · §28 질문 1: 영업 값이 옆에 없는 자리의 긴 칩 글자 */
const LONG_LABEL: Record<Status, string> = { confirmed: '영업시간 확인됨', unverified: '영업시간 미확인', unknown: '영업시간 모름' };

/**
 * 칩 글자 자리 (task-015-design §15-5 · TASK-015 §29): 'short' = 옆에 영업 값이 있음(짧게) · 'long' = 라벨 줄(영업 값 없음, 길게) ·
 * 'row' = T-03 줄(폭 때문에 확인됨 · 미확인은 짧게, 값 자리가 빈 모름만 길게)
 */
export type ChipWords = 'short' | 'long' | 'row';
const wordsOf = (status: Status, words: ChipWords): string => (words === 'long' || (words === 'row' && status === 'unknown') ? LONG_LABEL[status] : LOOK[status].label);

/**
 * onOpen이 있으면 미확인 · 모름 칩만 누르는 버튼(보이는 24 · 누르는 44, task-014-design §10-1). 확인됨 칩은 버튼이 아니다 (§15-5).
 * TASK-015 §31 (task-015-design §16-1 · §16-6): 버튼 칩은 글 뒤에 "›"를 붙이고, 화면 읽기 이름은 "{칩 글}, 눌러서 확인하기"
 */
export function StatusChip({ status, words = 'short', onOpen }: { status: Status; words?: ChipWords; onOpen?: () => void }) {
  const look = LOOK[status];
  const label = wordsOf(status, words);
  const button = onOpen !== undefined && status !== 'confirmed';
  const chip = (
    <View style={[styles.chip, button && styles.chipWithMark, { backgroundColor: color[look.bg] }]}>
      <Text style={text('label', look.fg)}>{label}</Text>
      {button ? <Text style={[text('label', look.fg), styles.mark]}>›</Text> : null}
    </View>
  );
  if (!button) return chip;
  const slop = Math.max(0, (control['touch-min'] - fit['fact-line'].height) / 2);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, 눌러서 확인하기`}
      hitSlop={{ top: slop, bottom: slop, left: 0, right: 0 }}
      onPress={onOpen}
      style={styles.chipHit}
    >
      {chip}
    </Pressable>
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
  // 누르는 칩: 보이는 24 + 위아래 hitSlop = 44, 폭도 44 이상 (§10-1)
  chipHit: { minHeight: fit['fact-line'].height, minWidth: control['touch-min'], justifyContent: 'center' },
  // › 자리: 칩 오른쪽 안쪽에 둔다 (글과 같은 줄, 글 뒤 4)
  chipWithMark: { paddingRight: space['space-2'] + space['space-1'] + space['space-2'] },
  mark: { position: 'absolute', right: space['space-2'], top: 0, bottom: 0, textAlignVertical: 'center', lineHeight: fit['fact-line'].height },
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
export function HoursChipView({ chip, words = 'short', onOpen }: { chip: HoursChip; words?: ChipWords; onOpen?: () => void }) {
  if (chip === null) return null;
  return chip === 'hint' ? <HintChip /> : <StatusChip status={chip} words={words} onOpen={onOpen} />;
}
