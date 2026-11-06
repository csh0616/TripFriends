import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

// R1은 라이트 모드만 쓴다 (DESIGN-001 §3). 머리는 화면이 직접 그린다.
export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
