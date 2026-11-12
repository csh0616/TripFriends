// TASK-006 §A-1: GET /days/{day_id}/now (위치 쿼리 없음). TASK-007 B-4: 시각이 바뀔 때는 POST /check (위치는 본문, 서버가 저장하지 않는다).
// 타입은 packages/api-types에서만 가져온다.
import type { components } from 'api-types';

import type { Request } from './planning-api';

type Schemas = components['schemas'];
export type NowView = Schemas['NowView'];
export type NowCard = NowView['main'];
export type NowCourseItem = Schemas['NowCourseItem'];
export type NowPin = Schemas['NowPin'];
export type NowEvent = NonNullable<NowView['event']>;
export type NowProposal = Schemas['NowProposal'];
export type CheckBody = Schemas['CheckRequest'];
export type NowT06Proposal = Schemas['NowT06Proposal'];
export type NowFact = Schemas['Fact'];
export type VisitCheckBody = Schemas['VisitCheckRequest'];

export type RehearsalAction = NonNullable<CheckBody['rehearsal_actions']>[number];

export type NowParams = { at: string; lat?: number; lng?: number };

/** 재실행·되돌림용 GET. 위치는 싣지 않는다 (B-4: 서버가 무시) */
export const nowRequest = (dayId: string, at: string): Request => ({ method: 'GET', path: `/days/${dayId}/now?at=${encodeURIComponent(at)}` });

/** 시각이 바뀔 때의 POST. 위치가 없으면 at만 (서버는 감지를 안 한다) */
export const checkRequest = (dayId: string, params: NowParams, rehearsal?: RehearsalAction[]): Request => {
  const body: CheckBody = { at: params.at };
  if (params.lat !== undefined && params.lng !== undefined) {
    body.lat = params.lat;
    body.lng = params.lng;
  }
  // TASK-014 §C3·§11: 연습은 같은 계산을 하고 서버가 되돌린다. 앞서 연습에서 한 행동(연습 기록)을 순서대로 함께 보낸다
  if (rehearsal) {
    body.rehearsal = true;
    body.rehearsal_actions = rehearsal;
  }
  return { method: 'POST', path: `/days/${dayId}/check`, body };
};

export const acceptRequest = (proposalId: string): Request => ({ method: 'POST', path: `/proposals/${encodeURIComponent(proposalId)}/accept` });
export const dismissRequest = (eventId: string): Request => ({ method: 'POST', path: `/events/${encodeURIComponent(eventId)}/dismiss` });

/** TASK-008 A5: 가기 전에 열었는지 답. at은 데모 시계의 지금, 답은 서버가 사실로 저장한다 */
export const visitCheckRequest = (placeId: string, body: VisitCheckBody): Request => ({
  method: 'POST',
  path: `/places/${encodeURIComponent(placeId)}/visit-checks`,
  body,
});

/** 연습 중 [닫혔어]: 대안을 계산하는 요청이라 서버에 보내되 rehearsal: true (되돌림). 앞선 연습 기록을 함께 */
export const rehearsalVisitCheckRequest = (placeId: string, body: VisitCheckBody, actions: RehearsalAction[]): Request =>
  visitCheckRequest(placeId, { ...body, rehearsal: true, rehearsal_actions: actions });
