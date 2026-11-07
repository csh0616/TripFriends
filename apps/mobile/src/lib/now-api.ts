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

export type NowParams = { at: string; lat?: number; lng?: number };

/** 재실행·되돌림용 GET. 위치는 싣지 않는다 (B-4: 서버가 무시) */
export const nowRequest = (dayId: string, at: string): Request => ({ method: 'GET', path: `/days/${dayId}/now?at=${encodeURIComponent(at)}` });

/** 시각이 바뀔 때의 POST. 위치가 없으면 at만 (서버는 감지를 안 한다) */
export const checkRequest = (dayId: string, params: NowParams): Request => {
  const body: CheckBody = { at: params.at };
  if (params.lat !== undefined && params.lng !== undefined) {
    body.lat = params.lat;
    body.lng = params.lng;
  }
  return { method: 'POST', path: `/days/${dayId}/check`, body };
};

export const acceptRequest = (proposalId: string): Request => ({ method: 'POST', path: `/proposals/${encodeURIComponent(proposalId)}/accept` });
export const dismissRequest = (eventId: string): Request => ({ method: 'POST', path: `/events/${encodeURIComponent(eventId)}/dismiss` });
