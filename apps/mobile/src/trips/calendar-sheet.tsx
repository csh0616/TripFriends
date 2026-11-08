// TASK-010 §9 Q17·Q28 · DESIGN-001 §4-10 달력 시트: JS로 만든 한 달 칸. 시작 -> 끝 두 번 누르고, 확정은 시트 아래 주 버튼 하나.
// 날짜 규칙은 lib/calendar.ts. 여기서는 그리기만 한다.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/app-text';
import { NextIcon, BackIcon } from '@/components/planning/icons';
import { PrimaryButton } from '@/components/planning/primary-button';
import { addDays, daysBetween, endSelectable, monthGrid, pickDate, startSelectable, type DateRange } from '@/lib/calendar';
import { layout } from '@/planning/layout';
import { color, control, radius, shadow, space, text } from '@/planning/theme';

import { dayLabel, monthLabel, WEEKDAYS } from './format';

const START_WINDOW_DAYS = 180;

const shiftMonth = (month: string, by: number): string => {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return date.toISOString().slice(0, 7);
};

export function CalendarSheet({
  initial,
  today,
  onConfirm,
  onClose,
}: {
  initial: DateRange;
  today: string;
  onConfirm: (range: { start: string; end: string }) => void;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<DateRange>(initial);
  // §10 Q28: 고른 시작일이 있으면 그 달, 없으면 오늘이 있는 달
  const [month, setMonth] = useState((initial.start ?? today).slice(0, 7));
  const firstMonth = today.slice(0, 7);
  const lastMonth = addDays(today, START_WINDOW_DAYS).slice(0, 7);
  const pickingEnd = range.start !== null && range.end === null;

  const selectable = (date: string): boolean => {
    if (!startSelectable(date, today)) return false;
    if (!pickingEnd || range.start === null) return true;
    return daysBetween(date, range.start) < 0 || endSelectable(date, range.start); // 앞 날 = 새 시작 (Q28)
  };

  const guide =
    range.start === null
      ? '가는 날을 골라 줘'
      : range.end === null
        ? '오는 날을 골라 줘. 가는 날부터 최대 7일이야'
        : `${daysBetween(range.end, range.start) + 1}일 여행이야`;

  return (
    <View testID="calendar-overlay" style={styles.overlay}>
      <Pressable testID="calendar-scrim" accessibilityLabel="닫기" style={StyleSheet.absoluteFill} onPress={onClose} />
      <View testID="calendar-sheet" style={[styles.sheet, { height: Math.min(layout.sheetCal, height - layout.sheetCalMargin) }]}>
        <View style={styles.handleSlot}>
          <View style={styles.handle} />
        </View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.titleRow}>
            <Text style={text('heading')}>날짜 고르기</Text>
          </View>
          <View style={styles.fields}>
            <View style={[styles.field, range.end === null && styles.fieldActive]}>
              <Text style={text('label', 'muted')}>가는 날</Text>
              <Text style={text('body')}>{range.start ? dayLabel(range.start) : '—'}</Text>
            </View>
            <View style={[styles.field, range.start !== null && range.end === null && styles.fieldActive]}>
              <Text style={text('label', 'muted')}>오는 날</Text>
              <Text style={text('body')}>{range.end ? dayLabel(range.end) : '—'}</Text>
            </View>
          </View>

          <View style={styles.nav}>
            <NavButton testID="cal-prev" label="이전 달" off={month <= firstMonth} onPress={() => setMonth(shiftMonth(month, -1))}>
              <BackIcon color={month <= firstMonth ? color.muted : color.ink} size={control.icon - 6} />
            </NavButton>
            <Text style={text('heading')}>{monthLabel(month)}</Text>
            <NavButton testID="cal-next" label="다음 달" off={month >= lastMonth} onPress={() => setMonth(shiftMonth(month, 1))}>
              <NextIcon color={month >= lastMonth ? color.muted : color.ink} size={control.icon - 6} />
            </NavButton>
          </View>

          <View style={styles.week}>
            {WEEKDAYS.map((name) => (
              <View key={name} style={styles.head}>
                <Text style={text('label', 'muted')}>{name}</Text>
              </View>
            ))}
          </View>
          {monthGrid(month).map((week, row) => (
            <View key={row} style={styles.week}>
              {week.map((date, col) =>
                date === null ? (
                  <View key={`blank-${col}`} style={styles.cell} />
                ) : (
                  <DayCell key={date} date={date} today={today} range={range} ok={selectable(date)} onPress={() => setRange((now) => pickDate(now, date))} />
                ),
              )}
            </View>
          ))}

          <View testID="cal-slot" style={styles.slot}>
            <Text style={text('caption', 'muted')}>{guide}</Text>
          </View>
        </ScrollView>
        <View style={[styles.action, { paddingBottom: insets.bottom }]}>
          <PrimaryButton
            testID="calendar-confirm"
            label="이 날짜로 정할래"
            disabled={range.start === null || range.end === null}
            onPress={() => range.start !== null && range.end !== null && onConfirm({ start: range.start, end: range.end })}
          />
        </View>
      </View>
    </View>
  );
}

