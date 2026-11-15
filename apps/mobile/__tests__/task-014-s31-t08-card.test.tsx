/// <reference types="jest" />
// TASK-014 §31 Q2·Q3: 숙소 없는 T-08 카드 모양 (카드 부품만). 로직·가드레일만 본다 (색·간격 없음).
// 근거: TASK-014 §31 표 Q2("T-08을 숨기지 않고 '숙소 없는 모양'으로: 제목 '오늘 일정 끝', 숙소 줄·[숙소로 길 안내] 없음, 본문은 Q3 문구")
//       · Q3("숙소 없음: '오늘 일정이 끝났어. 오늘도 수고했어!' / 숙소 있음은 지금 문구 그대로") · TASK-006 §13 E4(숙소 길찾기 버튼).
//
// 계약 (승인 대기):
//   서버의 숙소 없는 T-08 = { type: 'T-08', go_home_min, lodging: null, map_url: null } (api-types는 백엔드 뒤 생성 — 여기서는 as never로 넘긴다)
//   NowCardView(T-08, lodging null) -> card-T-08 안에 "오늘 일정 끝"(제목)·"오늘 일정이 끝났어. 오늘도 수고했어!"(본문), '숙소' 글자 없음, home-directions-button 없음
//   메인이든 보조 자리든(main true/false) 같다. go_home_min 값과 상관없다 (0·25·null — §31 답 1: 서버는 숙소 없으면 null을 준다)
//   숙소 있음(lodging {lat,lng}, map_url 문자열) -> 지금 모양 그대로: home-directions-button 있음, 위 두 문구 없음
import { render, screen, within } from '@testing-library/react-native';

import { NowCardView } from '@/components/now/now-cards';
import { t08 } from '../test-support/trip-now-fixtures';

const DAY_OVER_TITLE = '오늘 일정 끝';
const NO_LODGING_BODY = '오늘 일정이 끝났어. 오늘도 수고했어!';

async function show(card: object, main = true) {
  await render(<NowCardView card={card as never} main={main} onOpenFailed={() => {}} />);
  return within(screen.getByTestId('card-T-08'));
}

describe('§31 Q2 숙소 없는 T-08 모양', () => {
  test.each([
    [true, null],
    [false, null],
    [true, 25],
    [true, 0],
    [false, 25],
  ])('T14_S31_Q2_숙소_없는_T_08은_제목_오늘_일정_끝·본문_수고했어 (main=%s, go_home_min=%s)', async (main, goHome) => {
    const card = await show(t08({ lodging: null, map_url: null, go_home_min: goHome }), main);
    expect(card.getByText(DAY_OVER_TITLE)).toBeTruthy();
    expect(card.getByText(NO_LODGING_BODY)).toBeTruthy();
  });

  test.each([
    [true, null],
    [false, null],
    [true, 25],
    [true, 0],
    [false, 25],
  ])('T14_S31_Q2_숙소_없는_T_08에는_숙소_줄과_숙소로_길_안내_버튼이_없다 (main=%s, go_home_min=%s)', async (main, goHome) => {
    const card = await show(t08({ lodging: null, map_url: null, go_home_min: goHome }), main);
    expect(card.queryByText(/숙소/)).toBeNull();
    expect(card.queryByTestId('home-directions-button')).toBeNull();
  });

  test('T14_S31_Q3_경계_숙소_있는_T_08은_지금_모양_그대로_길_안내_버튼이_있고_수고했어·오늘_일정_끝이_없다', async () => {
    const card = await show(t08());
    expect(card.getByTestId('home-directions-button')).toBeTruthy();
    expect(card.getByText('숙소로 길 안내')).toBeTruthy();
    expect(card.queryByText(NO_LODGING_BODY)).toBeNull();
    expect(card.queryByText(DAY_OVER_TITLE)).toBeNull();
  });
});
