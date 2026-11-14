// TASK-014 §24·§25: 연습 지도 카메라를 fit 대신 직접 계산한다.
//   머무는 중(state "now" 핀): 동서 800m, 그 장소가 "보이는 띠" 가운데
//   이동 중: 지금 자리·출발·도착(없으면 출발·도착)이 좌우 여백·띠 안에 들어가는 가장 작은 폭.
//            동서 3km를 넘어야 하면 3km로 묶고 reh-dot(없으면 도착할 곳)을 띠 가운데
// 화면 y는 메르카토르(ln tan(π/4+φ/2))로 계산해 위아래·좌우 1pt가 같은 땅 길이가 되게 한다.
// 구간 키가 같으면(같은 구간 안에서 시각만 바뀜) 화면이 다시 맞추지 않는다.
import type { NowPin } from '@/lib/now-api';
import { layout } from '@/planning/layout';

type At = { lat: number; lng: number };
export type ViewBox = { width: number; height: number; top: number; bottom: number };
export type CameraRegion = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

const STAY_SPAN_M = 800;
const MOVE_CAP_M = 3000; // 이동 중 동서 폭 상한 (§24 가설)
const EARTH_R = 6371000;
const RAD = Math.PI / 180;

const merc = (latRad: number) => Math.log(Math.tan(Math.PI / 4 + latRad / 2));
const unmerc = (m: number) => 2 * Math.atan(Math.exp(m)) - Math.PI / 2;

/** at이 화면 (px, py)에 오게, 1rad 경도가 k pt인 영역 */
function regionAt(at: At, px: number, py: number, k: number, box: ViewBox): CameraRegion {
  const northM = merc(at.lat * RAD) + py / k;
  const southM = northM - box.height / k;
  const north = unmerc(northM);
  const south = unmerc(southM);
  const lonRad = at.lng * RAD - (px - box.width / 2) / k;
  return {
    latitude: ((north + south) / 2) / RAD,
    longitude: lonRad / RAD,
    latitudeDelta: (north - south) / RAD,
    longitudeDelta: (box.width / k) / RAD,
  };
}

/** 동서 폭이 spanM이 되는 k (영역 가운데 위도의 cos로 줄어든다) */
const kForSpan = (spanM: number, latRad: number, box: ViewBox) => (box.width * EARTH_R * Math.cos(latRad)) / spanM;

const PIN_INSET = 30; // §26: 핀 반지름 22 + 여백 8

export type RehearsalCameraResult = { key: string; region: CameraRegion };

/** region 영역에서 at의 화면 위치 (메르카토르) */
function project(region: CameraRegion, box: ViewBox, at: At) {
  const x = box.width / 2 + ((at.lng - region.longitude) / region.longitudeDelta) * box.width;
  const north = merc((region.latitude + region.latitudeDelta / 2) * RAD);
  const south = merc((region.latitude - region.latitudeDelta / 2) * RAD);
  const y = ((north - merc(at.lat * RAD)) / (north - south)) * box.height;
  return { x, y };
}

export function rehearsalCamera(
  pins: NowPin[],
  position: At | null,
  lodging: At,
  fullBox: ViewBox,
  previous?: RehearsalCameraResult,
): RehearsalCameraResult {
  // 보이는 띠 안에서 핀 전체가 보이게 위·아래 30씩 줄인다 (§26). 가운데는 같다
  const box: ViewBox = { ...fullBox, top: fullBox.top + PIN_INSET, bottom: fullBox.bottom - PIN_INSET };
  const bandCenter = (box.top + box.bottom) / 2;
  const now = pins.find((pin) => pin.state === 'now');
  if (now) {
    let guess = now.lat * RAD;
    let region = regionAt(now, box.width / 2, bandCenter, kForSpan(STAY_SPAN_M, guess, box), box);
    for (let i = 0; i < 3; i += 1) {
      guess = region.latitude * RAD;
      region = regionAt(now, box.width / 2, bandCenter, kForSpan(STAY_SPAN_M, guess, box), box);
    }
    const key = `stay-${now.seq}`;
    return previous && previous.key === key ? previous : { key, region };
  }

  const done = pins.filter((pin) => pin.state === 'done');
  const from = done.length > 0 ? done.reduce((a, b) => (b.seq > a.seq ? b : a)) : null;
  const to = pins.find((pin) => pin.state === 'next') ?? null;
  const start: At = from ?? lodging;
  const end: At = to ?? lodging;
  const key = `move-${from ? from.seq : 'home'}-${to ? to.seq : 'home'}`;

  const points = position ? [position, start, end] : [start, end];
  const lats = points.map((p) => merc(p.lat * RAD));
  const lngs = points.map((p) => p.lng * RAD);
  const rangeY = Math.max(...lats) - Math.min(...lats);
  const rangeX = Math.max(...lngs) - Math.min(...lngs);
  const centerAt: At = {
    lat: unmerc((Math.max(...lats) + Math.min(...lats)) / 2) / RAD,
    lng: ((Math.max(...lngs) + Math.min(...lngs)) / 2) / RAD,
  };
  const focus = position ?? end; // 3km로 묶을 때 띠 가운데: reh-dot, 모르면 도착할 곳 (§25 Q5)

  const side = layout.mapEdge;
  const bandHeight = Math.max(1, box.bottom - box.top);
  let guess = centerAt.lat * RAD;
  let region = regionAt(centerAt, box.width / 2, bandCenter, 1, box);
  let clamped = false;
  for (let i = 0; i < 4; i += 1) {
    const kFit = Math.min(
      rangeX > 0 ? (box.width - 2 * side) / rangeX : Infinity,
      rangeY > 0 ? bandHeight / rangeY : Infinity,
    );
    const kMax = kForSpan(STAY_SPAN_M, guess, box); // 너무 좁게 들어가지 않게 (머무는 폭이 한계)
    const kMin = kForSpan(MOVE_CAP_M, guess, box);
    clamped = kFit < kMin;
    if (clamped) {
      region = regionAt(focus, box.width / 2, bandCenter, kMin, box);
    } else {
      region = regionAt(centerAt, box.width / 2, bandCenter, Math.min(kFit, kMax), box);
    }
    guess = region.latitude * RAD;
  }
  if (previous && previous.key === key) {
    if (!clamped) return previous; // 3km 미만: 같은 구간이면 그대로
    // 3km로 묶인 구간: reh-dot(모르면 도착할 곳)이 이전 영역의 줄어든 띠·가로 [30, 폭-30] 안이면 그대로
    const { x, y } = project(previous.region, box, focus);
    const inside = y >= box.top && y <= box.bottom && x >= PIN_INSET && x <= box.width - PIN_INSET;
    if (inside) return previous;
  }
  return { key, region };
}
