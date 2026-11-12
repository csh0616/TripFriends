// TASK-012 C5·리뷰 §8-2 / DESIGN-001 §4-12 head-avatar: 날짜 목록 머리 왼쪽의 내 프로필 아바타. 44 원 · bg-2 · 지도 위 아바타와 같은 사람 아이콘.
// 계획 대화·코스안 머리에는 없다. 머리 왼쪽 끝은 16 (머리 좌우 여백 20보다 4 안쪽으로 당긴다).
import { Pressable, StyleSheet } from 'react-native';

import { FriendAvatar } from '@/components/planning/friend-bubble';
import { layout } from '@/planning/layout';
import { account, radius } from '@/planning/theme';

const HEAD = account['head-avatar'];

export function HeadAvatar({ onPress }: { onPress: () => void }) {
  return (
    <Pressable testID="head-avatar" accessibilityRole="button" accessibilityLabel="내 프로필" onPress={onPress} style={styles.button}>
      <FriendAvatar testID="head-avatar-icon" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: HEAD.size,
    height: HEAD.size,
    borderRadius: radius['r-full'],
    backgroundColor: HEAD.bg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginLeft: HEAD.left - layout.screenMargin,
  },
});
