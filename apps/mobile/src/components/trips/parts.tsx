// 여행 만들기 화면의 작은 부품 (DESIGN-001 §4-7·§4-10): 입력 칸, 틀린 칸 문장, 담기 표시, 안내 상자.
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, TextInput } from '@/components/app-text';
import { AlertIcon, CheckIcon, PlusIcon, SearchIcon } from '@/components/planning/icons';
import { layout } from '@/planning/layout';
import { color, control, radius, space, text } from '@/planning/theme';

/** 틀린 칸 아래 오류 문장: 색 + 아이콘 + 문장 (field-error) */
export function FieldError({ message }: { message: string }) {
  return (
    <View testID="field-error" accessibilityRole="alert" style={styles.error}>
      <AlertIcon color={color.alert} size={layout.checkSmall} />
      <Text style={[text('caption', 'alert'), styles.errorText]}>{message}</Text>
    </View>
  );
}

/** 칸 이름 + 칸 + 오류. 칸 묶음 testID는 field-{칸}-box */
export function FieldBox({ id, label, error, children }: { id: string; label?: string; error: string | null; children: React.ReactNode }) {
  return (
    <View testID={`field-${id}-box`} style={styles.box}>
      {label ? <Text style={text('caption', 'muted')}>{label}</Text> : null}
      {children}
      {error ? <FieldError message={error} /> : null}
    </View>
  );
}

/** 검색 칸 (input 48, 아이콘 20, 포커스는 안쪽 2px ink-strong. 주황은 쓰지 않는다) */
export function SearchInput({
  testID,
  value,
  placeholder,
  onChangeText,
  onFocus,
  onBlur,
}: {
  testID: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.input, focused && styles.inputFocus]}>
      <SearchIcon color={color.muted} size={control.icon - 4} />
      <TextInput
        testID={testID}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={color.muted}
        onChangeText={onChangeText}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={styles.inputText}
      />
    </View>
  );
}

/** 담기 표시 (add-dot 36): + / ✓ / 가득 — 색 + 모양 + 글자 */
export function AddDot({ state }: { state: 'add' | 'added' | 'full' }) {
  if (state === 'full') {
    return (
      <View style={[styles.dot, styles.dotFull]}>
        <Text style={text('label', 'muted')}>가득</Text>
      </View>
    );
  }
  return (
    <View style={[styles.dot, state === 'added' ? styles.dotAdded : styles.dotAdd]}>
      {state === 'added' ? <CheckIcon color={color['on-brand']} size={control.icon - 6} /> : <PlusIcon color={color.surface} size={control.icon - 6} />}
    </View>
  );
}

/** 서비스를 못 쓸 때의 안내 (notice-info). 일정 문제가 아니라서 의미 색이 아닌 회색 */
export function InfoNotice({ message }: { message: string }) {
  return (
    <View testID="notice-info" style={styles.info}>
      <Text style={text('body')}>{message}</Text>
    </View>
  );
}

export const isDisabledProps = (disabled: boolean) => ({ disabled, accessibilityState: { disabled } });

export function ChipButton({ label, onPress, testID, selected }: { label: string; onPress: () => void; testID?: string; selected?: boolean }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: selected === true }}
      onPress={onPress}
      hitSlop={{ top: layout.chipSlop, bottom: layout.chipSlop }}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Text style={text(selected ? 'label' : 'caption', selected ? 'ink' : 'muted')}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { gap: space['space-2'] },
  error: { flexDirection: 'row', alignItems: 'center', gap: space['space-2'], backgroundColor: color['alert-bg'], borderRadius: radius['r-sm'], padding: space['space-2'] },
  errorText: { flexShrink: 1 },
  input: {
    minHeight: control.input,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['space-2'],
    paddingHorizontal: space['space-4'],
    borderRadius: radius['r-md'],
    backgroundColor: color['bg-2'],
    borderWidth: layout.inputFocus,
    borderColor: 'transparent',
  },
  inputFocus: { borderColor: color['ink-strong'] },
  inputText: { ...text('body'), flex: 1, minHeight: control.input },
  dot: { width: layout.addDot, height: layout.addDot, borderRadius: radius['r-full'], alignItems: 'center', justifyContent: 'center' },
  dotAdd: { backgroundColor: color.ink },
  dotAdded: { backgroundColor: color.brand },
  dotFull: { backgroundColor: color['bg-2'] },
  info: { backgroundColor: color['bg-2'], borderRadius: radius['r-md'], paddingVertical: space['space-3'], paddingHorizontal: space['space-3'] + space['space-1'] / 2 },
  chip: {
    minHeight: layout.tabDay,
    paddingHorizontal: space['space-4'],
    borderRadius: radius['r-full'],
    backgroundColor: color['bg-2'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: color['brand-soft'] },
});
