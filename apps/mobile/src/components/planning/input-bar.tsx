// TASK-004 §B-3·§12 Q25: 입력창은 화면 맨 아래 고정. 키보드 보내기(returnKeyType=send), 오른쪽 말하기 버튼(R1은 "곧 돼").
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout } from '@/planning/layout';
import { color, control, radius, space, text } from '@/planning/theme';

import { MicIcon } from './icons';

// Q44 입력창 안내 글 문서에 없음 -> "하고 싶은 말을 써 줘"
const PLACEHOLDER = '하고 싶은 말을 써 줘';
const SOON_MS = 2000;

/** 값이 바뀌면 입력 글을 지운다. 흐름이 "보낸 글이 서버에서 성공했을 때" 올린다. */
export const InputClearContext = createContext(0);

export function InputBar({
  onSend,
  disabled,
  disabledHint,
}: {
  onSend: (value: string) => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState('');
  const [soon, setSoon] = useState(false);
  const cleared = useContext(InputClearContext);
  const seen = useRef(cleared);
  useEffect(() => {
    if (seen.current === cleared) return;
    seen.current = cleared;
    setValue('');
  }, [cleared]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  const submit = () => {
    const trimmed = value.trim();
    if (disabled || trimmed === '') return; // Q9: 공백만 있는 글은 보내지 않는다
    onSend(trimmed); // 글은 지우지 않는다: 성공하면 흐름이 지우고(InputClearContext), 실패하면 그대로 남는다 (TASK-004 §13-3)
  };

  const mic = () => {
    setSoon(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSoon(false), SOON_MS);
  };

  return (
    <View testID="input-bar" style={[styles.wrap, { paddingBottom: insets.bottom + space['space-2'] }]}>
      {soon ? <Text style={styles.soon}>곧 돼</Text> : null}
      <View style={styles.row}>
        <View style={styles.field}>
          <TextInput
            testID="input-text"
            style={styles.input}
            value={value}
            onChangeText={setValue}
            onSubmitEditing={submit}
            returnKeyType="send"
            editable={!disabled}
            placeholder={disabled ? undefined : PLACEHOLDER}
            placeholderTextColor={color.muted}
          />
          {disabled && disabledHint ? (
            <Text pointerEvents="none" style={styles.hint}>
              {disabledHint}
            </Text>
          ) : null}
        </View>
        <Pressable testID="mic-button" accessibilityRole="button" accessibilityLabel="말하기" onPress={mic} style={styles.mic}>
          <MicIcon color={color.muted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: color.surface, paddingHorizontal: layout.screenMargin, paddingTop: space['space-2'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space['space-2'] },
  field: {
    flex: 1,
    height: control.input,
    borderRadius: radius['r-md'],
    backgroundColor: color['bg-2'],
    justifyContent: 'center',
  },
  input: { ...text('body'), height: control.input, paddingHorizontal: space['space-4'] },
  hint: { ...text('body', 'muted'), position: 'absolute', left: space['space-4'] },
  mic: {
    width: control.input,
    height: control.input,
    borderRadius: radius['r-full'],
    backgroundColor: color['bg-2'], // 아직 안 되는 버튼: 비활성 규칙 (TASK-005 B10)
    alignItems: 'center',
    justifyContent: 'center',
  },
  soon: { ...text('caption', 'muted'), textAlign: 'right', paddingBottom: space['space-1'] },
});
