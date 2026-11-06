// C1: 복구 GET 응답이 요청 전 응답과 달라졌는지. stage, 묶음 round, 코스안 ID 집합 중 하나라도 다르면 true.
type Shape = { stage?: unknown; round?: unknown; options?: { option_id?: unknown }[] };

const optionIds = (value: Shape): string[] | null =>
  Array.isArray(value.options) ? value.options.map((o) => String(o?.option_id)) : null;

export function responseChanged(before: unknown, after: unknown): boolean {
  const a = (before ?? {}) as Shape;
  const b = (after ?? {}) as Shape;
  if (a.stage !== b.stage || a.round !== b.round) return true;
  const idsA = optionIds(a);
  const idsB = optionIds(b);
  if (idsA === null || idsB === null) return idsA !== idsB;
  const setA = new Set(idsA);
  const setB = new Set(idsB);
  return setA.size !== setB.size || [...setA].some((id) => !setB.has(id));
}
