// TASK-004 §B-5, TASK-003 §10-9: 영업시간 fact를 화면 글자 + 상태 칩 종류로. 칩은 항상 데이터의 상태를 따른다 (규칙 2).
export type ChipKind = 'confirmed' | 'unverified' | 'unknown';

type HoursFact = { field: string; value: string | null; status: ChipKind };

export function todayHoursText(facts: readonly HoursFact[]): { text: string; chip: ChipKind } {
  const hours = facts.find((fact) => fact.field === 'opening_hours');
  if (hours === undefined) return { text: '영업시간 모름', chip: 'unknown' };
  if (hours.value !== null) return { text: hours.value, chip: hours.status };
  if (hours.status === 'unknown') return { text: '영업시간 모름', chip: 'unknown' };
  return { text: '오늘 휴무', chip: hours.status };
}
