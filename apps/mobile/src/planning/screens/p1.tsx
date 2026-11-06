// P1 첫 질문 (TASK-004 §B-4, §12 Q4·Q6·Q9·Q32). PlanningSession을 그린다.
import { useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { FriendBubble } from '@/components/planning/friend-bubble';
import { CheckIcon } from '@/components/planning/icons';
import { Notice } from '@/components/planning/notice';
import { PhotoPlaceholder } from '@/components/planning/photo-placeholder';
import { PrimaryButton } from '@/components/planning/primary-button';
import { ScreenFrame } from '@/components/planning/screen-frame';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { requests, type PlanningSession } from '@/lib/planning-api';

import { useDraw } from '../draw';

import { dayName, daySubtitle, mustVisitLine, timeToMinutes } from '../format';
import { layout } from '../layout';
import { color, radius, space, text } from '../theme';
import type { NoticeData, Send } from './types';

// 보기 id -> 자리표시 그라데이션 종류 (사진을 받기 전 임시 표시)
const TILE_CATEGORY: Record<string, string> = {
  walk_alley: 'walk',
  food_tour: 'food',
  shopping: 'shop',
  night_view: 'night',
  cafe: 'cafe',
  museum_experience: 'museum',
};

export type AnswerBody = Parameters<typeof requests.answer>[1];
type ChoiceId = NonNullable<AnswerBody['choice_ids']>[number];

/** 고른 타일의 고리. 같은 움직임 부품(useDraw, dur-draw)으로 나타난다 (§13-2 #8, 움직임 줄이기면 0) */
function Ring() {
  const progress = useDraw();
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [layout.ringFrom, 1] });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ scale }] }]}>
      <View pointerEvents="none" style={styles.ringBrand} />
      <View pointerEvents="none" style={styles.ringWhite} />
    </Animated.View>
  );
}

export function P1Screen({
  session,
  busy,
  notice,
  onAnswer,
}: {
  session: PlanningSession;
  busy: boolean;
  notice: NoticeData | null;
  onAnswer: Send<[AnswerBody]>;
}) {
  const [chosen, setChosen] = useState<ChoiceId[]>([]);
  const { question, day } = session;

  const toggle = (id: ChoiceId) => setChosen((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  const rows: (typeof question.choices)[] = [];
  for (let i = 0; i < question.choices.length; i += 2) rows.push(question.choices.slice(i, i + 2));

  const dayStart = timeToMinutes(day.start);
  const span = Math.max(1, timeToMinutes(day.end) - dayStart);
  const percent = (time: string) => Math.min(100, Math.max(0, ((timeToMinutes(time) - dayStart) / span) * 100));
  const mustNames = day.must_visits.map((m) => m.name);

  return (
    <ScreenFrame
      title={`${dayName(day.day_number)} 계획`}
      subtitle={daySubtitle(day)}
      input={{ onSend: (value) => void onAnswer({ choice_ids: chosen, text: value }), disabled: busy }}
      footer={
        <>
          <SecondaryButton
            label="알아서 짜 줘"
            disabled={busy}
            onPress={() => {
              if (!busy) void onAnswer({ auto: true });
            }}
          />
          <View style={styles.grow}>
            <PrimaryButton
              label={chosen.length === 0 ? '아무거나 찾아 줘' : '이걸로 찾아 줘'}
              disabled={busy}
              onPress={() => {
                if (!busy) void onAnswer({ choice_ids: chosen });
              }}
            />
          </View>
        </>
      }
    >
      <FriendBubble message={question.text} />
      {busy ? <ActivityIndicator color={color.muted} /> : null}
      {notice ? <Notice message={notice.message} tone={notice.tone} onRetry={notice.onRetry} retryDisabled={busy} /> : null}

      <View style={styles.grid}>
        {rows.map((row) => (
          <View key={row[0].id} style={styles.gridRow}>
            {row.map((choice) => {
              const on = chosen.includes(choice.id as ChoiceId);
              return (
                <Pressable
                  key={choice.id}
                  testID={`choice-${choice.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => toggle(choice.id as ChoiceId)}
                  style={styles.tile}
                >
                  <PhotoPlaceholder category={TILE_CATEGORY[choice.id] ?? 'landmark'} style={StyleSheet.absoluteFill} />
                  {on ? <Ring /> : null}
                  <View style={styles.pill}>
                    {on ? <CheckIcon color={color.ink} size={layout.checkSmall} /> : null}
                    {/* 미정(§13): 알약 글자는 고르기 전후 모두 label. 고른 표시는 체크와 고리가 맡는다 */}
                    <Text style={styles.pillText}>{choice.label}</Text>
                  </View>
                </Pressable>
              );
            })}
            {row.length === 1 ? <View style={styles.grow} /> : null}
          </View>
        ))}
      </View>

      <View testID="timetable" style={styles.timetable}>
        <Text style={text('caption', 'muted')}>오늘 시간표</Text>
        <Text style={text('num-md')}>{`${day.start}~${day.end}`}</Text>
        <View style={styles.track}>
          {day.fixed.map((item) => (
            <View
              key={`${item.start}-${item.name}`}
              testID="timetable-segment"
              style={[
                styles.segment,
                {
                  left: `${percent(item.start)}%`,
                  width: `${Math.max(0, percent(item.end) - percent(item.start))}%`,
                },
              ]}
            />
          ))}
        </View>
        {day.fixed.map((item) => (
          <Text key={`legend-${item.start}-${item.name}`} style={text('caption', 'muted')}>
            {`${item.start} ${item.name}`}
          </Text>
        ))}
        {/* TASK-004 미정: Q40 꼭 갈 곳이 여럿이면 조사 없이 쉼표로 이어 쓴다 (mustVisitLine) */}
        {mustNames.length > 0 ? <Text style={text('body')}>{mustVisitLine(mustNames)}</Text> : null}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  grid: { gap: space['space-3'] },
  gridRow: { flexDirection: 'row', gap: space['space-3'] },
  tile: {
    flex: 1,
    height: layout.tile,
    borderRadius: radius['r-lg'],
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: space['space-2'],
  },
  ringBrand: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius['r-lg'],
    borderWidth: layout.ringBrand,
    borderColor: color.brand,
  },
  ringWhite: {
    ...StyleSheet.absoluteFill,
    margin: layout.ringBrand,
    borderRadius: radius['r-lg'] - layout.ringBrand,
    borderWidth: layout.ringWhite,
    borderColor: color.surface,
  },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-1'],
    backgroundColor: color.surface,
    borderRadius: radius['r-full'],
    paddingHorizontal: space['space-3'],
    paddingVertical: space['space-1'],
  },
  pillText: text('label'),
  timetable: { backgroundColor: color['bg-2'], borderRadius: radius['r-xl'], padding: space['space-4'], gap: space['space-2'] },
  track: { height: layout.barHeight, borderRadius: radius['r-full'], backgroundColor: color.surface, overflow: 'hidden' },
  segment: { position: 'absolute', top: 0, bottom: 0, backgroundColor: color.ink },
});
