// TASK-015 §D · task-015-design §2: 코스 카드를 누르면 실제 지도 위 경로·핀·축척을 크게 보기. 카드마다 지도를 띄우면 무거워 누른 카드 하나만.
// 지도를 못 불러오면(그리다 던지거나 8초 안에 준비 신호 없음) onFail로 닫고 도식 카드 그대로 (§6). 장소 정보는 쓰는 순간 보이기만 (저장 없음).
import { Component, useContext, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Text } from '@/components/app-text';
import { CourseMap, type CourseStop } from '@/components/now/map-adapter';
import { CloseIcon } from '@/components/planning/icons';
import { MonoText } from '@/components/trips/parts';
import { PrimaryButton } from '@/components/planning/primary-button';
import { SosButton } from '@/components/planning/sos-button';
import { SosSheet } from '@/components/planning/sos-sheet';
import { layout } from '@/planning/layout';
import { color, control, radius, shadow, space, text } from '@/planning/theme';

const SHEET_INNER = 134; // course-bar 안쪽 (TASK-015 §24: + 실제 아래 안전영역, 34면 168)
const SIDE = 38; // 경로 맞춤 좌우 여백 = 핀 중심 기준 (핀 가장자리 24 + 반지름 14, §24)
const LOGO_ROOM = 40; // Google 로고 + 여유
const LABEL_ROOM = 28; // 이름표 높이 자리

class MapGuard extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function CourseMapScreen({
  dayNumber,
  labelText,
  stops,
  home,
  summary,
  busy,
  onClose,
  onPick,
  onFail,
}: {
  dayNumber: number;
  /** "느긋하게" / "꽉 채워서" */
  labelText: string;
  stops: CourseStop[];
  home: { lat: number; lng: number } | null;
  /** "5곳 · 이동 45분" */
  summary: string;
  busy: boolean;
  onClose: () => void;
  onPick: () => void;
  onFail: () => void;
}) {
  const known = useContext(SafeAreaInsetsContext); // 없으면 판 위치를 모름 -> 이름표 없이 핀만 (§22 막는 2. 위쪽 0은 정상 값)
  const insets = known ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const [sosOpen, setSosOpen] = useState(false);
  const sheet = SHEET_INNER + insets.bottom;
  const { width, height } = useWindowDimensions();
  // 떠 있는 판 = 위 버튼 줄 · 아래 course-bar (이름표가 피한다, TASK-015 §17)
  const panels = [
    { x: 0, y: insets.top + space['space-2'], width, height: control['touch-min'] },
    { x: 0, y: height - sheet, width, height: sheet },
  ];
  return (
    <View testID="course-map-screen" style={styles.root}>
      <MapGuard onError={onFail}>
        <CourseMap
          stops={stops}
          home={home ? { latitude: home.lat, longitude: home.lng } : null}
          padding={{ top: insets.top + layout.header + LABEL_ROOM, bottom: sheet + LOGO_ROOM, left: SIDE, right: SIDE }}
          scaleBottom={sheet + space['space-2'] + 2}
          panels={known ? panels : null}
          onReady={() => undefined}
          onFail={onFail}
        />
      </MapGuard>
      <View pointerEvents="box-none" style={[styles.top, { top: insets.top + space['space-2'] }]}>
        <Pressable testID="map-close" accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={styles.circle}>
          <CloseIcon color={color.ink} />
        </Pressable>
        <View style={styles.pill}>
          <MonoText value={`${dayNumber}일째 · ${labelText}`} base={text('label', 'ink')} />
        </View>
        <SosButton onPress={() => setSosOpen(true)} />
      </View>
      <View testID="course-bar" style={[styles.sheet, { height: sheet }]}>
        <View style={styles.sheetText}>
          <Text style={text('heading')}>{labelText}</Text>
          <MonoText value={summary} base={text('caption', 'muted')} />
        </View>
        <PrimaryButton testID="course-pick" label="이걸로 할래" disabled={busy} onPress={onPick} />
      </View>
      {sosOpen ? <SosSheet onClose={() => setSosOpen(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: color['bg-2'] },
  top: { position: 'absolute', left: space['space-4'], right: space['space-4'], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  circle: { width: control['touch-min'], height: control['touch-min'], borderRadius: radius['r-full'], backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', ...shadow.float },
  pill: { height: layout.titlePill, paddingHorizontal: space['space-4'], borderRadius: radius['r-full'], backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', ...shadow.float },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.surface,
    borderTopLeftRadius: radius['r-xl'],
    borderTopRightRadius: radius['r-xl'],
    paddingTop: space['space-5'],
    paddingHorizontal: space['space-5'],
    gap: space['space-3'],
    ...shadow.sheet,
  },
  sheetText: { gap: space['space-1'] },
});
