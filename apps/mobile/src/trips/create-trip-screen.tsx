// TASK-010 §C2 SC-01 여행 만들기: 도시(오사카) -> 날짜 -> 숙소(선택) -> 꼭 갈 곳(선택) -> [여행 만들기].
// 규칙(날짜 범위·하루 5곳·같은 곳은 한 날에만·못 누르는 이유)은 lib/create-trip.ts·calendar.ts, 판단은 서버. 여기서는 그리기만 한다.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { GoogleMark } from '@/components/google-mark';
import { CheckIcon, CloseIcon, HouseIcon } from '@/components/planning/icons';
import { PhotoPlaceholder } from '@/components/planning/photo-placeholder';
import { PrimaryButton } from '@/components/planning/primary-button';
import { ScreenFrame } from '@/components/planning/screen-frame';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { CityCover } from '@/components/trips/city-cover';
import { AddDot, ChipButton, FieldBox, InfoNotice, SearchInput } from '@/components/trips/parts';
import { cityToday } from '@/lib/calendar';
import {
  addMustVisit,
  canAddMustVisit,
  createBlocker,
  createTripBody,
  emptyForm,
  lodgingQueryReady,
  mustVisitDayNumber,
  placeQueryReady,
  tripDates,
  type TripForm,
} from '@/lib/create-trip';
import { AUTH_FAILED, authNotice, SIGNIN_DOWN, STORAGE_DOWN } from '@/lib/auth-messages';
import { send, type Failure } from '@/lib/planning-api';
import { layout } from '@/planning/layout';
import { color, control, radius, space, text } from '@/planning/theme';

import { CalendarSheet } from './calendar-sheet';
import { tripRequests, isTrip, type LodgingHit, type SearchPlace, type Trip } from './api';
import { AREA_NAME, dayLabel, shortDay } from './format';

const LODGING_DOWN = '지금 숙소 검색을 못 해. 숙소 없이도 만들 수 있어';
const OFFLINE = '연결이 안 돼. 다시 해 볼까?';
const OOPS = '잠깐 문제가 생겼어';
const RETRY_BANNERS = [STORAGE_DOWN, AUTH_FAILED, SIGNIN_DOWN]; // §6·Q7·Q12: 안내 + [다시], 입력값은 그대로
const NOT_FOUND = '찾는 곳이 없어. 다른 말로 찾아볼래?';
const FIELD_MESSAGE: Record<string, string> = {
  start_date: '가는 날을 다시 골라 줘',
  end_date: '오는 날을 다시 골라 줘. 기간은 1~7일이야',
  lodging_place_id: '숙소를 다시 골라 줘',
  must_visits: '꼭 갈 곳을 다시 확인해 줘. 하루 5곳까지, 같은 곳은 한 날에만 담을 수 있어',
};
const GENERIC_INVALID = '입력을 다시 확인해 줘';

type Errors = Record<string, string>;
type Lookup<T> = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; items: T[] } | { state: 'down' };

/** 검색 요청 하나: 마지막으로 보낸 것만 반영한다 (앞 요청의 늦은 응답은 버린다) */
function useLookup<T>(): [Lookup<T>, (run: (() => Promise<T[] | null>) | null) => void] {
  const [result, setResult] = useState<Lookup<T>>({ state: 'idle' });
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const start = (run: (() => Promise<T[] | null>) | null) => {
    seq.current += 1;
    const mine = seq.current;
    if (run === null) {
      setResult({ state: 'idle' });
      return;
    }
    setResult({ state: 'loading' });
    void run().then((items) => {
      if (!alive.current || mine !== seq.current) return;
      setResult(items === null ? { state: 'down' } : { state: 'ok', items });
    });
  };
  return [result, start];
}

