// 서버 /health 결과 한 줄 (TASK-001 AC-3·AC-20). TASK-004 Q27로 app/dev/health 경로로 옮겼다. 개발용 확인 화면.
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchHealth } from '@/lib/api';
import { color, space, text } from '@/planning/theme';

function useServerStatus() {
  const [status, setStatus] = useState('서버에 연결하는 중…');
  useEffect(() => {
    let alive = true;
    fetchHealth()
      .then((health) => alive && setStatus(`카드 ${health.cards}개 로드됨`))
      .catch(() => alive && setStatus('서버에 연결할 수 없어요'));
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

export default function DevHealthScreen() {
  const serverStatus = useServerStatus();
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.box}>
        <Text style={text('heading')}>{serverStatus}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface },
  box: { padding: space['space-5'] },
});
