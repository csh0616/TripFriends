// TASK-015 §A ③ · docs/design/reviews/task-015-design.md §1-3 a2 "지도에서 찍기" 화면.
// 껍데기만 있다 (테스트 세션, §11 "test-writer는 로직 없는 타입·함수 모양만"). 구현은 frontend가 __tests__/task-015-lodging-pick.test.tsx를 통과시키며 채운다.

/** 찍은 숙소 (kind: pin). 좌표는 사용자가 지도를 길게 눌러 찍은 값, label은 이름 칸에 친 글 */
export type PickedLodging = { lat: number; lng: number; label: string | null };

/** [여기로 정했어]를 누른 결과. 실패면 서버 오류 그대로 (400 INVALID_LODGING이면 reason = error.detail.reason) */
export type LodgingPickResult = { ok: true } | { ok: false; status: number; code: string | null; reason: string | null };

export type LodgingPickScreenProps = {
  /** 여행 도시 (안내 글의 도시 이름, 예 osaka -> 오사카) */
  cityCode: string;
  /** [여기로 정했어]. 부르는 쪽이 서버에 보내고 결과를 돌려준다 */
  onConfirm: (picked: PickedLodging) => Promise<LodgingPickResult>;
  onBack: () => void;
};

export function LodgingPickScreen(_props: LodgingPickScreenProps): never {
  throw new Error('not implemented');
}
