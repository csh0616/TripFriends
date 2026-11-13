// TASK-014 §D4 (DESIGN-001 §4-13): "연습 중" 띠(reh-band) · 안내 한 줄(notice-info).
import { useEffect } from 'react';
import tokens from 'design-tokens';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { InfoIcon, WalkIcon } from '@/components/planning/icons';
import { layout } from '@/planning/layout';
import { account, color, fit, fitText, radius, shadow, space, text } from '@/planning/theme';

export const REHEARSAL_NOTE = '연습이라 저장하지 않았어';
export const REHEARSAL_FAILED = '지금 연습을 못 해';

/** reh-band: 높이 52, 바탕 ink(on-brand 토큰 값), 주황 없음. [연습 끝내기] 흰 알약 (보이는 36 · 누르는 44) */
export function RehearsalBand({ top, label, onEnd }: { top: number; label: string; onEnd: () => void }) {
  const slop = (fit['btn-add-event'].hit - layout.rehEndHeight) / 2;
  return (
    <View testID="rehearsal-band" style={[styles.band, { top }]}>
      <WalkIcon color={color.surface} size={layout.rehIcon} />
      <View style={styles.names}>
        <Text style={text('heading', 'surface')}>연습 중</Text>
        <Text numberOfLines={1} style={[text('caption', 'line'), { color: DAY_NAME }]}>
          {label}
        </Text>
      </View>
      <Pressable testID="rehearsal-end" accessibilityRole="button" onPress={onEnd} hitSlop={{ top: slop, bottom: slop }} style={styles.end}>
        <Text style={text('caption', 'on-brand')}>연습 끝내기</Text>
      </Pressable>
    </View>
  );
}

// 날 이름 연회색(DESIGN-001 §4-13): 새 색을 만들지 않고 같은 값의 기존 토큰(pill-past 바탕)을 쓴다 (§13-6)
const DAY_NAME = tokens.pill['pill-past'].bg;
const NOTICE = account['notice-fail'];

/** notice-info: notice-fail과 같은 모양, 흰 바탕 + 정보 아이콘. 누르면 닫힘, 6초 뒤 사라짐. 닫는 일은 부른 쪽이 한다 */
export function RehearsalNotice({ top, onClose }: { top: number; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, NOTICE.duration);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <Pressable testID="notice-info" role="status" accessibilityLiveRegion="polite" onPress={onClose} style={[styles.notice, { top }]}>
      <InfoIcon color={color.muted} size={NOTICE.icon} />
      <Text numberOfLines={1} style={styles.noticeText}>
        {REHEARSAL_NOTE}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: layout.rehBand,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-2'],
    paddingLeft: space['space-4'],
    paddingRight: space['space-2'],
    backgroundColor: color['on-brand'],
  },
  names: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: space['space-2'] },
  end: {
    height: layout.rehEndHeight,
    justifyContent: 'center',
    paddingHorizontal: space['space-4'] - 2,
    borderRadius: radius['r-full'],
    backgroundColor: color.surface,
  },
  notice: {
    position: 'absolute',
    left: NOTICE.side,
    right: NOTICE.side,
    zIndex: 3,
    height: layout.noticeInfoHeight,
    borderRadius: NOTICE.radius,
    backgroundColor: color.surface,
    paddingHorizontal: NOTICE.paddingHorizontal,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-2'],
    ...shadow.float,
  },
  noticeText: { flex: 1, ...fitText(NOTICE) },
});
