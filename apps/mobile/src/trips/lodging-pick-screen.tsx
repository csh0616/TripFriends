// TASK-015 §A ③ · docs/design/reviews/task-015-design.md §1-3 a2 "지도에서 찍기" (+ §1-5 a4 지도를 못 불러옴).
// 앱은 그리기만 한다: 지도를 길게 눌러 핀 -> 이름 붙이기(선택) -> [여기로 정했어]. Google을 부르지 않는다 (지도 타일만).
// 50km 검사는 서버와 같은 규칙을 lib가 먼저 해서 바로 안내 · 비활성 (서버 POST /trips가 마지막에 다시 확인한다).
import { useContext, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Component, type ReactNode } from 'react';

import { Text, TextInput } from '@/components/app-text';
import { PickMap } from '@/components/now/map-adapter';
import { BackIcon } from '@/components/planning/icons';
import { PrimaryButton } from '@/components/planning/primary-button';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { lodgingError, trimLabel } from '@/lib/create-trip';
import { canConfirmPin, isTooFar } from '@/lib/lodging-pick';
import { layout } from '@/planning/layout';
import { control, color, radius, shadow, space, text } from '@/planning/theme';

/** 찍은 숙소 (kind: pin). 좌표는 사용자가 지도를 길게 눌러 찍은 값, label은 이름 칸에 친 글 */
export type PickedLodging = { lat: number; lng: number; label: string | null };

/** [여기로 정했어]를 누른 결과. 실패면 서버 오류 그대로 (400 INVALID_LODGING이면 reason = error.detail.reason) */
export type LodgingPickResult = { ok: true } | { ok: false; status: number; code: string | null; reason: string | null };

export type LodgingPickScreenProps = {
  /** 여행 도시 (안내 글의 도시 이름, 예 osaka -> 오사카) */
  cityCode: string;
  /** 여행 도시의 중심 (서버가 준 도시 정보 center, TASK-015 §13 Q2). 찍은 핀이 여기서 50km 이상이면 서버에 묻기 전에 바로 안내 · 비활성.
   *  도시 정보를 못 받았으면 null: 앱 검사를 건너뛰고 핀이 있으면 켠다 (§14 Q2, 서버가 마지막에 확인) */
  center: { lat: number; lng: number } | null;
  /** [여기로 정했어]. 부르는 쪽이 서버에 보내고 결과를 돌려준다 */
  onConfirm: (picked: PickedLodging) => Promise<LodgingPickResult>;
  onBack: () => void;
  /** a4 [숙소 없이 계속]: 숙소 없이(lodging: null) 여행 만들기로 돌아간다 */
  onSkip?: () => void;
  /** 서버(POST /trips)가 too_far로 돌려보내 다시 들어온 경우: 찍었던 핀·이름을 그대로 두고 안내를 보인다 */
  initial?: { pin: { lat: number; lng: number }; label: string | null; tooFar: boolean };
};

const SHEET_HEIGHT = 258; // pick-panel
const SHEET_HEIGHT_FAIL = 236; // a4 시트 (입력 칸이 없다)
const FIRST_TITLE = '지도를 길게 눌러 숙소를 찍어 줘';
const PIN_TITLE = '여기쯤이 숙소야?';
const ROUGHLY = '대략이어도 괜찮아';
const GENERIC_ERROR = '숙소를 다시 확인해 줘'; // too_far가 아닌 오류 (문서에 글이 없어 정한 것)
const LABEL_MAX = 30; // 입력 글 그대로 30자에서 막는다 (§12 Q6)
const FAIL_TITLE = '지도를 못 불러왔어';
const FAIL_BODY = '잠깐 뒤에 다시 해 보거나, 숙소 없이 계속해도 돼';

/** 지도 부품이 그리다 던지면 지도 대신 a4 (§6) */
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

