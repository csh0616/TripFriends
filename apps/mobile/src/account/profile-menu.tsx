// TASK-012 C5·C6·리뷰 ①-26·27: 프로필 메뉴 (아바타 시트). 맨 위 연결 상태 카드 + 버튼.
//   저장 안 됨(익명): 카드 "저장 안 됨 / 이 폰에만 있어. 앱을 지우면 사라져" + [저장하기](-> 저장 권유 시트) · [처음부터 다시] · [닫기]
//   연결됨: 카드 "Google 계정에 저장됨 / 이메일 일부" + 한 줄 "로그아웃해도 여행은 계정에 남아 있어" + [로그아웃] · [처음부터 다시] · [닫기]
// 연결 전에는 [로그아웃]이 없다 (C6). Google 버튼은 이 메뉴에 없다 (저장 권유 시트 안에만).
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { FriendAvatar } from '@/components/planning/friend-bubble';
import { PrimaryButton } from '@/components/planning/primary-button';
import { SecondaryButton } from '@/components/planning/secondary-button';
import { maskEmail } from '@/lib/mask-email';
import { account, fitText, radius, space, text } from '@/planning/theme';

import { useAccount } from './account-context';
import { SheetFrame, sheetStyles } from './sheet-frame';

const CARD = account['acct-card'];
const TITLE = account['trip-pick'].name;

export function ProfileMenu({ restartLabel, onRestart, onClose }: { restartLabel: string; onRestart: () => void; onClose: () => void }) {
  const { linked, email, openSave, logout } = useAccount();
  return (
    <SheetFrame testID="profile-sheet" scrimTestID="profile-scrim" scrimLabel="닫기" onScrim={onClose}>
      <View testID="acct-card" style={styles.card}>
        <View style={styles.avatar}>
          <FriendAvatar testID="acct-avatar" />
        </View>
        <View style={styles.lines}>
          <Text style={fitText(TITLE)}>{linked ? 'Google 계정에 저장됨' : '저장 안 됨'}</Text>
          <Text style={text('caption', 'muted')}>{linked ? (email ? maskEmail(email) : '') : '이 폰에만 있어. 앱을 지우면 사라져'}</Text>
        </View>
      </View>
      {linked ? <Text style={[text('caption', 'muted'), sheetStyles.note]}>로그아웃해도 여행은 계정에 남아 있어</Text> : null}
      <View style={sheetStyles.buttons}>
        {linked ? (
          <SecondaryButton testID="profile-logout" label="로그아웃" onPress={() => void logout().then(onClose)} />
        ) : (
          <PrimaryButton
            testID="profile-save"
            label="저장하기"
            onPress={() => {
              onClose();
              openSave();
            }}
          />
        )}
        <SecondaryButton testID="profile-restart" label={restartLabel} onPress={onRestart} />
        <SecondaryButton testID="profile-close" label="닫기" onPress={onClose} />
      </View>
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-3'],
    backgroundColor: CARD.bg,
    borderRadius: CARD.radius,
    paddingVertical: CARD.paddingVertical,
    paddingHorizontal: CARD.paddingHorizontal,
  },
  avatar: { width: CARD.avatar, height: CARD.avatar, borderRadius: radius['r-full'], backgroundColor: CARD.avatarBg, alignItems: 'center', justifyContent: 'center' },
  lines: { flex: 1 },
});
