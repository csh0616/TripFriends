// TASK-014 §D1·D2 (DESIGN-001 §4-13): 위치 안내 시트(loc-sheet) · 위치 꺼짐 설명 시트(loc-off-sheet) · "위치 꺼짐" 알약(pill-off).
// 권한 상태가 undetermined면 알약도 D1 시트를, denied면 D2 시트를 연다 (§9 답 1). 글자는 task-014-design §1 확정 문구 그대로.
import { Pressable, StyleSheet, View } from 'react-native';

import { SheetFrame, sheetStyles } from '@/account/sheet-frame';
import { Text } from '@/components/app-text';
import { LocationOffIcon, LockIcon, PinIcon } from '@/components/planning/icons';
import { PrimaryButton } from '@/components/planning/primary-button';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { layout } from '@/planning/layout';
import { color, fit, fitText, radius, shadow, space, text } from '@/planning/theme';

const SHEET = fit['sheet-confirm'];
const pillHit = (control44: number) => (control44 - layout.pillOff) / 2;

function FactLine({ children }: { children: string }) {
  return (
    <View style={styles.fact}>
      <LockIcon color={color.muted} size={layout.factIcon} />
      <Text style={fitText(SHEET.note)}>{children}</Text>
    </View>
  );
}

/** D1: 왜 + 저장하지 않아 + [위치 켜기] [나중에]. 스크림을 누르면 [나중에]와 같다 */
export function LocationIntroSheet({ onTurnOn, onLater }: { onTurnOn: () => void; onLater: () => void }) {
  return (
    <SheetFrame testID="loc-sheet" scrimTestID="loc-sheet-scrim" scrimLabel="나중에" onScrim={onLater}>
      <View style={styles.iconCircle}>
        <PinIcon color={color.ink} size={layout.locIcon} />
      </View>
      <Text style={[fitText(SHEET), styles.title]}>위치를 켜 둘까?</Text>
      <Text style={[fitText(SHEET.note), styles.body]}>지금 어디쯤인지 알면, 일정이 늦어질 때 미리 알려 줄 수 있어</Text>
      <FactLine>앱을 쓰는 동안에만 쓰고, 위치는 저장하지 않아</FactLine>
      <View style={sheetStyles.buttons}>
        <PrimaryButton testID="loc-turn-on" label="위치 켜기" onPress={onTurnOn} />
        <SecondaryButton testID="loc-later" label="나중에" onPress={onLater} />
      </View>
    </SheetFrame>
  );
}

/** D2: 위치가 꺼져 있어 + [설정 열기] [닫기] */
export function LocationOffSheet({ onSettings, onClose }: { onSettings: () => void; onClose: () => void }) {
  return (
    <SheetFrame testID="loc-off-sheet" scrimTestID="loc-off-scrim" scrimLabel="닫기" onScrim={onClose}>
      <Text style={fitText(SHEET)}>위치가 꺼져 있어</Text>
      <Text style={[fitText(SHEET.note), styles.body]}>지금은 시간만 보고 안내하고 있어. 위치를 켜면 일정이 늦어질 때 미리 알려 줄 수 있어</Text>
      <FactLine>위치는 저장하지 않아</FactLine>
      <View style={sheetStyles.buttons}>
        <PrimaryButton testID="loc-open-settings" label="설정 열기" onPress={onSettings} />
        <SecondaryButton testID="loc-off-close" label="닫기" onPress={onClose} />
      </View>
    </SheetFrame>
  );
}

/** pill-off: 보이는 32, 누르는 44 (hitSlop). 이동 상태 알약 바로 아래 가운데 */
export function LocationOffPill({ top, onPress }: { top: number; onPress: () => void }) {
  const slop = pillHit(fit['btn-add-event'].hit);
  return (
    <View pointerEvents="box-none" style={[styles.pillRow, { top }]}>
      <Pressable
        testID="location-off-pill"
        accessibilityRole="button"
        accessibilityLabel="위치 꺼짐"
        onPress={onPress}
        hitSlop={{ top: slop, bottom: slop }}
        style={styles.pill}
      >
        <LocationOffIcon color={color.muted} size={layout.pillOffIcon} />
        <Text style={text('caption')}>위치 꺼짐</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  iconCircle: {
    width: layout.locIconCircle,
    height: layout.locIconCircle,
    borderRadius: radius['r-full'],
    backgroundColor: color['bg-2'],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space['space-3'],
  },
  title: { marginBottom: SHEET.note.top },
  body: { marginTop: SHEET.note.top },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space['space-2'], marginTop: space['space-3'] },
  pillRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 2 },
  pill: {
    height: layout.pillOff,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-2'],
    paddingLeft: space['space-3'] - 2,
    paddingRight: space['space-3'],
    borderRadius: radius['r-full'],
    backgroundColor: color.surface,
    ...shadow.float,
  },
});
