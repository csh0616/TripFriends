// TASK-010 §C3 날짜 목록 (SC-03 위, DESIGN-001 §4-9·§4-11). 날 상태는 서버가 계산해 준 값(state)을 그대로 쓴다.
// TASK-011: 머리(제목·점 진행·D-숫자) / 날 줄 크기 3가지(지난 날 68 · 계획 완료 84 · 계획 전 카드) / 아래 큰 버튼 하나(bottom-primary) /
// 주 버튼이 없으면 끝맺음 글(end-note) / 맨 끝 [새 여행 만들기](btn-new-trip) -> 확인 시트.
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Text } from '@/components/app-text';
import { CardButton } from '@/components/planning/card-button';
import { CheckIcon, CloseIcon, NextIcon, PlusIcon } from '@/components/planning/icons';
import { PhotoPlaceholder } from '@/components/planning/photo-placeholder';
import { ScreenFrame } from '@/components/planning/screen-frame';
import { CityCover } from '@/components/trips/city-cover';
import { DayPill } from '@/components/trips/day-pill';
import { cityClock, cityToday } from '@/lib/calendar';
import { dayDestination, dayListPrimary, shortDateLabel, tripHeader, type DayDestination } from '@/lib/day-list';
import { fixedEventError } from '@/lib/create-trip';
import { send } from '@/lib/planning-api';
import { dayName, timeRange } from '@/planning/format';
import { layout } from '@/planning/layout';
import { color, control, fit, fitText, radius, space, text } from '@/planning/theme';

import { tripRequests, type FixedEvent, type Trip, type TripDay } from './api';
import { getDeviceId } from './device-id';
import { FixedEventSheet } from './fixed-event-sheet';
import { periodLabel, summaryLine } from './format';
import { NewTripSheet } from './new-trip-sheet';

const FAILED = '일정을 못 지웠어';

const pad = (value: number) => String(value).padStart(2, '0');
const clockOf = (iso: string): string => {
  const clock = cityClock(Date.parse(iso));
  return `${pad(Math.floor(clock.minutes / 60))}:${pad(clock.minutes % 60)}`;
};

const FILLED = '●';

