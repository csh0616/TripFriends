// TASK-012 C4·리뷰 ①-23·24: 어느 여행 시트. 칸 둘(기기·계정), 기본으로 고른 칸 없음, [이걸로 할래](고르기 전 비활성) + [연결 취소](보조).
// 칸 = ②-07 고르는 칸: 고르면 sel-bg + 안쪽 고리 + radio(채움 + 체크). 3줄: 어디서 온 여행 / 이름 / 기간 · 진행. 값은 서버가 준 그대로.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { CheckIcon } from '@/components/planning/icons';
import { PhotoPlaceholder } from '@/components/planning/photo-placeholder';
import { PrimaryButton } from '@/components/planning/primary-button';
import { SecondaryButton } from '@/components/planning/secondary-button';
import type { Choice } from '@/lib/account-link';
import { maskEmail } from '@/lib/mask-email';
import { layout } from '@/planning/layout';
import { account, color, fit, fitText, radius, space } from '@/planning/theme';
import { periodLabel } from '@/trips/format';

import { SheetFrame, sheetStyles } from './sheet-frame';

const SHEET = fit['sheet-confirm'];
const PICK = account['trip-pick'];
const ORIGIN = { device: '이 폰에서 만든 여행', account: 'Google 계정에 있던 여행' } as const;

export function PickSheet({
  email,
  choices,
  busy,
  onConfirm,
  onCancel,
}: {
  email: string;
  choices: Choice[];
  busy: boolean;
  onConfirm: (tripId: string) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <SheetFrame testID="pick-sheet" scrimTestID="pick-sheet-scrim">
      <Text style={fitText(SHEET)}>어느 여행을 쓸까?</Text>
      <Text style={[fitText(SHEET.note), sheetStyles.note]}>{`${maskEmail(email)} 계정에 이미 여행이 있어. 고르지 않은 여행은 지우지 않고 보관해 둘게`}</Text>
      <View style={styles.cells}>
        {choices.map((choice) => {
          const on = picked === choice.trip_id;
          return (
            <Pressable
              key={choice.trip_id}
              testID={`pick-${choice.origin}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: busy }}
              disabled={busy}
              onPress={() => setPicked(choice.trip_id)}
              style={[styles.cell, on && styles.cellOn]}
            >
              <View style={styles.thumb}>
                <PhotoPlaceholder category="landmark" style={StyleSheet.absoluteFill} />
              </View>
              <View style={styles.lines}>
                <Text numberOfLines={1} style={fitText(PICK.origin)}>
                  {ORIGIN[choice.origin]}
                </Text>
                <Text numberOfLines={1} style={fitText(PICK.name, 'ink')}>
                  {choice.name}
                </Text>
                <Text numberOfLines={1} style={fitText(PICK.meta)}>
                  {`${periodLabel(choice.start_date, choice.end_date)} · ${choice.total_days}일 중 ${choice.planned_days}일 계획 완료`}
                </Text>
              </View>
              <View style={[styles.radio, on && styles.radioOn]}>{on ? <CheckIcon color={color['on-brand']} size={layout.checkSmall} /> : null}</View>
            </Pressable>
          );
        })}
      </View>
      <View style={sheetStyles.buttons}>
        <PrimaryButton testID="pick-confirm" label="이걸로 할래" disabled={picked === null || busy} onPress={() => picked !== null && onConfirm(picked)} />
        <SecondaryButton testID="pick-cancel" label="연결 취소" disabled={busy} onPress={onCancel} />
      </View>
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  cells: { marginTop: SHEET.buttonTop, gap: SHEET.gap },
  cell: {
    minHeight: PICK.height,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-3'],
    paddingLeft: PICK.paddingLeft,
    paddingRight: PICK.paddingRight,
    borderRadius: radius['r-lg'],
    backgroundColor: color['bg-2'],
    borderWidth: layout.selRing,
    borderColor: color['bg-2'], // 안 골랐을 때도 고리 자리를 같은 굵기로 잡는다 (골라도 모양이 안 움직임)
  },
  cellOn: { backgroundColor: PICK.selBg, borderColor: color.brand },
  thumb: { width: PICK.thumb, height: PICK.thumb, borderRadius: radius['r-sm'], overflow: 'hidden' },
  lines: { flex: 1 },
  radio: {
    width: PICK.radio,
    height: PICK.radio,
    borderRadius: radius['r-full'],
    borderWidth: layout.selRing,
    borderColor: color.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: color.brand, borderColor: color.brand },
});
