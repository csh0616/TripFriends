/// <reference types="jest" />
// TASK-011 AC-4: §4-11 새 값 11개가 tokens.json에 있고(design-tokens.test T19), 화면은 그 토큰을 이름으로 읽는다 (화면 직접 값 0).
// 근거: TASK-011 §B B1·AC-4, DESIGN-001 §4-11 "이 절이 코드의 출처". 색 직접 값은 guardrails G1이 이미 막는다.
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   apps/mobile/src 아래 (테스트 제외) 어딘가에서 토큰 이름 문자열('bottom-primary' 등)로 tokens.json 값을 읽는다
//   §4-11 숫자(예: back-day의 84, sheet-confirm의 34)는 layout.ts처럼 토큰에서 읽고, 화면 파일에 새 숫자로 다시 적지 않는다 -> 리뷰 몫
import { FIT } from '../test-support/design-table';
import { sourceFiles } from '../test-support/source-files';

const files = sourceFiles();

test.each(Object.keys(FIT))('T11_AC4_토큰_%s를_앱_소스가_이름으로_읽는다', (name) => {
  const users = files.filter(({ text }) => text.includes(`'${name}'`) || text.includes(`"${name}"`)).map(({ path }) => path);
  expect(users.length).toBeGreaterThan(0);
});
