/// <reference types="jest" />
// TASK-015 §20 #5 T-08 이유 줄 "오늘 일정이 끝났어"(숙소 있음)와 이유 줄 숨김 규칙이 맞물리는지. 순수 함수만 본다.
// 근거: TASK-015 §20 표 #5(T-08 이유 줄: "오늘 일정이 끝났어. 숙소로 가 볼까?" -> "오늘 일정이 끝났어", REASONS 표와 같게) ·
//       task-014-design §14-1 표(T-08 숙소 있음 = "오늘 일정이 끝났어" ①-31 / 숙소 없음 = 본문과 같은 말이라 이유 줄 숨김) ·
//       TASK-015 §17 frontend 정한 것 승인("이유 줄은 숙소 없는 T-08 본문과 같을 때만 숨김")
// 확인: 새 문구는 숙소 없는 본문("오늘 일정이 끝났어. 오늘도 수고했어!")과 다르다 -> 숙소 있는 T-08의 이유 줄은 숨겨지지 않는다
import { NO_LODGING_BODY, reasonHidden } from '@/components/now/now-cards';

import { t08 } from '../test-support/trip-now-fixtures';

const DAY_OVER = '오늘 일정이 끝났어';

test('T15_S20_5_숙소_있는_T_08의_새_이유_줄은_숨기지_않는다', () => {
  expect(reasonHidden(t08() as never, DAY_OVER)).toBe(false);
});

test('T15_S20_5_경계_숙소_없는_T_08은_본문과_같은_이유_줄만_숨긴다', () => {
  expect(reasonHidden(t08({ lodging: null, map_url: null, go_home_min: null }) as never, NO_LODGING_BODY)).toBe(true);
  expect(reasonHidden(t08({ lodging: null, map_url: null, go_home_min: null }) as never, DAY_OVER)).toBe(false); // 본문과 다른 말이면 보인다
});

test('T15_S20_5_경계_새_문구는_숙소_없는_본문과_다르다', () => {
  expect(DAY_OVER).not.toBe(NO_LODGING_BODY);
});
