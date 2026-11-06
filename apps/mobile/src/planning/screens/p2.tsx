// P2 후보 고르기 (TASK-004 §B-4, §6, §12 Q5·Q7·Q8·Q29·Q32). CandidateBatch를 그린다. 숫자는 모두 서버 값.
import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ScrollViewInstance,
} from 'react-native';

import { FriendBubble } from '@/components/planning/friend-bubble';
import { DrawnRing } from '@/components/planning/drawn-ring';
import { CheckIcon, CloseIcon, PlusIcon } from '@/components/planning/icons';
import { Notice } from '@/components/planning/notice';
import { PhotoPlaceholder } from '@/components/planning/photo-placeholder';
import { PrimaryButton } from '@/components/planning/primary-button';
import { ScreenFrame } from '@/components/planning/screen-frame';
import { StatusChip } from '@/components/planning/status-chip';
import { distanceLabel } from '@/lib/distance-label';
import { requests, type CandidateBatch } from '@/lib/planning-api';
import { todayHoursText } from '@/lib/today-hours-text';

import { dayName, daySubtitle, pad2 } from '../format';
import { layout } from '../layout';
import { color, control, radius, space, text } from '../theme';
import type { NoticeData, Send } from './types';

const MAX_CIRCLES = 3;

export type NextBody = NonNullable<Parameters<typeof requests.next>[1]>;

