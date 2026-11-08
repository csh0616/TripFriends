// TASK-010 §C3 날짜 목록 (SC-03 위, DESIGN-001 §4-9): 날 줄마다 알약 + 글자. 상태는 서버가 계산해 준 값(state)을 그대로 쓴다.
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { CloseIcon } from '@/components/planning/icons';
import { ScreenFrame } from '@/components/planning/screen-frame';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { CityCover } from '@/components/trips/city-cover';
import { cityClock } from '@/lib/calendar';
import { dayDestination, dayPill, type DayDestination } from '@/lib/day-list';
import { fixedEventError } from '@/lib/create-trip';
import { send } from '@/lib/planning-api';
import { layout } from '@/planning/layout';
import { color, control, radius, space, text } from '@/planning/theme';

import { tripRequests, type FixedEvent, type Trip, type TripDay } from './api';
import { getDeviceId } from './device-id';
import { FixedEventSheet } from './fixed-event-sheet';
import { dayLabel } from './format';

const FAILED = '일정을 못 지웠어';

const pad = (value: number) => String(value).padStart(2, '0');
const clockOf = (iso: string): string => {
  const clock = cityClock(Date.parse(iso));
  return `${pad(Math.floor(clock.minutes / 60))}:${pad(clock.minutes % 60)}`;
};

const PILL_LOOK = {
  planning: { fg: 'ink', bg: 'bg-2' },
  planned: { fg: 'ok', bg: 'ok-bg' },
  today: { fg: 'ink', bg: 'brand-soft' },
  past: { fg: 'muted', bg: 'bg-2' },
} as const;

export function TripDays({
  trip,
  onOpen,
  onTripChange,
  onNewTrip,
}: {
  trip: Trip;
  onOpen: (day: TripDay, destination: DayDestination) => void;
  onTripChange: (trip: Trip) => void;
  onNewTrip: () => void;
}) {
  const [sheetDay, setSheetDay] = useState<TripDay | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (dayId: string, edit: (events: FixedEvent[]) => FixedEvent[]) =>
    onTripChange({ ...trip, trip_days: trip.trip_days.map((day) => (day.day_id === dayId ? { ...day, fixed_events: edit(day.fixed_events) } : day)) });

  const open = (day: TripDay) => {
    setHint(null);
    onOpen(day, dayDestination(day.state, day.chosen_option_id !== null));
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

  return (
    <>
      <ScreenFrame title="오사카 여행" subtitle={`${dayLabel(trip.start_date)} ~ ${dayLabel(trip.end_date)}`}>
        <CityCover size="banner" style={styles.banner} />
        {trip.trip_days.map((day, index) => (
          <DayRow key={day.day_id} day={day} number={index + 1} onOpen={() => open(day)} onAdd={() => setSheetDay(day)} onRemove={(event) => void remove(day, event)} />
        ))}
        {hint ? (
          <Text testID="day-list-hint" style={text('caption', 'muted')}>
            {hint}
          </Text>
        ) : null}
        {busy ? <ActivityIndicator color={color.muted} /> : null}
        <SecondaryButton testID="new-trip" label="새 여행 만들기" onPress={onNewTrip} />
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
    </>
  );
}

function DayRow({
  day,
  number,
  onOpen,
  onAdd,
  onRemove,
}: {
  day: TripDay;
  number: number;
  onOpen: () => void;
  onAdd: () => void;
  onRemove: (event: FixedEvent) => void;
}) {
  const look = PILL_LOOK[day.state] ?? PILL_LOOK.planning;
  return (
    <Pressable
      testID={`day-row-${day.day_id}`}
      accessible={false} // 알약·고정 일정·[+ 일정]을 따로 읽히게 한다
      accessibilityRole="button"
      onPress={onOpen}
      style={[styles.row, day.state === 'past' ? styles.rowPast : styles.rowFull, day.state === 'today' && styles.rowToday]}
    >
      <View style={styles.top}>
        <View style={styles.grow}>
          <Text style={text('heading')}>{`${number}일째`}</Text>
          <Text style={text('caption', 'muted')}>{dayLabel(day.date)}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: color[look.bg] }]}>
          <Text style={text('label', look.fg)}>{dayPill(day.state)}</Text>
        </View>
      </View>
      {day.fixed_events.map((event) => (
        <View key={event.fixed_event_id} style={styles.event}>
          <Text style={[text('num-md'), styles.time]}>{`${clockOf(event.start_at)}~${clockOf(event.end_at)}`}</Text>
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
        <SecondaryButton small testID={`add-fixed-${day.day_id}`} label="+ 일정" onPress={onAdd} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: radius['r-xl'], alignSelf: 'center' },
  grow: { flex: 1 },
  row: { borderRadius: radius['r-lg'], backgroundColor: color['bg-2'], padding: space['space-4'], gap: space['space-2'] },
  rowPast: { minHeight: layout.rowPast },
  rowFull: { minHeight: layout.rowPlanned },
  rowToday: { backgroundColor: color['brand-soft'], borderWidth: layout.selRing, borderColor: color.brand },
  top: { flexDirection: 'row', alignItems: 'center', gap: space['space-3'] },
  pill: { paddingHorizontal: space['space-3'], paddingVertical: space['space-1'], borderRadius: radius['r-full'] },
  event: { flexDirection: 'row', alignItems: 'center', gap: space['space-2'] },
  time: { minWidth: layout.timeColumn },
  remove: { width: control['touch-min'], height: control['touch-min'], alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row' },
});
