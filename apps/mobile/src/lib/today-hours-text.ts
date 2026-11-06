// TASK-004 §B-5. 껍데기: 구현은 frontend가 한다.
export type ChipKind = 'confirmed' | 'unverified' | 'unknown';

export function todayHoursText(_facts: readonly { field: string; value: string | null; status: ChipKind }[]): {
  text: string;
  chip: ChipKind;
} {
  throw new Error('not implemented');
}
