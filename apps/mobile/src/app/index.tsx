// TASK-004 §12 Q27: 첫 화면은 계획 흐름(S0)이다. 서버 상태 화면은 app/dev/health로 옮겼다.
import PlanningFlow from '@/planning/planning-flow';

export default function Index() {
  return <PlanningFlow />;
}
