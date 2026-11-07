import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';

// R1은 라이트 모드만 쓴다 (DESIGN-001 §3). 머리는 화면이 직접 그린다.
// 여행 중 화면의 카드 시트(@gorhom/bottom-sheet)가 끌기 동작을 받으려면 맨 바깥이 GestureHandlerRootView여야 한다 (TASK-006 B5).
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