function NavButton({ testID, label, off, onPress, children }: { testID: string; label: string; off: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={onPress}
      hitSlop={(control['touch-min'] - layout.calNav) / 2}
      style={styles.navButton}
    >
      {children}
    </Pressable>
  );
}

function DayCell({ date, today, range, ok, onPress }: { date: string; today: string; range: DateRange; ok: boolean; onPress: () => void }) {
  const isStart = date === range.start;
  const isEnd = date === range.end;
  const inside = range.start !== null && range.end !== null && date > range.start && date < range.end;
  const edge = isStart || isEnd;
  const isToday = date === today;
  return (
    <Pressable
      testID={`cal-day-${date}`}
      accessibilityRole="button"
      accessibilityLabel={dayLabel(date)}
      accessibilityState={{ disabled: !ok, selected: edge }}
      disabled={!ok}
      onPress={() => ok && onPress()}
      style={styles.cell}
    >
      {inside || (edge && range.start !== range.end && range.end !== null) ? (
        <View style={[styles.band, isStart && styles.bandStart, isEnd && styles.bandEnd]} />
      ) : null}
      {!ok ? (
        <View style={styles.off}>
          <Text style={text('body', 'muted')}>{Number(date.slice(8, 10))}</Text>
        </View>
      ) : edge ? (
        <View style={styles.ring}>
          <View style={styles.disc}>
            <Text style={text('body', 'surface')}>{Number(date.slice(8, 10))}</Text>
          </View>
        </View>
      ) : (
        <Text style={isToday ? { ...text('body'), fontFamily: text('title').fontFamily } : text('body')}>{Number(date.slice(8, 10))}</Text>
      )}
      {isToday && !edge && ok ? <View style={styles.todayDot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', backgroundColor: color.scrim },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius['r-sheet'],
    borderTopRightRadius: radius['r-sheet'],
    overflow: 'hidden',
    ...shadow.sheet,
  },
  handleSlot: { height: layout.calHandle, alignItems: 'center', justifyContent: 'center' },
  handle: { width: layout.sheetHandleWidth, height: layout.sheetHandleHeight, borderRadius: radius['r-full'], backgroundColor: color.line },
  content: { paddingHorizontal: layout.screenMargin, paddingBottom: space['space-2'] },
  titleRow: { height: layout.calTitle, justifyContent: 'center' },
  fields: { flexDirection: 'row', gap: space['space-3'] },
  field: {
    flex: 1,
    height: layout.field,
    justifyContent: 'center',
    paddingHorizontal: space['space-4'],
    borderRadius: radius['r-md'],
    backgroundColor: color['bg-2'],
    borderWidth: layout.inputFocus,
    borderColor: 'transparent',
  },
  fieldActive: { borderColor: color['ink-strong'] },
  nav: { height: layout.calTitle, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navButton: { width: layout.calNav, height: layout.calNav, borderRadius: radius['r-full'], backgroundColor: color['bg-2'], alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  head: { width: layout.calCellW, height: layout.calHead, alignItems: 'center', justifyContent: 'center' },
  cell: { width: layout.calCellW, height: layout.calCellH, alignItems: 'center', justifyContent: 'center' },
  band: { position: 'absolute', left: 0, right: 0, height: layout.calBand, backgroundColor: color['brand-soft'] },
  bandStart: { left: '50%' },
  bandEnd: { right: '50%' },
  off: { width: layout.calOff, height: layout.calOff, borderRadius: radius['r-sm'], backgroundColor: color['bg-2'], alignItems: 'center', justifyContent: 'center' },
  ring: {
    width: layout.calDisc + 2 * layout.calRing,
    height: layout.calDisc + 2 * layout.calRing,
    borderRadius: radius['r-full'],
    borderWidth: layout.calRing,
    borderColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: { width: layout.calDisc, height: layout.calDisc, borderRadius: radius['r-full'], backgroundColor: color['ink-strong'], alignItems: 'center', justifyContent: 'center' },
  todayDot: { position: 'absolute', bottom: space['space-1'], width: layout.calTodayDot, height: layout.calTodayDot, borderRadius: radius['r-full'], backgroundColor: color.ink },
  slot: { height: layout.calSlot, justifyContent: 'center', paddingTop: space['space-1'] },
  action: { minHeight: layout.actionBar, paddingHorizontal: layout.screenMargin, justifyContent: 'center', borderTopWidth: layout.actionBarLine, borderTopColor: color.line },
});
