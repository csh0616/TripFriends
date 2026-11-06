// TASK-004 §B-5. 껍데기: 구현은 frontend가 한다. 상태·동작 이름은 test-writer의 임시 이름.
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

export function planningReducer(_state: PlanningState, _action: PlanningAction): PlanningState {
  throw new Error('not implemented');
}