export function TripDays({
  trip,
  onOpen,
  onTripChange,
  onNewTrip,
}: {
  trip: Trip;
  /** mode 'auto' = 카드의 [알아서 짜 줘]: 대화 없이 바로 자동 계획 (TASK-011 §9 Q3) */
  onOpen: (day: TripDay, destination: DayDestination, mode?: 'auto') => void;
  onTripChange: (trip: Trip) => void;
  onNewTrip: () => void;
}) {
  const { width } = useWindowDimensions();
  const [sheetDay, setSheetDay] = useState<TripDay | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const today = cityToday(Date.now());
  const header = tripHeader(trip, today);
  const primary = dayListPrimary(trip.trip_days, today);
  const finished = trip.trip_days.every((day) => day.state === 'past');

  const change = (dayId: string, edit: (events: FixedEvent[]) => FixedEvent[]) =>
    onTripChange({ ...trip, trip_days: trip.trip_days.map((day) => (day.day_id === dayId ? { ...day, fixed_events: edit(day.fixed_events) } : day)) });

  const open = (day: TripDay, mode?: 'auto') => {
    setHint(null);
    onOpen(day, dayDestination(day.state, day.chosen_option_id !== null), mode);
  };
  const plan = (day: TripDay, mode?: 'auto') => {
    setHint(null);
    onOpen(day, 'planning', mode);
  };

  const remove = async (day: TripDay, event: FixedEvent) => {
    if (busy) return;
    setBusy(true);
    const result = await send(tripRequests.removeFixedEvent(await getDeviceId(), event.fixed_event_id));
    setBusy(false);
    if (result.ok) {
      setHint(null);
      change(day.day_id, (events) => events.filter((one) => one.fixed_event_id !== event.fixed_event_id));
    } else setHint((result.failure.kind === 'conflict' ? fixedEventError(409, result.failure.code ?? null) : null) ?? FAILED);
  };

  const primaryDay = primary ? trip.trip_days.find((day) => day.day_id === primary.dayId) : undefined;

  return (
    <>
      <ScreenFrame
        action={
          primary && primaryDay ? (
            <View style={styles.primaryWrap}>
              <Pressable testID="bottom-primary" accessibilityRole="button" onPress={() => open(primaryDay)} style={styles.primary}>
                <Text style={fitText(fit['bottom-primary'])}>{primary.label}</Text>
              </Pressable>
              {primary.sublabel ? <Text style={fitText(fit['bottom-primary'].sub)}>{primary.sublabel}</Text> : null}
            </View>
          ) : undefined
        }
      >
        <View style={styles.head}>
          <Text style={text('caption', 'muted')}>{periodLabel(trip.start_date, trip.end_date)}</Text>
          <Text style={fitText(fit['title-trip'])}>{header.title}</Text>
          <View style={styles.progress}>
            <View accessible accessibilityLabel={header.dots} style={styles.dots}>
              {Array.from(header.dots).map((dot, index) => (
                <View key={index} style={[styles.dotMark, dot === FILLED ? styles.dotFilled : styles.dotEmpty]} />
              ))}
            </View>
            <Text style={text('caption', 'muted')}>{header.line}</Text>
          </View>
        </View>
        <CityCover size="banner" width={width - layout.coverMargin} style={styles.banner} />
        {trip.trip_days.map((day, index) => {
          const card = day.state === 'planning' || (day.state === 'today' && day.chosen_option_id === null);
          return (
            <DayRow
              key={day.day_id}
              day={day}
              index={index}
              card={card}
              focus={card && primary?.dayId === day.day_id}
              onOpen={() => open(day)}
              onPlan={() => plan(day)}
              onAuto={() => plan(day, 'auto')}
              onAdd={() => setSheetDay(day)}
              onRemove={(event) => void remove(day, event)}
            />
          );
        })}
        {hint ? (
          <Text testID="day-list-hint" style={text('caption', 'muted')}>
            {hint}
          </Text>
        ) : null}
        {busy ? <ActivityIndicator color={color.muted} /> : null}
        {primary === null ? <EndNote finished={finished} count={trip.trip_days.length} /> : null}
        <View style={[styles.newTripSlot, primary === null && { marginBottom: fit['btn-new-trip'].bottom - layout.screenMargin }]}>
          <Pressable testID="new-trip" accessibilityRole="button" onPress={() => setConfirming(true)} style={styles.newTrip}>
            <Text style={fitText(fit['btn-new-trip'])}>새 여행 만들기</Text>
          </Pressable>
        </View>
      </ScreenFrame>
      {sheetDay ? (
        <FixedEventSheet
          tripId={trip.trip_id}
          dayId={sheetDay.day_id}
          date={sheetDay.date}
          onClose={() => setSheetDay(null)}
          onAdded={(event) => {
            change(sheetDay.day_id, (events) => [...events, event].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)));
            setSheetDay(null);
          }}
        />
      ) : null}
      {confirming ? (
        <NewTripSheet
          onConfirm={() => {
            setConfirming(false);
            onNewTrip();
          }}
          onKeep={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}

/** 주 버튼이 없을 때 끝맺음 글: 왜 버튼이 없는지 한 줄로 알려 준다 (E1) */
function EndNote({ finished, count }: { finished: boolean; count: number }) {
  const note = fit['end-note'];
  return (
    <View testID="end-note" style={styles.endNote}>
      <View style={styles.endCircle}>
        <CheckIcon color={color['ink-strong']} size={note.icon} />
      </View>
      <Text style={[fitText(note.title), styles.center]}>{finished ? '여행이 끝났어' : `${count}일 모두 정했어`}</Text>
      <Text style={[fitText(note.body), styles.center, styles.endBody]}>
        {finished ? '날짜를 누르면 고른 코스를 볼 수 있어' : '여행 첫날부터 아래에 ‘오늘 여행 보기’ 버튼이 나와'}
      </Text>
    </View>
  );
}

/** "2일째" + 날짜 "12/12 토" (한 줄, 이름은 굵게 날짜는 보조 색) */
function DayTitle({ index, date, small }: { index: number; date: string; small?: boolean }) {
  return (
    <View style={styles.title}>
      <Text numberOfLines={1} style={text(small ? 'body' : 'heading')}>
        {dayName(index + 1)}
      </Text>
      <Text numberOfLines={1} style={text('caption', 'muted')}>
        {shortDateLabel(date)}
      </Text>
    </View>
  );
}

function DayCircle({ past }: { past: boolean }) {
  const size = past ? layout.dayCirclePast : layout.dayCircle;
  return (
    <PhotoPlaceholder category="landmark" glyph={past ? layout.dayGlyphPast : layout.dayGlyph} style={{ width: size, height: size, borderRadius: radius['r-full'] }} />
  );
}

function DayRow({
  day,
  index,
  card,
  focus,
  onOpen,
  onPlan,
  onAuto,
  onAdd,
  onRemove,
}: {
  day: TripDay;
  index: number;
  /** 계획 전 카드 (계획 전 날, 코스가 없는 오늘) */
  card: boolean;
  /** 지금 할 일 카드 = 아래 큰 버튼이 가리키는 날: 큰 [같이 고르기] + [알아서 짜 줘] */
  focus: boolean;
  onOpen: () => void;
  onPlan: () => void;
  onAuto: () => void;
  onAdd: () => void;
  onRemove: (event: FixedEvent) => void;
}) {
  const summary = day.summary ?? null;
  const must = day.must_visits ?? [];
  const past = day.state === 'past';
  const today = day.state === 'today';

  // 코스 없는 지난 날: 누를 수 없는 줄 (TASK-011 §12 Q3). 요약 자리 "고른 코스 없음", › 없음, 아무 데도 안 감
  if (past && day.chosen_option_id === null) {
    return (
      <View testID={`row-locked-${day.day_id}`} accessibilityState={{ disabled: true }} aria-disabled style={[styles.row, styles.rowPast]}>
        <View testID={`day-row-${day.day_id}`} style={styles.lockedBody}>
          <DayCircle past />
          <View style={styles.grow}>
            <DayTitle index={index} date={day.date} small />
            <Text numberOfLines={1} style={text('caption', 'muted')}>
              고른 코스 없음
            </Text>
          </View>
          <DayPill dayId={day.day_id} state={day.state} />
        </View>
      </View>
    );
  }

  if (!card) {
    return (
      <Pressable
        testID={`day-row-${day.day_id}`}
        accessible={false} // 알약을 따로 읽히게 한다
        accessibilityRole="button"
        onPress={onOpen}
        style={[styles.row, past ? styles.rowPast : styles.rowPlanned, today && styles.rowToday]}
      >
        <DayCircle past={past} />
        <View style={styles.grow}>
          <DayTitle index={index} date={day.date} small={past} />
          {summary ? (
            <Text numberOfLines={1} style={text('caption', 'muted')}>
              {summaryLine(summary)}
            </Text>
          ) : null}
        </View>
        <DayPill dayId={day.day_id} state={day.state} />
        <NextIcon color={color.muted} size={layout.dayChevron} />
      </Pressable>
    );
  }

  return (
    <Pressable
      testID={`day-row-${day.day_id}`}
      accessible={false} // 알약·고정 일정·버튼을 따로 읽히게 한다
      accessibilityRole="button"
      onPress={onOpen}
      style={[styles.card, today && styles.rowToday]}
    >
      <View style={styles.top}>
        <View style={styles.grow}>
          <DayTitle index={index} date={day.date} />
        </View>
        <DayPill dayId={day.day_id} state={day.state} />
      </View>
      {must.length > 0 ? (
        <Text numberOfLines={1} style={text('caption', 'muted')}>{`꼭 갈 곳 · ${must.map((one) => one.name).join(', ')}`}</Text>
      ) : null}
      {day.fixed_events.map((event) => (
        <View key={event.fixed_event_id} style={styles.event}>
          <Text style={[text('num-md'), styles.time]}>{timeRange(clockOf(event.start_at), clockOf(event.end_at))}</Text>
          <Text style={[text('body'), styles.grow]} numberOfLines={1}>
            {event.title}
          </Text>
          <Pressable
            testID={`fixed-remove-${event.fixed_event_id}`}
            accessibilityRole="button"
            accessibilityLabel={`${event.title} 일정 지우기`}
            onPress={() => onRemove(event)}
            style={styles.remove}
          >
            <CloseIcon color={color.muted} size={layout.checkSmall} />
          </Pressable>
        </View>
      ))}
      <View style={styles.addRow}>
        <Pressable
          testID={`add-fixed-${day.day_id}`}
          accessibilityRole="button"
          accessibilityLabel="일정 추가"
          onPress={onAdd}
          hitSlop={{ top: addSlop, bottom: addSlop }}
          style={styles.addEvent}
        >
          <PlusIcon color={fit['btn-add-event'].fg} size={fit['btn-add-event'].icon} />
          <Text style={fitText(fit['btn-add-event'])}>일정</Text>
        </Pressable>
      </View>
      {focus ? (
        <View style={styles.pair}>
          <View style={styles.grow}>
            <CardButton size="large" testID={`card-plan-${day.day_id}`} label="같이 고르기" onPress={onPlan} />
          </View>
          <View style={styles.grow}>
            <CardButton size="auto" testID={`card-auto-${day.day_id}`} label="알아서 짜 줘" onPress={onAuto} />
          </View>
        </View>
      ) : (
        <View style={styles.addRow}>
          <CardButton size="small" testID={`card-plan-${day.day_id}`} label="같이 고르기" onPress={onPlan} />
        </View>
      )}
    </Pressable>
  );
}

const addSlop = (fit['btn-add-event'].hit - fit['btn-add-event'].height) / 2;

const styles = StyleSheet.create({
  banner: { borderRadius: radius['r-xl'], alignSelf: 'center' },
  grow: { flex: 1 },
  lockedBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space['space-3'] },
  title: { flexDirection: 'row', alignItems: 'baseline', gap: space['space-2'] },
  center: { textAlign: 'center' },
  head: { gap: space['space-1'] },
  progress: { flexDirection: 'row', alignItems: 'center', gap: space['space-2'] },
  dots: { flexDirection: 'row', alignItems: 'center', gap: space['space-1'] },
  dotMark: { width: layout.progressDot, height: layout.progressDot, borderRadius: radius['r-full'], borderWidth: layout.pillBorder, borderColor: color.ink },
  dotFilled: { backgroundColor: color.ink },
  dotEmpty: { backgroundColor: color.surface },
  row: { borderRadius: radius['r-lg'], backgroundColor: color['bg-2'], paddingHorizontal: space['space-4'], flexDirection: 'row', alignItems: 'center', gap: space['space-3'] },
  rowPast: { minHeight: layout.rowPast },
  rowPlanned: { minHeight: layout.rowPlanned },
  card: { borderRadius: radius['r-lg'], backgroundColor: color['bg-2'], padding: space['space-4'], gap: space['space-2'] },
  rowToday: { backgroundColor: color['brand-soft'], borderWidth: layout.selRing, borderColor: color.brand },
  top: { flexDirection: 'row', alignItems: 'center', gap: space['space-3'] },
  event: { flexDirection: 'row', alignItems: 'center', gap: space['space-2'] },
  time: { minWidth: layout.timeColumn },
  remove: { width: control['touch-min'], height: control['touch-min'], alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row' },
  addEvent: {
    height: fit['btn-add-event'].height,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-1'],
    paddingHorizontal: space['space-3'],
    borderRadius: fit['btn-add-event'].radius,
    backgroundColor: fit['btn-add-event'].bg,
    borderWidth: fit['btn-add-event'].borderWidth,
    borderColor: fit['btn-add-event'].border,
  },
  pair: { flexDirection: 'row', gap: space['space-2'] },
  primaryWrap: { alignItems: 'center', gap: space['space-1'] },
  primary: {
    alignSelf: 'stretch',
    height: fit['bottom-primary'].height,
    borderRadius: radius['r-md'],
    backgroundColor: fit['bottom-primary'].bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endNote: { marginTop: fit['end-note'].top - space['space-4'], alignItems: 'center', gap: space['space-2'] },
  endCircle: { width: fit['end-note'].circle, height: fit['end-note'].circle, borderRadius: radius['r-full'], backgroundColor: fit['end-note'].circleBg, alignItems: 'center', justifyContent: 'center' },
  endBody: { width: fit['end-note'].width },
  newTripSlot: { marginTop: 'auto' },
  newTrip: {
    minHeight: fit['btn-new-trip'].height,
    borderRadius: fit['btn-new-trip'].radius,
    backgroundColor: fit['btn-new-trip'].bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
