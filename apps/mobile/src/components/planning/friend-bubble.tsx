// TASK-004 §B-3: 친구 말풍선. 아바타 32 + bg-2 말풍선(모서리 20, 왼쪽 아래 6). 서버 글자를 그대로 보여 준다.
import { StyleSheet, Text, View } from 'react-native';

import { layout } from '@/planning/layout';
import { color, control, radius, space, text } from '@/planning/theme';

export function FriendBubble({ message }: { message: string }) {
  return (
    <View style={styles.row}>
      {/* 웃는 얼굴 원: ink 바탕에 흰 눈 둘과 입 (TASK-004 §13-3 Q34~Q41) */}
      <View testID="friend-avatar" style={styles.avatar}>
        <View style={styles.eyes}>
          <View style={styles.eye} />
          <View style={styles.eye} />
        </View>
        <View style={styles.mouth} />
      </View>
      <View style={styles.bubble}>
        <Text style={text('body')}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space['space-2'] },
  avatar: {
    width: control.avatar,
    height: control.avatar,
    borderRadius: radius['r-full'],
    backgroundColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
    gap: layout.avatarFace,
  },
  eyes: { flexDirection: 'row', gap: layout.avatarEyeGap },
  eye: { width: layout.avatarEye, height: layout.avatarEye, borderRadius: radius['r-full'], backgroundColor: color.surface },
  mouth: {
    width: layout.avatarMouthWidth,
    height: layout.avatarMouthHeight,
    borderWidth: layout.avatarLine,
    borderColor: color.surface,
    borderTopColor: 'transparent',
    borderBottomLeftRadius: radius['r-full'],
    borderBottomRightRadius: radius['r-full'],
  },
  bubble: {
    flexShrink: 1,
    backgroundColor: color['bg-2'],
    borderRadius: radius['r-lg'],
    borderBottomLeftRadius: radius['r-tail'],
    paddingHorizontal: space['space-4'],
    paddingVertical: space['space-3'],
  },
});
