// TASK-004 §B-3: 친구 말풍선. 아바타 32 + bg-2 말풍선(모서리 20, 왼쪽 아래 6). 서버 글자를 그대로 보여 준다.
import { StyleSheet, Text, View } from 'react-native';

import { color, control, radius, space, text } from '@/planning/theme';

export function FriendBubble({ message }: { message: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={text('label', 'on-brand')}>T</Text>
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
    backgroundColor: color['brand-soft'],
    alignItems: 'center',
    justifyContent: 'center',
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
