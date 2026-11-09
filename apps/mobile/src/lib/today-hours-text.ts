import { hoursRangeText } from '@/planning/format';

// TASK-004 §B-5, TASK-003 §10-9: 영업시간 fact를 화면 글자 + 상태 칩 종류로. 칩은 항상 데이터의 상태를 따른다 (규칙 2).
export type ChipKind = 'confirmed' | 'unverified' | 'unknown';

type HoursFact = { field: string; value: string | null; status: ChipKind; source_type?: string };

const ALWAYS_OPEN = '00:00-24:00'; // 우리가 정한 "늘 열림" (TASK-010 §13 O1)

export function todayHoursText(facts: readonly HoursFact[]): { text: string; chip: ChipKind } {
  const hours = facts.find((fact) => fact.field === 'opening_hours');
  if (hours === undefined) return { text: '영업시간 모름', chip: 'unknown' };
  if (hours.source_type === 'curated' && hours.value === ALWAYS_OPEN) return { text: '늘 열려 있어', chip: hours.status };
  if (hours.value !== null) return { text: hours.value, chip: hours.status };
  if (hours.status === 'unknown') return { text: '영업시간 모름', chip: 'unknown' };
  return { text: '오늘 휴무', chip: hours.status };
}

/** 영업시간을 보여 주는 칸의 칩: 확인 상태 칩, "추천 시간대" 윤곽 칩(hint), 또는 없음 (TASK-011 §9 Q10, A5) */
export type HoursChip = ChipKind | 'hint' | null;

/**
 * 화면용 영업시간. 내부 status는 todayHoursText 그대로이고 화면 칩만 바뀐다 (A5):
 * 우리가 정한 시간대(curated) -> "추천 시간대" 칩, 늘 열림 -> 그 status 칩(보통 "확인됨") + "늘 열려 있어" (§14 N9, §15). 시각 범위는 엔 대시, 두 구간은 가운데 점
 */
export function hoursView(facts: readonly HoursFact[]): { text: string; chip: HoursChip } {
  const base = todayHoursText(facts);
  const hours = facts.find((fact) => fact.field === 'opening_hours');
  if (hours?.source_type === 'curated' && hours.value === ALWAYS_OPEN) return { text: base.text, chip: base.chip };
  if (hours?.source_type === 'curated' && hours.value !== null) return { text: hoursRangeText(base.text), chip: 'hint' };
  return { text: hoursRangeText(base.text), chip: base.chip };
}
