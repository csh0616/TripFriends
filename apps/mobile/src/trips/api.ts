// TASK-010 B1~B5: 여행 API 요청 만들기. 타입은 packages/api-types에서만. 모든 여행 요청에 X-Device-Id (B2).
import type { components } from 'api-types';

import type { CreateTripBody } from '@/lib/create-trip';
import { LODGING_TIMEOUT_MS } from '@/lib/create-trip';
import type { Request } from '@/lib/planning-api';

type Schemas = components['schemas'];
export type Trip = Schemas['Trip'];
export type TripDay = Schemas['TripDay'];
export type FixedEvent = Schemas['FixedEvent-Output'];
export type FixedEventBody = Schemas['FixedEventCreate'];
export type LodgingHit = Schemas['LodgingHit'];
export type SearchPlace = Schemas['PlaceHit'];

export const CITY_CODE = 'osaka';

const withDevice = (deviceId: string) => ({ 'X-Device-Id': deviceId });
const query = (q: string) => `city_code=${CITY_CODE}&q=${encodeURIComponent(q.trim())}`;

export type ChosenCourse = Schemas['CourseResultOption'];

export const tripRequests = {
  current: (deviceId: string): Request => ({ method: 'GET', path: '/trips/current', headers: withDevice(deviceId) }),
  create: (deviceId: string, body: CreateTripBody): Request => ({ method: 'POST', path: '/trips', body, headers: withDevice(deviceId) }),
  /** TASK-010 §12 답 3: 그날 고른 코스 (읽기만) */
  course: (deviceId: string, dayId: string): Request => ({
    method: 'GET',
    path: `/days/${encodeURIComponent(dayId)}/course`,
    headers: withDevice(deviceId),
  }),
  searchPlaces: (q: string): Request => ({ method: 'GET', path: `/places/search?${query(q)}` }),
  searchLodging: (q: string): Request => ({ method: 'GET', path: `/places/lodging-search?${query(q)}`, timeoutMs: LODGING_TIMEOUT_MS }),
  addFixedEvent: (deviceId: string, tripId: string, body: FixedEventBody): Request => ({
    method: 'POST',
    path: `/trips/${encodeURIComponent(tripId)}/fixed-events`,
    body,
    headers: withDevice(deviceId),
  }),
  removeFixedEvent: (deviceId: string, eventId: string): Request => ({
    method: 'DELETE',
    path: `/fixed-events/${encodeURIComponent(eventId)}`,
    headers: withDevice(deviceId),
  }),
};

/** 응답이 Trip 모양인지 (모르는 모양은 서버 오류처럼 다룬다) */
export function isTrip(data: unknown): data is Trip {
  const trip = data as Partial<Trip> | null;
  return typeof trip === 'object' && trip !== null && typeof trip.trip_id === 'string' && Array.isArray(trip.trip_days);
}
