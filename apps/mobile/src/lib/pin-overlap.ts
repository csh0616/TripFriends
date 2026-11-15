// TASK-015 §B6 핀 겹침 규칙 (task-014-design.md §11-3, ②-06a "핀이 겹칠 때"). 순수 함수 — 지도·화면을 모른다.
// 껍데기만 있다 (테스트 세션). 구현은 frontend가 __tests__/task-015-pin-overlap.test.ts를 통과시키며 채운다.

/** 핀 종류. 순위·가림 순서 모두 next > now > lodging > later > done */
export type PinKind = 'next' | 'now' | 'lodging' | 'later' | 'done';

/** 화면 좌표(pt). x·y = 핀 중심, size = 핀 지름(pin-later 28 · pin-done·pin-now 32 · pin-next 36, 숙소는 화면이 정한 값) */
export type ScreenPin = { id: string; kind: PinKind; x: number; y: number; size: number };

export type Rect = { x: number; y: number; width: number; height: number };

export type PinOverlapInput = {
  pins: ScreenPin[];
  /** 지도 화면 크기 (이름표는 가장자리에서 8 안쪽) */
  screen: { width: number; height: number };
  /** 다음 핀 이름표 폭 (글자 길이에 따라 화면이 잰 값). 높이는 28로 정해져 있다 */
  labelWidth: number;
  /** 내 위치 점 또는 reh-dot (중심·지름). 없으면 null */
  me?: { x: number; y: number; size: number } | null;
  /** 떠 있는 판 (상단 줄·알림 등) */
  panels?: Rect[];
  /** 계획상 지금 있는 곳이 숙소 (출발 전·귀가 후) */
  stayingAtLodging?: boolean;
};

export type LabelSide = 'top' | 'right' | 'left' | 'bottom';

export type Badge = { type: 'plus'; count: number; corner: 'top-right' | 'bottom-right' } | { type: 'home'; corner: 'top-right' };

export type ShownPin = ScreenPin & {
  /** 'pin' = 번호 핀 · 'home' = 숙소 마커 · 'now' = 머무는 동안 숙소 마커가 "지금 핀" 모양 */
  shape: 'pin' | 'home' | 'now';
  badges: Badge[];
  /** 이 핀에 묶여 지도에서 빠진 핀 id (숙소가 집 배지로 들어간 것 포함) */
  hidden: string[];
};

export type PinOverlapResult = {
  /** 보일 핀. 그리는 순서(아래 -> 위): done, later, lodging, now, next */
  pins: ShownPin[];
  /** 다음 핀의 이름표. 후보 위 -> 오른쪽 -> 왼쪽 -> 아래, 모두 안 되면 null */
  label: { pinId: string; side: LabelSide; rect: Rect } | null;
  /** 내 위치 점(reh-dot 포함)을 그리나. 숙소에 머무는 동안은 false */
  meDot: boolean;
};

/** 중심 거리가 이 값 "미만"이면 묶는다 */
export const GROUP_DISTANCE = 36;

/** 가림 순서 (위 -> 아래). 위가 보이고 누르기도 위가 받는다 */
export const PIN_STACK = ['next', 'now', 'lodging', 'later', 'done', 'label', 'me', 'route'] as const;

/** 계산 순서 ②~⑤ (①카메라는 호출하는 쪽이 끝낸 뒤 화면 좌표를 넘긴다) */
export function resolvePinOverlap(_input: PinOverlapInput): PinOverlapResult {
  throw new Error('not implemented');
}