export function CreateTripScreen({ onBack, onCreated }: { onBack: () => void; onCreated: (trip: Trip) => void }) {
  const [form, setForm] = useState<TripForm>(emptyForm);
  const [names, setNames] = useState<Record<string, string>>({}); // place_id -> 이름 (담은 곳 표시용)
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [lodgingQuery, setLodgingQuery] = useState('');
  const [mustQuery, setMustQuery] = useState('');
  const [lodgingHits, searchLodging] = useLookup<LodgingHit>();
  const [placeHits, searchPlaces] = useLookup<SearchPlace>();
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // 검색 칸을 쓰는 동안(키보드가 올라와 있는 동안)은 주 버튼 줄을 접고, 꼭 갈 곳 칸이면 위쪽(도시·날짜·숙소)도 접어서
  // 칸과 결과가 키보드 위에 보이게 한다. 키보드 신호가 아니라 칸의 포커스로 정한다
  const [focused, setFocused] = useState<'lodging' | 'must' | null>(null);
  const keyboard = focused !== null;
  const focusMode = focused === 'must';

  const today = cityToday(Date.now());
  const blocker = createBlocker(form);
  const dates = form.startDate && form.endDate ? tripDates(form.startDate, form.endDate) : [];
  const activeDay = day !== null && dates.includes(day) ? day : (dates[0] ?? null);

  const confirmDates = (range: { start: string; end: string }) => {
    const next = tripDates(range.start, range.end);
    setForm((now) => ({
      ...now,
      startDate: range.start,
      endDate: range.end,
      mustVisits: Object.fromEntries(Object.entries(now.mustVisits).filter(([date]) => next.includes(date))), // 날짜 밖으로 나간 꼭 갈 곳은 뺀다
    }));
    setDay(range.start);
    setCalendarOpen(false);
    setErrors((now) => ({ ...now, start_date: '', end_date: '' }));
  };

  const onLodgingText = (value: string) => {
    setLodgingQuery(value);
    if (!lodgingQueryReady(value)) return searchLodging(null);
    searchLodging(async () => {
      const result = await send(tripRequests.searchLodging(value));
      return result.ok && Array.isArray(result.data) ? (result.data as LodgingHit[]) : null;
    });
  };
  const onMustText = (value: string) => {
    setMustQuery(value);
    if (!placeQueryReady(value)) return searchPlaces(null);
    searchPlaces(async () => {
      const result = await send(tripRequests.searchPlaces(value));
      return result.ok && Array.isArray(result.data) ? (result.data as SearchPlace[]) : null;
    });
  };

  const pickLodging = (hit: LodgingHit) => {
    setForm((now) => ({ ...now, lodging: { place_id: hit.place_id, name: hit.name } }));
    setLodgingQuery('');
    searchLodging(null);
    setErrors((now) => ({ ...now, lodging_place_id: '' }));
  };

  const removeMust = (date: string, placeId: string) =>
    setForm((now) => ({ ...now, mustVisits: { ...now.mustVisits, [date]: (now.mustVisits[date] ?? []).filter((id) => id !== placeId) } }));

  const pickPlace = (hit: SearchPlace) => {
    if (activeDay === null) return;
    if (mustVisitDayNumber(form, hit.id) !== null || !canAddMustVisit(form, activeDay)) return; // 다른 날(또는 같은 날)에 담김 / 가득
    setNames((now) => ({ ...now, [hit.id]: hit.name }));
    setForm((now) => addMustVisit(now, activeDay, hit.id));
    setErrors((now) => ({ ...now, must_visits: '' }));
  };

  const submit = async () => {
    if (blocker !== null || submitting) return;
    setSubmitting(true);
    setBanner(null);
    const result = await send(tripRequests.create(createTripBody(form)));
    if (!alive.current) return;
    setSubmitting(false);
    if (result.ok && isTrip(result.data)) {
      onCreated(result.data);
      return;
    }
    if (result.ok) return setBanner(OOPS);
    showFailure(result.failure);
  };

  const showFailure = (failure: Failure) => {
    if (failure.kind === 'invalid') {
      // §9 Q13: detail.field 칸에 오류, 입력값은 그대로. 칸을 모르면 아래 안내
      const message = failure.field ? FIELD_MESSAGE[failure.field] : undefined;
      if (message) setErrors({ [failure.field as string]: message });
      else setBanner(GENERIC_INVALID);
    } else setBanner(authNotice(failure) ?? (failure.kind === 'network' ? OFFLINE : OOPS));
  };

  return (
    <>
    <ScreenFrame
      title="새 여행"
      onBack={onBack}
      action={
        keyboard ? undefined : (
        <>
          {blocker ? (
            <Text testID="create-trip-reason" style={text('caption', 'muted')}>
              {blocker}
            </Text>
          ) : null}
          {banner ? (
            <Text testID="create-trip-banner" style={text('caption', 'alert')}>
              {banner}
            </Text>
          ) : null}
          {banner && RETRY_BANNERS.includes(banner) ? <SecondaryButton small testID="retry-button" label="다시" disabled={submitting} onPress={() => void submit()} /> : null}
          <PrimaryButton testID="create-trip-submit" label="여행 만들기" disabled={blocker !== null || submitting} onPress={() => void submit()} />
        </>
        )
      }
    >
      {focusMode ? null : (
      <View style={styles.topRow}>
        <View testID="city-osaka" style={styles.city}>
          <CityCover size="tile" />
          <View style={styles.cityName}>
            <Text style={text('heading', 'surface')}>오사카</Text>
            <View style={styles.radioOn}>
              <CheckIcon color={color['on-brand']} size={layout.checkSmall} />
            </View>
          </View>
        </View>
        <View style={styles.dates}>
          <FieldBox id="start-date" label="가는 날" error={errors.start_date || null}>
            <DateField testID="field-start-date" value={form.startDate} placeholder="날짜 고르기" onPress={() => setCalendarOpen(true)} />
          </FieldBox>
          <FieldBox id="end-date" label="오는 날" error={errors.end_date || null}>
            <DateField testID="field-end-date" value={form.endDate} placeholder="날짜 고르기" onPress={() => setCalendarOpen(true)} />
          </FieldBox>
        </View>
      </View>
      )}

      {focusMode ? null : (
      <View style={styles.section}>
        <Text style={text('heading')}>숙소는 어디야? (선택)</Text>
        <FieldBox id="lodging" error={errors.lodging_place_id || null}>
          {form.lodging ? (
            <View testID="lodging-picked" style={styles.picked}>
              <View style={styles.thumb}>
                <HouseIcon color={color.muted} size={layout.lodgeIcon} />
              </View>
              <Text style={[text('body'), styles.grow]} numberOfLines={1}>
                {form.lodging.name}
              </Text>
              <Pressable testID="lodging-clear" accessibilityRole="button" accessibilityLabel="숙소 빼기" onPress={() => setForm((now) => ({ ...now, lodging: null }))} style={styles.hit}>
                <CloseIcon color={color.ink} size={control.icon - 6} />
              </Pressable>
            </View>
          ) : (
            <SearchInput testID="lodging-search" value={lodgingQuery} placeholder="숙소 이름으로 찾기" onChangeText={onLodgingText} onFocus={() => setFocused('lodging')} onBlur={() => setFocused(null)} />
          )}
        </FieldBox>
        {lodgingHits.state === 'down' ? <InfoNotice message={LODGING_DOWN} /> : null}
        {lodgingHits.state === 'ok' && lodgingQueryReady(lodgingQuery) ? (
          lodgingHits.items.length === 0 ? (
            <Empty />
          ) : (
            <View style={styles.googleBox}>
              {lodgingHits.items.slice(0, 5).map((hit, index) => (
                <Pressable key={hit.place_id} testID={`lodging-result-${hit.place_id}`} accessible={false} accessibilityRole="button" onPress={() => pickLodging(hit)} style={[styles.resultRow, index > 0 && styles.hair]}>
                  <View style={styles.thumb}>
                    <HouseIcon color={color.muted} size={layout.lodgeIcon} />
                  </View>
                  <View style={styles.grow}>
                    <Text style={text('heading')} numberOfLines={1}>
                      {hit.name}
                    </Text>
                    <Text style={text('caption', 'muted')} numberOfLines={1}>
                      {hit.address_short}
                    </Text>
                  </View>
                </Pressable>
              ))}
              <GoogleMark testID="g-footer" />
            </View>
          )
        ) : null}
      </View>
      )}

      <View style={styles.section}>
        <Text style={text('heading')}>꼭 가고 싶은 곳은? (선택)</Text>
        {activeDay === null ? (
          <Text style={text('caption', 'muted')}>날짜를 고르면 날마다 담을 수 있어</Text>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
              {dates.map((date, index) => (
                <ChipButton key={date} testID={`tab-day-${date}`} selected={date === activeDay} label={`${index + 1}일째 ${shortDay(date)}`} onPress={() => setDay(date)} />
              ))}
            </ScrollView>
            <FieldBox id="must-visits" label={`${dayLabel(activeDay)} · 하루 5곳까지`} error={errors.must_visits || null}>
              <SearchInput testID="must-search" value={mustQuery} placeholder="가고 싶은 곳 이름으로 찾기" onChangeText={onMustText} onFocus={() => setFocused('must')}
                onBlur={() => setFocused(null)} />
            </FieldBox>
            {(form.mustVisits[activeDay] ?? []).length > 0 ? (
              <View style={styles.chips}>
                {(form.mustVisits[activeDay] ?? []).map((id) => (
                  <Pressable key={id} testID={`must-picked-${id}`} accessibilityRole="button" accessibilityLabel={`${names[id] ?? id} 빼기`} onPress={() => removeMust(activeDay, id)} style={styles.pickedChip}>
                    <Text style={text('label')}>{names[id] ?? id}</Text>
                    <CloseIcon color={color.ink} size={layout.checkSmall} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            {placeHits.state === 'loading' ? <ActivityIndicator color={color.muted} /> : null}
            {placeHits.state === 'down' ? <InfoNotice message={OOPS} /> : null}
            {placeHits.state === 'ok' && placeQueryReady(mustQuery) ? (
              placeHits.items.length === 0 ? (
                <Empty />
              ) : (
                <View style={styles.googleBox}>
                  {placeHits.items.slice(0, 10).map((hit, index) => (
                    <PlaceRow key={hit.id} hit={hit} index={index} form={form} date={activeDay} onPress={() => pickPlace(hit)} />
                  ))}
                  {placeHits.items.some((hit) => hit.facts.some((fact) => fact.source_type === 'google')) ? <GoogleMark testID="g-footer" /> : null}
                </View>
              )
            ) : null}
          </>
        )}
      </View>
    </ScreenFrame>
    {calendarOpen ? <CalendarSheet initial={{ start: form.startDate, end: form.endDate }} today={today} onConfirm={confirmDates} onClose={() => setCalendarOpen(false)} /> : null}
    </>
  );
}

function Empty() {
  return (
    <View testID="empty-search" style={styles.empty}>
      <Text style={text('caption', 'muted')}>{NOT_FOUND}</Text>
    </View>
  );
}

function DateField({ testID, value, placeholder, onPress }: { testID: string; value: string | null; placeholder: string; onPress: () => void }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={styles.dateField}>
      <Text style={text('body', value ? 'ink' : 'muted')}>{value ? dayLabel(value) : placeholder}</Text>
    </Pressable>
  );
}

function PlaceRow({ hit, index, form, date, onPress }: { hit: SearchPlace; index: number; form: TripForm; date: string; onPress: () => void }) {
  const other = mustVisitDayNumber(form, hit.id);
  const here = (form.mustVisits[date] ?? []).includes(hit.id);
  const full = !canAddMustVisit(form, date);
  const locked = other !== null && !here;
  const blocked = locked || here || full;
  return (
    <Pressable
      testID={`must-result-${hit.id}`}
      accessible={false} // 글자(이름·지역·담김)를 따로 읽히게 한다
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked }}
      aria-disabled={blocked}
      onPress={() => !blocked && onPress()}
      style={[styles.resultRow, index > 0 && styles.hair]}
    >
      <View style={styles.thumbPlace}>
        <PhotoPlaceholder category={hit.image?.category ?? hit.category} style={StyleSheet.absoluteFill} />
      </View>
      <View style={styles.grow}>
        <Text style={locked ? text('heading', 'muted') : text('heading')} numberOfLines={1}>
          {hit.name}
        </Text>
        {hit.area ? (
          <Text style={text('caption', 'muted')} numberOfLines={1}>
            {AREA_NAME[hit.area] ?? hit.area}
          </Text>
        ) : null}
      </View>
      {locked ? (
        <View style={styles.otherDay}>
          <Text style={text('label', 'muted')}>{`${other}일째에 담김`}</Text>
        </View>
      ) : (
        <AddDot state={here ? 'added' : full ? 'full' : 'add'} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: space['space-3'] },
  grow: { flex: 1 },
  topRow: { flexDirection: 'row', gap: space['space-3'], alignItems: 'flex-start' },
  city: { width: layout.coverTile[0], height: layout.coverTile[1], borderRadius: radius['r-xl'], overflow: 'hidden' },
  cityName: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space['space-3'] },
  dates: { flex: 1, gap: space['space-2'] },
  radioOn: { width: layout.radio, height: layout.radio, borderRadius: radius['r-full'], backgroundColor: color.brand, alignItems: 'center', justifyContent: 'center' },
  dateField: { minHeight: layout.field, justifyContent: 'center', paddingHorizontal: space['space-4'], borderRadius: radius['r-md'], backgroundColor: color['bg-2'] },
  picked: { minHeight: control.input, flexDirection: 'row', alignItems: 'center', gap: space['space-3'], paddingLeft: space['space-2'], borderRadius: radius['r-md'], backgroundColor: color['bg-2'] },
  hit: { width: control['touch-min'], height: control['touch-min'], alignItems: 'center', justifyContent: 'center' },
  thumb: { width: layout.lodgeThumb, height: layout.lodgeThumb, borderRadius: radius['r-sm'], backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  thumbPlace: { width: layout.lodgeThumb, height: layout.lodgeThumb, borderRadius: radius['r-sm'], overflow: 'hidden' },
  googleBox: { backgroundColor: color['bg-2'], borderRadius: radius['r-lg'], padding: space['space-1'], overflow: 'hidden' },
  resultRow: { minHeight: layout.listRow, flexDirection: 'row', alignItems: 'center', gap: space['space-3'], paddingHorizontal: space['space-3'] },
  hair: { borderTopWidth: layout.actionBarLine, borderTopColor: color.line },
  tabs: { gap: space['space-2'], paddingVertical: layout.chipSlop },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space['space-2'] },
  pickedChip: { minHeight: layout.tabDay, flexDirection: 'row', alignItems: 'center', gap: space['space-2'], paddingHorizontal: space['space-3'], borderRadius: radius['r-full'], backgroundColor: color['brand-soft'] },
  otherDay: { height: layout.otherDayPill, paddingHorizontal: space['space-3'], borderRadius: radius['r-full'], backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  empty: { minHeight: layout.listRow, alignItems: 'center', justifyContent: 'center', borderRadius: radius['r-lg'], backgroundColor: color['bg-2'] },
});