export function P2Screen({
  batch,
  picks,
  picksCount,
  busy,
  notice,
  onReact,
  onNext,
  onCompose,
}: {
  batch: CandidateBatch;
  picks: string[];
  picksCount: number;
  busy: boolean;
  notice: NoticeData | null;
  onReact: Send<[string, 'like' | 'skip' | 'unlike']>;
  onNext: Send<[NextBody | undefined]>;
  onCompose: Send;
}) {
  const { width } = useWindowDimensions();
  const cardWidth = width - layout.cardGutter;
  const step = cardWidth + space['space-3'];
  const scroller = useRef<ScrollViewInstance>(null);
  const { day, candidates } = batch;
  const chips = batch.clarify ?? batch.directions; // §6: clarify가 있으면 그 칩만
  const total = candidates.length;

  // 새 묶음이 오면 맨 앞 카드부터
  useEffect(() => {
    scroller.current?.scrollTo({ x: 0, animated: false });
  }, [batch.round]);

  const categoryOf = (placeId: string) =>
    candidates.find((c) => c.place.id === placeId)?.place.category ?? 'landmark';

  const compose = () => {
    if (!busy) void onCompose();
  };
  const next = (body?: NextBody) => {
    if (!busy) void onNext(body);
  };

  const like = (id: string) => {
    if (busy) return;
    void onReact(id, picks.includes(id) ? 'unlike' : 'like');
  };
  const skip = async (id: string, index: number) => {
    if (busy) return;
    const ok = await onReact(id, 'skip');
    if (ok) scroller.current?.scrollTo({ x: (index + 1) * step, animated: true });
  };

  return (
    <ScreenFrame
      title={`${dayName(day.day_number)} 고르는 중`}
      subtitle={daySubtitle(day)}
      input={{ onSend: (value) => next({ text: value }), disabled: busy }}
      footer={
        <>
          <View style={styles.picked}>
            <View style={styles.circles}>
              {Array.from({ length: MAX_CIRCLES }, (_, slot) => {
                const id = picks[slot];
                const style = [styles.circle, slot > 0 && styles.overlap];
                return id !== undefined ? (
                  <View key={`p-${slot}`} testID="picked-circle" style={[style, styles.clip]}>
                    <PhotoPlaceholder category={categoryOf(id)} style={StyleSheet.absoluteFill} />
                  </View>
                ) : (
                  <View key={`e-${slot}`} testID="empty-circle" style={[style, styles.emptyCircle]} />
                );
              })}
            </View>
            <Text style={text('caption')}>{`${picksCount}곳 담았어`}</Text>
          </View>
          <PrimaryButton label="코스 짜기" testID="compose-button" disabled={busy} onPress={compose} />
        </>
      }
    >
      <FriendBubble message={batch.message} />
      {busy ? <ActivityIndicator color={color.muted} /> : null}
      {notice ? <Notice message={notice.message} tone={notice.tone} onRetry={notice.onRetry} retryDisabled={busy} /> : null}

      {chips.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {chips.map((chip) => (
            <Pressable
              key={chip.id}
              testID={batch.clarify ? `clarify-${chip.id}` : `direction-${chip.id}`}
              accessibilityRole="button"
              disabled={busy}
              hitSlop={{ top: layout.chipSlop, bottom: layout.chipSlop }}
              onPress={() => next({ direction_id: chip.id })}
              style={[styles.chip, busy && styles.chipOff]}
            >
              <Text style={text('label', busy ? 'muted' : 'ink')}>{chip.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <ScrollView
        ref={scroller}
        horizontal
        snapToInterval={step}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.carousel}
        style={styles.bleed}
      >
        {candidates.map(({ place, why }, index) => {
          const liked = picks.includes(place.id);
          const hours = todayHoursText(place.facts);
          return (
            <View key={place.id} testID={`candidate-card-${place.id}`} style={{ width: cardWidth }}>
              <PhotoPlaceholder category={place.category} style={styles.photo}>
                <View style={styles.counter}>
                  <Text style={text('num-md')}>{`${pad2(index + 1)} / ${pad2(total)}`}</Text>
                </View>
                {liked ? (
                  <View style={styles.markWrap}>
                    <View testID={`picked-mark-${place.id}`} style={styles.mark}>
                      <CheckIcon color={color['on-brand']} />
                    </View>
                    <DrawnRing size={layout.pickedMark + 2 * layout.markRing} />
                  </View>
                ) : null}
              </PhotoPlaceholder>
              <Text style={styles.name}>{place.name}</Text>
              <Text style={text('body')}>{why}</Text>
              <View style={styles.actions}>
                <Pressable
                  testID={`skip-${place.id}`}
                  accessibilityRole="button"
                  accessibilityLabel="패스"
                  disabled={busy}
                  onPress={() => void skip(place.id, index)}
                  style={[styles.round, styles.skipButton]}
                >
                  <CloseIcon color={busy ? color.muted : color.ink} />
                </Pressable>
                <Pressable
                  testID={`like-${place.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={liked ? '담기 취소' : '담기'}
                  accessibilityState={{ selected: liked }}
                  disabled={busy}
                  onPress={() => like(place.id)}
                  style={[styles.round, liked ? styles.likedButton : styles.likeButton, busy && styles.roundOff]}
                >
                  {liked ? (
                    <CheckIcon color={busy ? color.muted : color['on-brand']} />
                  ) : (
                    <PlusIcon color={busy ? color.muted : color.surface} />
                  )}
                </Pressable>
              </View>
              <View style={styles.facts}>
                <StatusChip status={hours.chip} />
                <Text style={text('caption', 'muted')}>{hours.text}</Text>
                <Text style={text('caption', 'muted')}>
                  {distanceLabel(day.lodging, { lat: place.lat, lng: place.lng })}
                </Text>
              </View>
            </View>
          );
        })}

        <View testID="end-card" style={[styles.endCard, { width: cardWidth }]}>
          {batch.exhausted ? (
            <>
              {/* §13-3 끝 카드: 소진이면 앱 고정 글, 서버 message는 말풍선에만 */}
              <Text style={text('heading')}>코스 짜 볼까?</Text>
              <PrimaryButton label="코스 짜기" disabled={busy} onPress={compose} />
            </>
          ) : (
            <>
              <Text style={text('heading')}>다른 곳도 볼래?</Text>
              {/* §6: 서버 message와 앱 문구가 겹치면 서버 문구. 앱 문구는 소진이 아닐 때만 */}
              <PrimaryButton label="다른 곳 보여 줘" disabled={busy} onPress={() => next()} />
            </>
          )}
        </View>
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  picked: { flexDirection: 'row', alignItems: 'center', gap: space['space-3'], flexShrink: 1 },
  circles: { flexDirection: 'row' },
  circle: { width: layout.pickedCircle, height: layout.pickedCircle, borderRadius: radius['r-full'] },
  overlap: { marginLeft: -layout.pickedOverlap },
  clip: { overflow: 'hidden' },
  emptyCircle: { backgroundColor: color['bg-2'] },
  // 칩 보이는 높이 36 + 위아래 hitSlop 4 = 44. 스크롤 안쪽 위아래 여백으로 그 4가 잘리지 않게 한다 (§13-2 #3)
  chips: { gap: space['space-2'], paddingVertical: layout.chipSlop },
  chip: {
    height: control.chip,
    paddingHorizontal: space['space-4'],
    borderRadius: radius['r-full'],
    backgroundColor: color['brand-soft'],
    justifyContent: 'center',
  },
  chipOff: { backgroundColor: color['bg-2'] },
  roundOff: { backgroundColor: color['bg-2'] },
  bleed: { marginHorizontal: -layout.screenMargin },
  carousel: { paddingHorizontal: layout.screenMargin, gap: space['space-3'], alignItems: 'flex-start' },
  photo: { height: layout.photo, borderRadius: radius['r-lg'], marginBottom: space['space-3'] },
  counter: {
    position: 'absolute',
    top: space['space-3'],
    left: space['space-3'],
    backgroundColor: color.surface,
    borderRadius: radius['r-full'],
    paddingHorizontal: space['space-3'],
    paddingVertical: space['space-1'],
  },
  markWrap: {
    position: 'absolute',
    top: space['space-3'],
    right: space['space-3'],
    width: layout.pickedMark + 2 * layout.markRing,
    height: layout.pickedMark + 2 * layout.markRing,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: layout.pickedMark,
    height: layout.pickedMark,
    borderRadius: radius['r-full'],
    backgroundColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...text('heading'), marginBottom: space['space-1'] },
  actions: { flexDirection: 'row', gap: space['space-3'], marginTop: space['space-3'] },
  round: {
    width: control['btn-sm'],
    height: control['btn-sm'],
    borderRadius: radius['r-full'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButton: { backgroundColor: color['bg-2'] },
  likeButton: { backgroundColor: color.ink },
  likedButton: { backgroundColor: color.brand },
  facts: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space['space-2'], marginTop: space['space-3'] },
  endCard: {
    minHeight: layout.photo,
    borderRadius: radius['r-lg'],
    backgroundColor: color['bg-2'],
    padding: space['space-5'],
    gap: space['space-4'],
    justifyContent: 'center',
  },
});
