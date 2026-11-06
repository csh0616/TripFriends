// P3 코스안 (TASK-004 §B-4, §12 Q5·Q8·Q14·Q39·Q41, 미정 Q33). CourseResult를 그린다. 숫자·시각은 서버 값 그대로.
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Polyline, Text as SvgText } from 'react-native-svg';

import { Notice } from '@/components/planning/notice';
import { PrimaryButton } from '@/components/planning/primary-button';
import { ScreenFrame } from '@/components/planning/screen-frame';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { StatusChip } from '@/components/planning/status-chip';
import { formatStay } from '@/lib/format-stay';
import type { CourseItem, CourseResult } from '@/lib/planning-api';
import { projectRoute } from '@/lib/project-route';

import { dayName } from '../format';
import { layout } from '../layout';
import { color, control, radius, space, text } from '../theme';
import type { NoticeData, Send } from './types';

const LABEL_TEXT = { relaxed: '느긋하게', packed: '꽉 채워서' } as const;
const REASON_TEXT = {
  closed_at_time: '그 시간엔 닫혀',
  no_time: '시간이 모자라',
  fixed_conflict: '다른 일정과 겹쳐',
} as const;
const STEP_MIN = 15 as const;

type Coordinates = Record<string, { lat: number; lng: number }>;

