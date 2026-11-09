// TASK-010 §B3·C3 고정 일정 입력 시트 (sheet-form 500). 제목 1~30자, 시작·끝 시각. 겹침·시간 규칙·409는 서버가 판단하고 앱은 안내만 한다.
import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/app-text';
import { PrimaryButton } from '@/components/planning/primary-button';
import { fixedEventError } from '@/lib/create-trip';
import { send } from '@/lib/planning-api';
import { layout } from '@/planning/layout';
import { color, radius, shadow, space, text } from '@/planning/theme';

import { tripRequests, type FixedEvent } from './api';
import { FieldBox } from '@/components/trips/parts';
import { dayLabel } from './format';

const CITY_OFFSET = '+09:00'; // 오사카(Asia/Tokyo)에는 서머타임이 없다
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const TITLE_MAX = 30;
const TIME_HINT = '18:30처럼 써 줘';
const OFFLINE = '연결이 안 돼. 다시 해 볼까?';
const OOPS = '잠깐 문제가 생겼어';
const BAD_TIME = '시간을 다시 확인해 줘. 끝나는 시각이 더 뒤여야 하고, 다른 일정과 겹치면 안 돼';
const BAD_TITLE = `일정 이름을 1~${TITLE_MAX}자로 써 줘`;

const isoOf = (date: string, time: string) => `${date}T${time.padStart(5, '0')}:00${CITY_OFFSET}`;

export function FixedEventSheet({
  tripId,
  dayId,
  date,
  onAdded,
  onClose,
}: {
  tripId: string;
  dayId: string;
  date: string;
  onAdded: (event: FixedEvent) => void;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const trimmed = title.trim();
    const found: Record<string, string> = {};
    if (trimmed.length < 1 || trimmed.length > TITLE_MAX) found.title = BAD_TITLE;
    if (!TIME.test(start.trim())) found.start = TIME_HINT;
    if (!TIME.test(end.trim())) found.end = TIME_HINT;
    setErrors(found);
    setBanner(null);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const result = await send(
      tripRequests.addFixedEvent(tripId, {
        trip_day_id: dayId,
        title: trimmed,
        start_at: isoOf(date, start.trim()),
        end_at: isoOf(date, end.trim()),
      }),
    );
    setBusy(false);
    if (result.ok) {
      onAdded(result.data as FixedEvent);
      return;
    }
    const failure = result.failure;
    if (failure.kind === 'conflict') setBanner(fixedEventError(409, failure.code ?? null) ?? OOPS);
    else if (failure.kind === 'invalid') {
      if (failure.field === 'title') setErrors({ title: BAD_TITLE });
      else setBanner(BAD_TIME);
    } else setBanner(failure.kind === 'network' ? OFFLINE : OOPS);
  };

  return (
    <View testID="fixed-event-overlay" style={styles.overlay}>
      <Pressable testID="fixed-event-scrim" accessibilityLabel="닫기" style={StyleSheet.absoluteFill} onPress={onClose} />
      <View testID="fixed-event-sheet" style={[styles.sheet, { height: Math.min(layout.sheetForm, height - layout.sheetCalMargin), paddingBottom: insets.bottom + space['space-4'] }]}>
        <Text style={text('heading')}>{`${dayLabel(date)} 고정 일정`}</Text>
        <FieldBox id="title" label="일정 이름" error={errors.title ?? null}>
          <TextInput testID="fixed-title" value={title} onChangeText={setTitle} placeholder="예: 유니버설 스튜디오 입장" placeholderTextColor={color.muted} maxLength={TITLE_MAX + 10} style={styles.field} />
        </FieldBox>
        <View style={styles.times}>
          <View style={styles.time}>
            <FieldBox id="start" label="시작 시각" error={errors.start ?? null}>
              <TextInput testID="fixed-start" value={start} onChangeText={setStart} placeholder="18:30" placeholderTextColor={color.muted} keyboardType="numbers-and-punctuation" style={styles.field} />
            </FieldBox>
          </View>
          <View style={styles.time}>
            <FieldBox id="end" label="끝나는 시각" error={errors.end ?? null}>
              <TextInput testID="fixed-end" value={end} onChangeText={setEnd} placeholder="20:00" placeholderTextColor={color.muted} keyboardType="numbers-and-punctuation" style={styles.field} />
            </FieldBox>
          </View>
        </View>
        {banner ? (
          <Text testID="fixed-banner" style={text('caption', 'alert')}>
            {banner}
          </Text>
        ) : null}
        <PrimaryButton testID="fixed-submit" label="일정 넣기" disabled={busy} onPress={() => void submit()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', backgroundColor: color.scrim },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius['r-sheet'],
    borderTopRightRadius: radius['r-sheet'],
    padding: layout.screenMargin,
    gap: space['space-4'],
    ...shadow.sheet,
  },
  field: { ...text('body'), height: layout.field, paddingHorizontal: space['space-4'], borderRadius: radius['r-md'], backgroundColor: color['bg-2'] },
  times: { flexDirection: 'row', gap: space['space-3'] },
  time: { flex: 1 },
});
