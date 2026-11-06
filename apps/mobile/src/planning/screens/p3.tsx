// P3 코스안 (TASK-004 §B-4, §12 Q5·Q8·Q14·Q39·Q41, §13 Q33). CourseResult를 그린다. 숫자·시각은 서버 값 그대로.
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Path, Polyline, Text as SvgText } from 'react-native-svg';

import { HOME_PATH } from '@/components/planning/icons';
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
import { bold, color, control, radius, shadow, space, text } from '../theme';
import type { NoticeData, Send } from './types';

const LABEL_TEXT = { relaxed: '느긋하게', packed: '꽉 채워서' } as const;
const REASON_TEXT = {
  closed_at_time: '그 시간엔 닫혀',
  no_time: '시간이 모자라',
  fixed_conflict: '다른 일정과 겹쳐',
} as const;
const STEP_MIN = 15 as const;

export function P3Screen({
  course,
  busy,
  notice,
  onAdjust,
  onBack,
  onSelect,
}: {
  course: CourseResult;
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
      // §13 Q33: P3 부제는 "{날 이름} · {n}곳"
      subtitle={`${dayName(day.day_number)} · ${items.length}곳`}
      onBack={back}
      backDisabled={busy}
      input={{
        onSend: () => undefined,
        disabled: true,
        hint: '코스는 위에서 바꿀 수 있어',
      }}
      footer={
        <>
          {empty ? (
            <>
              {/* 주 버튼은 늘 맨 오른쪽 (§13-2 #9, Q41) */}
              <SecondaryButton label="이걸로 할래" disabled={busy} onPress={select} />
              <View style={styles.grow}>
                <PrimaryButton label="더 고를래" disabled={busy} onPress={back} />
              </View>
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
                {/* 미정(TASK-005): 토글 글자는 caption */}
                <Text style={on ? bold('caption', 'ink') : text('caption', 'muted')}>{LABEL_TEXT[o.label]}</Text>
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
            stops={items.flatMap((item) =>
              item.lat !== null && item.lng !== null ? [{ seq: item.seq, lat: item.lat, lng: item.lng }] : [],
            )}
          />
          <Text style={text('caption', 'muted')}>{`${items.length}곳 · 이동 ${option.total_travel_min}분`}</Text>

          {empty ? <Text style={text('body', 'muted')}>담은 곳이 없어서 코스가 비었어</Text> : null}

          <View style={styles.list}>
            {items.map((item, index) => (
              <Row
                key={item.seq}
                first={index === 0}
                last={index === items.length - 1}
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
  first,
  last,
  item,
  must,
  open,
  busy,
  onToggle,
  onAdjust,
}: {
  first: boolean;
  last: boolean;
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
      <Text style={text('caption')}>{formatStay(item.stay_min)}</Text>
      {item.stay_source === 'user' ? <Text style={text('label', 'muted')}>바꿈</Text> : null}
    </>
  );

  return (
    <View testID={`course-row-${item.seq}`} style={[styles.row, open && styles.rowOpen]}>
      {/* 번호 원을 잇는 선: 첫 줄은 원 아래부터, 끝 줄은 원 위까지. 한 줄뿐이면 없다 */}
      {first && last ? null : (
        <View
          testID="course-line"
          style={[styles.line, first ? styles.lineFirst : last ? styles.lineLast : styles.lineMiddle]}
        />
      )}
      <View style={styles.rowMain}>
        <Text style={styles.time}>{item.start}</Text>
        <View style={styles.number}>
          <Text style={text('num-md', 'surface')}>{String(item.seq)}</Text>
        </View>
        <View style={styles.rowText}>
          {/* 미정(TASK-005): 줄 이름은 heading */}
          <Text numberOfLines={1} style={text('heading')}>
            {item.name}
          </Text>
          <View testID={`course-row-sub-${item.seq}`} style={styles.sub}>
            <Text
              numberOfLines={1}
              // 미정(TASK-005): 보조 줄은 caption
              style={[text('caption', 'muted'), styles.subText]}
            >{`${kind}이동 ${item.travel_min}분`}</Text>
            {/* Q39 hours_status가 null(장소 없는 고정 일정)이면 칩을 숨긴다 */}
            {item.hours_status ? <StatusChip status={item.hours_status} /> : null}
          </View>
        </View>
        {placeId !== null ? (
          <Pressable testID={`stay-${placeId}`} accessibilityRole="button" onPress={onToggle} style={styles.stay}>
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
 * 동선 도식 (지도 SDK 없음). 숙소 + 코스 항목 좌표(A8)를 상자에 맞춰 그린다.
 * 좌표 없는 줄(장소 없는 고정 일정)은 그림에서 빼고 목록에는 둔다. 번호는 목록과 같은 seq.
 */
function RouteDiagram({
  width,
  home,
  stops,
}: {
  width: number;
  home: { lat: number; lng: number };
  stops: { seq: number; lat: number; lng: number }[];
}) {
  const height = layout.routeDiagram;
  const points = projectRoute([home, ...stops], width, height, layout.routePad);
  const homeScale = layout.routeHomeIcon / control.icon;
  const line = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <View testID="route-diagram" style={[styles.diagram, { width, height }]}>
      <Svg width={width} height={height}>
        {stops.length > 0 ? (
          <Polyline
            testID="route-line"
            points={line}
            fill="none"
            stroke={color.brand}
            strokeWidth={layout.routeLine}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        <Circle
          testID="route-home"
          cx={points[0].x}
          cy={points[0].y}
          r={layout.routeHome}
          fill={color.surface}
          stroke={color.ink}
          strokeWidth={layout.routeHomeStroke}
        />
        {/* 24칸 집 선을 14로 줄여 원 가운데에 놓는다. 선 굵기는 줄어든 만큼 키워 icon-stroke 그대로 보이게 한다 */}
        <G
          testID="route-home-icon"
          width={layout.routeHomeIcon}
          height={layout.routeHomeIcon}
          transform={`translate(${points[0].x - layout.routeHomeIcon / 2} ${points[0].y - layout.routeHomeIcon / 2}) scale(${homeScale})`}
        >
          <Path
            d={HOME_PATH}
            fill="none"
            stroke={color.ink}
            strokeWidth={control['icon-stroke'] / homeScale}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </G>
        {stops.map((stop, i) => (
          <Circle
            key={`n-${stop.seq}`}
            testID={`route-stop-${stop.seq}`}
            cx={points[i + 1].x}
            cy={points[i + 1].y}
            r={layout.routeNode}
            fill={color.ink}
          />
        ))}
        {stops.map((stop, i) => (
          <SvgText
            key={`t-${stop.seq}`}
            x={points[i + 1].x}
            y={points[i + 1].y + layout.dot - 1}
            fill={color.surface}
            textAnchor="middle"
            fontFamily={text('num-md').fontFamily}
            fontSize={text('num-md').fontSize}
          >
            {/* 미정(§13): 번호는 좌표 없는 줄을 빼도 seq 그대로 (목록 번호와 같게) */}
            {String(stop.seq)}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  toggle: {
    flexDirection: 'row',
    backgroundColor: color['bg-2'],
    borderRadius: radius['r-full'],
    padding: space['space-1'],
  },
  toggleButton: {
    flex: 1,
    height: control['touch-min'],
    borderRadius: radius['r-full'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: color.surface, ...shadow.raise }, // 판 위에 살짝 뜬 칸 (sh-raise)
  diagram: {
    borderRadius: radius['r-lg'],
    backgroundColor: color['bg-2'],
    overflow: 'hidden',
  },
  list: {},
  row: {
    minHeight: layout.courseRow,
    paddingHorizontal: space['space-3'],
    borderRadius: radius['r-lg'],
  },
  rowOpen: { backgroundColor: color['bg-2'] },
  rowMain: {
    height: layout.courseRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-2'],
  },
  time: { ...text('num-md'), width: layout.timeColumn },
  number: {
    width: layout.numberCircle,
    height: layout.numberCircle,
    borderRadius: radius['r-full'],
    backgroundColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: {
    position: 'absolute',
    width: layout.courseLine,
    backgroundColor: color.line,
    // 번호 원 가운데 = 안쪽 여백 + 시각 칸 + 간격 + 원 반지름
    left: space['space-3'] + layout.timeColumn + space['space-2'] + layout.numberCircle / 2 - layout.courseLine / 2,
  },
  lineFirst: { top: layout.courseRow / 2, bottom: 0 },
  lineMiddle: { top: 0, bottom: 0 },
  lineLast: { top: 0, height: layout.courseRow / 2 },
  rowText: { flex: 1 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: space['space-2'] },
  subText: { flexShrink: 1 },
  stay: {
    minWidth: layout.stayColumn,
    minHeight: control['touch-min'],
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  steps: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space['space-2'],
  },
  check: {
    backgroundColor: color['bg-2'],
    borderRadius: radius['r-xl'],
    padding: space['space-4'],
    gap: space['space-2'],
  },
});