export function P3Screen({
  course,
  coordinates,
  busy,
  notice,
  onAdjust,
  onBack,
  onSelect,
}: {
  course: CourseResult;
  /** 지금까지 본 후보의 좌표 (코스 항목에는 좌표가 없다) */
  coordinates: Coordinates;
  busy: boolean;
  notice: NoticeData | null;
  onAdjust: Send<[string, string, 15 | -15]>;
  onBack: Send;
  onSelect: Send<[string]>;
}) {
  const { width } = useWindowDimensions();
  const [label, setLabel] = useState<'relaxed' | 'packed'>('relaxed');
  const [open, setOpen] = useState<string | null>(null);

  // Q14: 보던 label의 안을 보여 주고, 없으면 첫 안
  const option = course.options.find((o) => o.label === label) ?? course.options[0];
  const { day } = course;
  const items = option?.items ?? [];
  const mustIds = new Set(day.must_visits.map((m) => m.place_id));

  const back = () => {
    if (!busy) void onBack();
  };
  const select = () => {
    if (!busy && option) void onSelect(option.option_id);
  };
  const adjust = (placeId: string, delta: 15 | -15) => {
    if (!busy && option) void onAdjust(option.option_id, placeId, delta);
  };

  const empty = items.length === 0;

  return (
    <ScreenFrame
      title="코스 짜 봤어"
      // TASK-004 미정: Q33 P3 부제는 §B-4대로 "{날 이름} · {n}곳" (W40은 skip)
      subtitle={`${dayName(day.day_number)} · ${items.length}곳`}
      onBack={back}
      backDisabled={busy}
      input={{ onSend: () => undefined, disabled: true, hint: '코스는 위에서 바꿀 수 있어' }}
      footer={
        <>
          {empty ? (
            <>
              <View style={styles.grow}>
                <PrimaryButton label="더 고를래" disabled={busy} onPress={back} />
              </View>
              <SecondaryButton label="이걸로 할래" disabled={busy} onPress={select} />
            </>
          ) : (
            <>
              <SecondaryButton label="더 고를래" disabled={busy} onPress={back} />
              <View style={styles.grow}>
                <PrimaryButton label="이걸로 할래" disabled={busy} onPress={select} />
              </View>
            </>
          )}
        </>
      }
    >
      {busy ? <ActivityIndicator color={color.muted} /> : null}
      {notice ? (
        <Notice message={notice.message} tone={notice.tone} onRetry={notice.onRetry} retryDisabled={busy} />
      ) : null}

      {course.options.length > 1 ? (
        <View style={styles.toggle}>
          {course.options.map((o) => {
            const on = o === option;
            return (
              <Pressable
                key={o.option_id}
                testID={`option-${o.label}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  setLabel(o.label);
                  setOpen(null);
                }}
                style={[styles.toggleButton, on && styles.toggleOn]}
              >
                <Text style={text('caption', on ? 'surface' : 'ink')}>{LABEL_TEXT[o.label]}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {option ? (
        <>
          <RouteDiagram
            width={width - 2 * layout.screenMargin}
            home={day.lodging}
            stops={items.map((item) => (item.place_id ? coordinates[item.place_id] : undefined))}
          />
          <Text style={text('heading')}>{`${items.length}곳 · 이동 ${option.total_travel_min}분`}</Text>

          {empty ? <Text style={text('body', 'muted')}>담은 곳이 없어서 코스가 비었어</Text> : null}

          <View style={styles.list}>
            {items.map((item) => (
              <Row
                key={item.seq}
                item={item}
                must={item.place_id !== null && mustIds.has(item.place_id)}
                open={open !== null && open === item.place_id}
                busy={busy}
                onToggle={() => setOpen((now) => (now === item.place_id ? null : item.place_id))}
                onAdjust={adjust}
              />
            ))}
          </View>

          <View style={styles.check}>
            <Text style={text('heading')}>
              {option.dropped.length === 0 ? '빠진 곳 없어' : `${option.dropped.length}곳은 못 넣었어`}
            </Text>
            {option.dropped.map((d) => (
              <Text key={d.place_id} style={text('body', 'muted')}>
                {`${d.name} · ${REASON_TEXT[d.reason]}`}
              </Text>
            ))}
            <Text style={text('body')}>{`숙소까지 ${option.go_home_min}분`}</Text>
          </View>
        </>
      ) : null}
    </ScreenFrame>
  );
}

function Row({
  item,
  must,
  open,
  busy,
  onToggle,
  onAdjust,
}: {
  item: CourseItem;
  must: boolean;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onAdjust: (placeId: string, delta: 15 | -15) => void;
}) {
  // 고정 일정 줄은 머문 시간을 바꿀 수 없다 (§10-10 R6). 장소 없는 줄도 마찬가지.
  const placeId = !item.is_fixed ? item.place_id : null;
    const kind = item.is_fixed ? '고정 일정 · ' : must ? '꼭 갈 곳 · ' : '';
  const stay = (
    <>
      <Text style={text('num-md')}>{formatStay(item.stay_min)}</Text>
      {item.stay_source === 'user' ? <Text style={text('label', 'muted')}>바꿈</Text> : null}
    </>
  );

  return (
    <View testID={`course-row-${item.seq}`} style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.time}>{item.start}</Text>
        <View style={styles.number}>
          <Text style={text('label', 'surface')}>{String(item.seq)}</Text>
        </View>
        <View style={styles.rowText}>
          <Text style={text('heading')}>{item.name}</Text>
          <Text style={text('caption', 'muted')}>{`${kind}이동 ${item.travel_min}분`}</Text>
          {/* TASK-004 미정: Q39 hours_status가 null(장소 없는 고정 일정)이면 칩을 숨긴다 */}
          {item.hours_status ? <StatusChip status={item.hours_status} /> : null}
        </View>
        {placeId !== null ? (
          <Pressable
            testID={`stay-${placeId}`}
            accessibilityRole="button"
            onPress={onToggle}
            style={styles.stay}
          >
            {stay}
          </Pressable>
        ) : (
          <View style={styles.stay}>{stay}</View>
        )}
      </View>
      {placeId !== null && open ? (
        <View style={styles.steps}>
          <SecondaryButton
            small
            testID={`stay-minus-${placeId}`}
            label={`−${STEP_MIN}`}
            disabled={busy}
            onPress={() => onAdjust(placeId, -15)}
          />
          <SecondaryButton
            small
            testID={`stay-plus-${placeId}`}
            label={`+${STEP_MIN}`}
            disabled={busy}
            onPress={() => onAdjust(placeId, STEP_MIN)}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * 동선 도식 (지도 SDK 없음). 숙소 + 장소를 상자에 맞춰 그린다.
 * TASK-004 미정: Q45 코스 항목에 좌표가 없어서, 본 적 있는 후보의 좌표만 쓴다.
 * 좌표를 모르는 줄이 하나라도 있으면 (다시 켠 뒤 등) 정확한 위치 대신 같은 간격으로 늘어놓는다.
 */
function RouteDiagram({
  width,
  home,
  stops,
}: {
  width: number;
  home: { lat: number; lng: number };
  stops: ({ lat: number; lng: number } | undefined)[];
}) {
  const height = layout.routeDiagram;
  const known = stops.every((s) => s !== undefined);
  const points = known
    ? projectRoute([home, ...(stops as { lat: number; lng: number }[])], width, height, layout.routePad)
    : [home, ...stops].map((_, i, all) => ({
        x: layout.routePad + (i * (width - 2 * layout.routePad)) / Math.max(1, all.length - 1),
        y: height / 2,
      }));
  const line = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <View testID="route-diagram" style={[styles.diagram, { width, height }]}>
      <Svg width={width} height={height}>
        <Polyline
          points={line}
          fill="none"
          stroke={color.brand}
          strokeWidth={layout.routeLine}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx={points[0].x} cy={points[0].y} r={layout.routeHome} fill={color.surface} />
        <Circle cx={points[0].x} cy={points[0].y} r={layout.dot} fill={color.ink} />
        {points.slice(1).map((p, i) => (
          <Circle key={`n-${i}`} cx={p.x} cy={p.y} r={layout.routeNode} fill={color.ink} />
        ))}
        {points.slice(1).map((p, i) => (
          <SvgText
            key={`t-${i}`}
            x={p.x}
            y={p.y + layout.dot - 1}
            fill={color.surface}
            textAnchor="middle"
            fontFamily={text('label').fontFamily}
            fontSize={text('label').fontSize}
          >
            {String(i + 1)}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  toggle: { flexDirection: 'row', backgroundColor: color['bg-2'], borderRadius: radius['r-full'], padding: space['space-1'] },
  toggleButton: {
    flex: 1,
    height: control['touch-min'],
    borderRadius: radius['r-full'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: color.ink },
  diagram: { borderRadius: radius['r-lg'], backgroundColor: color['bg-2'], overflow: 'hidden' },
  list: { gap: space['space-3'] },
  row: { backgroundColor: color['bg-2'], borderRadius: radius['r-lg'], padding: space['space-3'], gap: space['space-2'] },
  rowMain: { flexDirection: 'row', alignItems: 'flex-start', gap: space['space-2'] },
  time: { ...text('num-md'), width: layout.timeColumn },
  number: {
    width: layout.numberCircle,
    height: layout.numberCircle,
    borderRadius: radius['r-full'],
    backgroundColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: space['space-1'] },
  stay: { minWidth: layout.stayColumn, minHeight: control['touch-min'], alignItems: 'flex-end', justifyContent: 'center' },
  steps: { flexDirection: 'row', justifyContent: 'flex-end', gap: space['space-2'] },
  check: { backgroundColor: color['bg-2'], borderRadius: radius['r-xl'], padding: space['space-4'], gap: space['space-2'] },
});
