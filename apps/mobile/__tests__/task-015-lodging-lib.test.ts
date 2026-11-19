/// <reference types="jest" />
// TASK-015 §11 Q1 숙소 오류 이유 -> a2 안내 (앱, 순수 함수). 로직만 본다.
// 근거: TASK-015 §11 Q1("INVALID_LODGING + 본문 reason: too_far · coords_not_allowed · label_too_long · missing_field. 앱은 too_far일 때 a2 안내") ·
//       §10 2-①·docs/design/reviews/task-015-design.md §1-3 "도시에서 멀 때"·§7("오사카에서 너무 멀어. 여행할 도시 근처로 찍어 줘", 도시 이름은 여행 도시) ·
//       API-001 오류 형식 { error: { code, message, detail } } -> reason은 error.detail.reason (test_task015_lodging.py와 같은 자리)
//
// 계약: '@/lib/create-trip'의 lodgingError(status, code, reason, cityCode): string | null
//   400 · INVALID_LODGING · too_far -> "{도시 이름}에서 너무 멀어. 여행할 도시 근처로 찍어 줘" (도시 이름 = day-list.ts CITY_NAME 표, osaka = 오사카)
//   그 밖 (다른 reason · 다른 코드 · 다른 상태) -> too_far 안내가 아니다. 다른 reason의 글은 문서에 없어 보지 않는다 (질문)
//   [여기로 정했어] 비활성 · 이름 칸 30자 막기는 a2 화면 테스트에서 (이번 범위 밖 — 질문)
import { lodgingError } from '@/lib/create-trip';

const TOO_FAR = '오사카에서 너무 멀어. 여행할 도시 근처로 찍어 줘';

test('T15_S11_Q1_too_far면_a2_안내_오사카에서_너무_멀어', () => {
  expect(lodgingError(400, 'INVALID_LODGING', 'too_far', 'osaka')).toBe(TOO_FAR);
});

test.each<[number, string | null, string | null]>([
  [400, 'INVALID_LODGING', 'coords_not_allowed'],
  [400, 'INVALID_LODGING', 'label_too_long'],
  [400, 'INVALID_LODGING', 'missing_field'],
  [400, 'INVALID_LODGING', null],
  [400, 'VALIDATION_ERROR', 'too_far'],
  [503, 'PROVIDER_UNAVAILABLE', null],
  [409, 'INVALID_LODGING', 'too_far'],
])('T15_S11_Q1_경계_%d_%s_%s는_too_far_안내가_아니다', (status, code, reason) => {
  expect(lodgingError(status, code, reason, 'osaka') ?? '').not.toContain('너무 멀어');
});
