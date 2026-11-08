// TASK-010 §C2 여행 만들기 폼 규칙. 껍데기: 시그니처만 (test-writer). 구현은 frontend.
export type TripForm = {
  startDate: string | null;
  endDate: string | null;
  lodging: { place_id: string; name: string } | null;
  mustVisits: Record<string, string[]>;
};

export type CreateTripBody = {
  city_code: 'osaka';
  start_date: string;
  end_date: string;
  lodging_place_id?: string;
  must_visits: { date: string; place_id: string }[];
};

export const LODGING_TIMEOUT_MS: number = 0;

export function emptyForm(): TripForm {
  throw new Error('not implemented');
}

export function createBlocker(_form: TripForm): string | null {
  throw new Error('not implemented');
}

export function tripDates(_start: string, _end: string): string[] {
  throw new Error('not implemented');
}

export function canAddMustVisit(_form: TripForm, _date: string): boolean {
  throw new Error('not implemented');
}

export function addMustVisit(_form: TripForm, _date: string, _placeId: string): TripForm {
  throw new Error('not implemented');
}

export function createTripBody(_form: TripForm): CreateTripBody {
  throw new Error('not implemented');
}

export function placeQueryReady(_q: string): boolean {
  throw new Error('not implemented');
}

export function lodgingQueryReady(_q: string): boolean {
  throw new Error('not implemented');
}

export function fixedEventError(_status: number, _code: string | null): string | null {
  throw new Error('not implemented');
}

/** §11 D1: 그 장소가 담긴 날이 몇 일째인지 (1부터), 없으면 null. 껍데기 */
export function mustVisitDayNumber(_form: TripForm, _placeId: string): number | null {
  throw new Error('not implemented');
}
