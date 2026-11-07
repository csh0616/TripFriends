// TASK-006 §A-1: GET /days/{day_id}/now. 위치는 서버가 저장하지 않는다 (쿼리로만 보낸다).
// 타입은 packages/api-types에서만 가져온다.
import type { components } from 'api-types';

import type { Request } from './planning-api';

type Schemas = components['schemas'];
export type NowView = Schemas['NowView'];
export type NowCard = NowView['main'];
export type NowCourseItem = Schemas['NowCourseItem'];
export type NowPin = Schemas['NowPin'];

export type NowParams = { at: string; lat?: number; lng?: number };

export const nowRequest = (dayId: string, params: NowParams): Request => {
  const query = [`at=${encodeURIComponent(params.at)}`];
  if (params.lat !== undefined && params.lng !== undefined) {
    query.push(`lat=${encodeURIComponent(String(params.lat))}`, `lng=${encodeURIComponent(String(params.lng))}`);
  }
  return { method: 'GET', path: `/days/${dayId}/now?${query.join('&')}` };
};
