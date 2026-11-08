// TASK-004 §B-2·§7: 계획 API 호출. 요청마다 10초 시간 제한, 실패는 종류별로 나눠 돌려준다 (던지지 않는다).
// 타입은 packages/api-types에서만 가져온다. 서버 계약에 없는 필드는 가정하지 않는다.
import type { components } from 'api-types';

import { API_URL } from './api';

type Schemas = components['schemas'];
export type PlanningSession = Schemas['PlanningSession'];
export type CandidateBatch = Schemas['CandidateBatch'];
export type CourseResult = Schemas['CourseResult'];
export type PlanningDone = Schemas['PlanningDone'];
export type Picks = Schemas['Picks'];
export type SeedResult = Schemas['SeedResult'];
export type SeedChosenResult = Schemas['SeedChosenResult'];
export type SelectResult = Schemas['SelectResult'];
export type DaySummary = Schemas['DaySummary'];
export type CourseOption = Schemas['CourseResultOption'];
export type CourseItem = Schemas['CourseItemView'];
export type StageResponse = PlanningSession | CandidateBatch | CourseResult | PlanningDone;

export const REQUEST_TIMEOUT_MS = 10000;

export type Request = {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
  /** TASK-010 B2: 여행 API는 X-Device-Id를 싣는다 */
  headers?: Record<string, string>;
  /** 기본 10초. 숙소 검색은 3초 (TASK-010 §6) */
  timeoutMs?: number;
};

/** 실패 종류 (TASK-004 §7, §12 Q18·Q21). 끊김·시간 초과는 network, 모르는 모양은 server */
export type Failure =
  | { kind: 'network' }
  | { kind: 'invalid'; field?: string } // TASK-010 §9 Q13: 400 VALIDATION_ERROR의 detail.field
  | { kind: 'not_found'; resource: string | null }
  | { kind: 'conflict'; reason: string | null; code?: string } // code: 공통 오류 코드 (예: PLAN_EXISTS)
  | { kind: 'infeasible'; reason: string; blocking: string[] }
  | { kind: 'server' };

export type Result = { ok: true; data: unknown } | { ok: false; failure: Failure };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function classify(status: number, body: unknown): Failure {
  const detail = isRecord(body) && isRecord(body.error) ? body.error.detail : undefined;
  if (status === 400) {
    const field = isRecord(detail) && typeof detail.field === 'string' ? detail.field : undefined;
    return field === undefined ? { kind: 'invalid' } : { kind: 'invalid', field };
  }
  if (status === 404) {
    const resource = isRecord(detail) && typeof detail.resource === 'string' ? detail.resource : null;
    return resource === null ? { kind: 'server' } : { kind: 'not_found', resource };
  }
  if (status === 409) {
    const reason = isRecord(detail) && typeof detail.reason === 'string' ? detail.reason : null;
    const code = isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string' ? body.error.code : undefined;
    return code === undefined ? { kind: 'conflict', reason } : { kind: 'conflict', reason, code };
  }
  // 미정(§13): detail.reason 없는 422는 아래 500 줄과 같다
  if (status === 422 && isRecord(detail) && typeof detail.reason === 'string') {
    const blocking = Array.isArray(detail.blocking) ? detail.blocking.map(String) : [];
    return { kind: 'infeasible', reason: detail.reason, blocking };
  }
  // 500, 503, 401, 403, JSON이 아닌 응답, 모르는 오류는 모두 "잠깐 문제가 생겼어" 줄 (Q18)
  return { kind: 'server' };
}

/** 한 번 보낸다. 시간 제한을 넘기면 network 실패이고, 그 뒤에 도착한 응답은 버린다 (Q20). */
export function send(request: Request, signals?: Set<AbortController>): Promise<Result> {
  const controller = new AbortController();
  signals?.add(controller);

  const call = async (): Promise<Result> => {
    let response: Response;
    try {
      response = await fetch(`${API_URL}${request.path}`, {
        method: request.method,
        headers:
          request.body === undefined && request.headers === undefined
            ? undefined
            : { ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...request.headers },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });
    } catch {
      return { ok: false, failure: { kind: 'network' } };
    }
    if (response.status === 204) return { ok: true, data: null }; // DELETE는 본문이 없다
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, failure: { kind: 'server' } };
    }
    if (response.ok) return { ok: true, data: body };
    return { ok: false, failure: classify(response.status, body) };
  };

  return new Promise<Result>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, failure: { kind: 'network' } });
      controller.abort();
    }, request.timeoutMs ?? REQUEST_TIMEOUT_MS);
    call().then((result) => {
      clearTimeout(timer);
      signals?.delete(controller);
      resolve(result);
    });
  });
}

// ---------- 요청 만들기 (TASK-003 §5) ----------
type AnswerBody = Schemas['AnswerRequest'];
type NextBody = Schemas['NextRequest'];
type ReactionBody = Schemas['ReactionRequest'];
type AdjustBody = Schemas['AdjustRequest'];
type StartBody = Schemas['StartRequest'];

export const requests = {
  seed: (): Request => ({ method: 'POST', path: '/debug/seed-demo' }),
  // TASK-006 §14: 둘째 날을 코스 선택까지 해 둔 시드. 응답의 day로 바로 여행 중 화면을 연다
  seedChosen: (): Request => ({ method: 'POST', path: '/debug/seed-demo', body: { chosen: true } satisfies Partial<Schemas['SeedRequest']> }),
  // mode 'auto' = [알아서 짜 줘] (TASK-011 §9 Q3): 대화 없이 바로 자동 계획 -> 코스안
  start: (dayId: string, mode: StartBody['mode'] = 'conversation'): Request => ({
    method: 'POST',
    path: `/days/${dayId}/planning`,
    body: { mode } satisfies StartBody,
  }),
  current: (sessionId: string): Request => ({ method: 'GET', path: `/planning/${sessionId}` }),
  answer: (sessionId: string, body: AnswerBody): Request => ({
    method: 'POST',
    path: `/planning/${sessionId}/answer`,
    body,
  }),
  react: (sessionId: string, body: ReactionBody): Request => ({
    method: 'POST',
    path: `/planning/${sessionId}/reactions`,
    body,
  }),
  next: (sessionId: string, body?: NextBody): Request => ({
    method: 'POST',
    path: `/planning/${sessionId}/next`,
    body,
  }),
  compose: (sessionId: string): Request => ({ method: 'POST', path: `/planning/${sessionId}/compose` }),
  adjust: (sessionId: string, body: AdjustBody): Request => ({
    method: 'POST',
    path: `/planning/${sessionId}/adjust`,
    body,
  }),
  back: (sessionId: string): Request => ({ method: 'POST', path: `/planning/${sessionId}/back` }),
  select: (optionId: string): Request => ({ method: 'POST', path: `/course-options/${optionId}/select` }),
};
