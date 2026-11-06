// TASK-004 §B-5: 요청 시작·성공·실패를 상태로. 낙관적 갱신 없음 (숫자는 서버 값만). 상태·동작 이름은 §12-3에서 승인된 이름.
export type PlanningState = {
  inFlight: boolean;
  response: unknown | null;
  error: string | null;
  picks: string[];
  picksCount: number;
};

export type PlanningAction =
  | { type: 'request_start' }
  | { type: 'request_success'; response: unknown }
  | { type: 'request_failure'; message: string };

export const initialPlanningState: PlanningState = {
  inFlight: false,
  response: null,
  error: null,
  picks: [],
  picksCount: 0,
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export function planningReducer(state: PlanningState, action: PlanningAction): PlanningState {
  switch (action.type) {
    case 'request_start':
      return { ...state, inFlight: true };
    case 'request_failure':
      return { ...state, inFlight: false, error: action.message };
    case 'request_success': {
      const next = action.response;
      const done = { ...state, inFlight: false, error: null };
      if (!isRecord(next)) return { ...done, response: next };
      const hasPicks = Array.isArray(next.picks) && typeof next.picks_count === 'number';
      if (hasPicks && !('stage' in next)) {
        // 담기·패스 응답(Picks): 담은 곳과 숫자만 서버 값으로 바꾸고, 보던 묶음은 그대로 둔다
        return { ...done, picks: next.picks as string[], picksCount: next.picks_count as number };
      }
      if (hasPicks) {
        // 묶음 응답(CandidateBatch): 담은 곳도 이 응답이 대신한다
        return { ...done, response: next, picks: next.picks as string[], picksCount: next.picks_count as number };
      }
      return { ...done, response: next };
    }
  }
}