export function LodgingPickScreen({ cityCode, center, onConfirm, onBack, onSkip, initial }: LodgingPickScreenProps) {
  const insets = useContext(SafeAreaInsetsContext) ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(initial?.pin ?? null);
  const [label, setLabel] = useState(initial?.label ?? '');
  const [serverTooFar, setServerTooFar] = useState(initial?.tooFar ?? false);
  const [otherError, setOtherError] = useState(false);
  const [sending, setSending] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapKey, setMapKey] = useState(0);

  const tooFar = pin !== null && (serverTooFar || (center !== null && isTooFar(pin, center)));
  const canConfirm = pin !== null && !tooFar && !sending && (center === null || canConfirmPin(pin, center));
  const sub = tooFar ? (lodgingError(400, 'INVALID_LODGING', 'too_far', cityCode) ?? GENERIC_ERROR) : otherError ? GENERIC_ERROR : ROUGHLY;

  const place = (at: { latitude: number; longitude: number }) => {
    setPin({ lat: at.latitude, lng: at.longitude });
    setServerTooFar(false); // 핀을 옮길 때마다 다시 검사 (§13 Q3)
    setOtherError(false);
  };

  const confirm = async () => {
    if (pin === null || !canConfirm) return;
    setSending(true);
    const result = await onConfirm({ lat: pin.lat, lng: pin.lng, label: trimLabel(label) });
    setSending(false);
    if (result.ok) return;
    if (lodgingError(result.status, result.code, result.reason, cityCode) !== null) setServerTooFar(true);
    else setOtherError(true);
  };

  const topBar = (
    <View pointerEvents="box-none" style={[styles.top, { top: insets.top + space['space-2'] }]}>
      <Pressable testID="pick-back" accessibilityRole="button" accessibilityLabel="뒤로" onPress={onBack} style={styles.back}>
        <BackIcon color={color.ink} />
      </Pressable>
      <View style={styles.titlePill}>
        <Text style={text('label', 'ink')}>지도에서 찍기</Text>
      </View>
      <View style={styles.back} pointerEvents="none" />
    </View>
  );

  if (mapFailed) {
    return (
      <View testID="pick-map-failed" style={styles.root}>
        <View style={styles.failMap}>
          <View style={styles.failIcon} />
        </View>
        {topBar}
        <View style={[styles.sheet, { height: SHEET_HEIGHT_FAIL + insets.bottom }]}>
          <Text style={text('heading')}>{FAIL_TITLE}</Text>
          <Text style={text('body')}>{FAIL_BODY}</Text>
          <View style={styles.failButtons}>
            <PrimaryButton
              testID="pick-retry"
              label="다시"
              onPress={() => {
                setMapFailed(false);
                setMapKey((now) => now + 1);
              }}
            />
            {onSkip ? <SecondaryButton testID="pick-skip" label="숙소 없이 계속" onPress={onSkip} /> : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View testID="lodging-pick-screen" style={styles.root}>
      <MapGuard key={mapKey} onError={() => setMapFailed(true)}>
        <PickMap
          center={center ? { latitude: center.lat, longitude: center.lng } : null}
          pin={pin ? { latitude: pin.lat, longitude: pin.lng } : null}
          bottomPadding={SHEET_HEIGHT}
          onLongPress={place}
          onReady={() => undefined}
          onFail={() => setMapFailed(true)}
        />
      </MapGuard>
      {topBar}
      <View testID="pick-panel" style={[styles.sheet, { minHeight: SHEET_HEIGHT, paddingBottom: Math.max(insets.bottom, space['space-5']) }]}>
        <Text style={text('heading')}>{pin ? PIN_TITLE : FIRST_TITLE}</Text>
        <Text style={text('body', tooFar || otherError ? 'alert' : 'ink')}>{sub}</Text>
        {pin ? (
          <View style={styles.labelBox}>
            <Text style={text('caption', 'ink')}>
              이름 붙이기 <Text style={text('caption', 'muted')}>· 선택</Text>
            </Text>
            <TextInput
              testID="pick-label"
              value={label}
              onChangeText={setLabel}
              maxLength={LABEL_MAX}
              placeholder="예: 친구 집"
              placeholderTextColor={color.muted}
              autoCorrect={false}
              style={styles.labelInput}
            />
          </View>
        ) : null}
        <PrimaryButton testID="pick-confirm" label="여기로 정했어" disabled={!canConfirm} onPress={() => void confirm()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color['bg-2'] },
  top: { position: 'absolute', left: space['space-4'], right: space['space-4'], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { width: control['touch-min'], height: control['touch-min'], borderRadius: radius['r-full'], backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', ...shadow.float },
  titlePill: { height: layout.titlePill, paddingHorizontal: space['space-4'], borderRadius: radius['r-full'], backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', ...shadow.float },
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
    gap: space['space-2'],
    ...shadow.sheet,
  },
  labelBox: { gap: space['space-2'], marginTop: space['space-2'] },
  labelInput: { ...text('body'), minHeight: control.input, paddingHorizontal: space['space-4'], borderRadius: radius['r-md'], backgroundColor: color['bg-2'] },
  failMap: { ...StyleSheet.absoluteFill, backgroundColor: color['bg-2'], alignItems: 'center', justifyContent: 'center' },
  failIcon: { width: layout.mapOffCircle, height: layout.mapOffCircle, borderRadius: radius['r-full'], backgroundColor: color.surface, ...shadow.float },
  failButtons: { gap: space['space-2'], marginTop: space['space-3'] },
});
