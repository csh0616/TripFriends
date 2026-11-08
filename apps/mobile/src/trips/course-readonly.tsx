// TASK-010 §12 답 3: 계획 완료·지난 날의 "고른 코스" 읽기만 화면 (DESIGN-001 §4-9). GET /days/{id}/course 한 번.
// 머무는 시간 조정·확정·다시 계획하기 버튼은 없다. 뒤로 = 날짜 목록.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { Notice } from '@/components/planning/notice';
import { ScreenFrame } from '@/components/planning/screen-frame';
import { send } from '@/lib/planning-api';
import { CourseRow } from '@/planning/screens/p3';
import { color, radius, space, text } from '@/planning/theme';

import { tripRequests, type ChosenCourse } from './api';
import { getDeviceId } from './device-id';
import { dayLabel } from './format';

const OFFLINE = '연결이 안 돼. 다시 해 볼까?';
const OOPS = '잠깐 문제가 생겼어';
const NOT_FOUND = '고른 코스를 찾을 수 없어';

type Loaded = { state: 'loading' } | { state: 'ok'; course: ChosenCourse } | { state: 'error'; message: string; retry: boolean };

const isCourse = (data: unknown): data is ChosenCourse => {
  const course = data as Partial<ChosenCourse> | null;
  return typeof course === 'object' && course !== null && Array.isArray(course.items);
};

export function CourseReadonly({ dayId, date, onBack }: { dayId: string; date: string; onBack: () => void }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoaded({ state: 'loading' });
    const result = await send(tripRequests.course(await getDeviceId(), dayId));
    if (!alive.current) return;
    if (result.ok && isCourse(result.data)) return setLoaded({ state: 'ok', course: result.data });
    if (result.ok) return setLoaded({ state: 'error', message: OOPS, retry: true });
    const kind = result.failure.kind;
    if (kind === 'not_found') setLoaded({ state: 'error', message: NOT_FOUND, retry: false }); // 고른 코스가 없다 (다시 시도해도 같다)
    else setLoaded({ state: 'error', message: kind === 'network' ? OFFLINE : OOPS, retry: true });
  }, [dayId]);

  useEffect(() => {
    void load();
  }, [load]);

  const course = loaded.state === 'ok' ? loaded.course : null;
  return (
    <ScreenFrame title={dayLabel(date)} subtitle="고른 코스" onBack={onBack}>
      <View testID="course-readonly" style={styles.root}>
        {loaded.state === 'loading' ? <ActivityIndicator color={color.muted} /> : null}
        {loaded.state === 'error' ? <Notice message={loaded.message} tone="plain" onRetry={loaded.retry ? () => void load() : undefined} /> : null}
        {course ? (
          <>
            <Text style={text('caption', 'muted')}>{`${course.items.length}곳 · 이동 ${course.total_travel_min}분`}</Text>
            <View>
              {course.items.map((item, index) => (
                <CourseRow key={item.seq} readOnly first={index === 0} last={index === course.items.length - 1} item={item} must={false} open={false} busy={false} onToggle={noop} onAdjust={noop} />
              ))}
            </View>
            {course.go_home_min !== null ? (
              <View style={styles.check}>
                <Text style={text('body')}>{`숙소까지 ${course.go_home_min}분`}</Text>
              </View>
            ) : null /* 숙소가 없으면 돌아갈 곳이 없다 (TASK-010 Q27) */}
          </>
        ) : null}
      </View>
    </ScreenFrame>
  );
}

const noop = () => undefined;

const styles = StyleSheet.create({
  root: { gap: space['space-3'] },
  check: { backgroundColor: color['bg-2'], borderRadius: radius['r-xl'], padding: space['space-4'], gap: space['space-2'] },
});
