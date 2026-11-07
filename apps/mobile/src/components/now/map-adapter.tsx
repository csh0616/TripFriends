// TASK-006 B2·ADR-014: react-native-maps를 감싼 유일한 파일. 화면 코드는 이 부품만 쓴다 (SDK를 바꿀 수 있게).
// 노출하는 것: 핀·선·숙소·내 위치·카메라 맞추기·옮기기. 준비 신호가 8초 안에 없으면 onFail (§11 Q17).
// 핀 안은 Svg가 아니라 View와 Text로만 그린다: 지도 Marker는 안의 그림을 사진으로 떠 가는데 중첩 Svg는 네이티브에서 안 그려진 적이 있다 (TASK-005).
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type MapViewProps } from 'react-native-maps';

import mapStyleFile from '../../../assets/map/google-map-style.json';
import { Text } from '@/components/app-text';
import type { NowPin } from '@/lib/now-api';
import { layout } from '@/planning/layout';
import tokens from 'design-tokens';
import { color, control, motion, radius, shadow, space, text } from '@/planning/theme';

export type LatLng = { latitude: number; longitude: number };
export type MapAdapterHandle = {
  /** 모든 점이 보이게 맞춘다. bottom = 시트가 가리는 높이 */
  fit: (coordinates: LatLng[], padding: { top: number; bottom: number }) => void;
  moveTo: (coordinate: LatLng) => void;
};

const MAP_READY_LIMIT_MS = 8000; // §11 Q17

/** 안의 그림이 바뀐 직후에만 Marker가 다시 사진을 뜨게 한다 (계속 켜 두면 지도가 느려진다) */
function useTrackingBriefly(key: string): boolean {
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    setTracking(true);
    const timer = setTimeout(() => setTracking(false), motion['dur-sheet']);
    return () => clearTimeout(timer);
  }, [key]);
  return tracking;
}

const CENTER = { x: 0.5, y: 0.5 } as const;

// DESIGN-001 §4-6 핀 4상태: 지난 = route-done 채움, 지금 = ink 채움, 다음 = brand 고리 + 이름 말풍선, 나중 = 흰 채움 + ink 테두리.
// 색 + 모양·크기로 구분한다. 핀 안은 Svg 없이 View와 Text뿐이다.
// 겹침 순서(zIndex): 내 위치 점 < 핀 < 숙소 < 다음 핀(+말풍선, TASK-007 F4·§11 Q18). 내 위치가 숙소와 같은 자리여도 집 아이콘이 가려지지 않고, 다음 핀은 숙소 아이콘에 가려지지 않는다
const Z_POSITION = 1;
const PIN_Z = { later: 2, done: 3, now: 5, next: 7 } as const;
const Z_HOME = 6;

function PinFace({ pin }: { pin: NowPin }) {
  switch (pin.state) {
    case 'done':
      return (
        <View style={[styles.faceDone]}>
          <Text style={text('num-md', 'on-brand')}>{String(pin.seq)}</Text>
        </View>
      );
    case 'now':
      return (
        <View style={styles.faceNow}>
          <Text style={text('num-md', 'surface')}>{String(pin.seq)}</Text>
        </View>
      );
    case 'next':
      return (
        <View style={styles.faceNext}>
          <Text style={text('num-md')}>{String(pin.seq)}</Text>
        </View>
      );
    default:
      return (
        <View style={styles.faceLater}>
          <Text style={text('num-md')}>{String(pin.seq)}</Text>
        </View>
      );
  }
}

function NumberPin({ pin }: { pin: NowPin }) {
  const tracking = useTrackingBriefly(`${pin.seq}-${pin.state}-${pin.state === 'next' ? pin.name : ''}`);
  const next = pin.state === 'next';
  return (
    <Marker
      testID={`map-pin-${pin.seq}`}
      coordinate={{ latitude: pin.lat, longitude: pin.lng }}
      anchor={CENTER}
      tracksViewChanges={tracking}
      zIndex={PIN_Z[pin.state] ?? PIN_Z.later}
    >
      {/* 누르는 영역은 모양과 상관없이 44. 핀을 눌렀을 때의 동작은 없다 (영역만 확보) */}
      <View style={styles.pinColumn}>
        {next ? (
          <View style={styles.bubble}>
            <Text numberOfLines={1} style={text('label')}>
              {pin.name}
            </Text>
          </View>
        ) : null}
        <View style={styles.pinTouch}>
          <PinFace pin={pin} />
        </View>
        {/* 말풍선과 같은 높이의 빈 칸: 핀 가운데가 마커의 가운데가 되게 */}
        {next ? <View style={styles.bubbleSpacer} /> : null}
      </View>
    </Marker>
  );
}

function HomePin({ coordinate }: { coordinate: LatLng }) {
  const tracking = useTrackingBriefly('home');
  return (
    <Marker testID="map-home" coordinate={coordinate} anchor={CENTER} tracksViewChanges={tracking} zIndex={Z_HOME}>
      <View style={styles.home}>
        {/* 집 모양: 45도 돌린 네모의 윗변·왼변이 지붕, 아래 네모가 벽 (변환은 View 하나에만) */}
        <View style={styles.homeRoof} />
        <View style={styles.homeWall} />
      </View>
    </Marker>
  );
}

function MyPosition({ coordinate }: { coordinate: LatLng }) {
  const tracking = useTrackingBriefly('position');
  return (
    <Marker testID="map-my-position" coordinate={coordinate} anchor={CENTER} tracksViewChanges={tracking} zIndex={Z_POSITION}>
      <View style={styles.position} />
    </Marker>
  );
}

// ---------- 남은 길의 점선 (§13 E3) ----------
// 먼저 lineDashPattern 한 줄로 한다. iOS Google 지도에서 점선이 안 그려지면 DASH_MODE만 'segments'로 바꾼다:
// 짧은 선 조각을 띄엄띄엄 이어 점선처럼 보이게 한다. 이 선택은 이 파일 안에 가둔다.
const DASH_MODE: 'pattern' | 'segments' = 'pattern';
const DASH = tokens.map['route-dash']; // [선 길이, 빈 길이]
const SEGMENT_METERS_PER_UNIT = 3; // 'segments' 방식의 기본 단위(m). 지금은 metersPerPoint로 환산한 값을 넘기므로 단위 1을 쓴다
const METERS_PER_DEGREE = (Math.PI / 180) * 6371000;

/** 경로를 따라 [선, 빈칸, 선, 빈칸...]으로 잘라 선 조각들의 좌표 목록을 만든다 */
export function dashSegments(path: LatLng[], dash: readonly number[] = DASH, unit: number = SEGMENT_METERS_PER_UNIT): LatLng[][] {
  const [on, off] = [dash[0] * unit, dash[1] * unit];
  const pieces: LatLng[][] = [];
  let current: LatLng[] = [];
  let drawing = true;
  let left = on;
  if (path.length === 0) return pieces;
  current = [path[0]];
  for (let i = 1; i < path.length; i += 1) {
    const [from, to] = [path[i - 1], path[i]];
    const cosLat = Math.cos((from.latitude * Math.PI) / 180);
    const length = Math.hypot((to.latitude - from.latitude) * METERS_PER_DEGREE, (to.longitude - from.longitude) * METERS_PER_DEGREE * cosLat);
    if (length === 0) continue;
    let used = 0;
    while (length - used > left) {
      used += left;
      const ratio = used / length;
      const point = {
        latitude: from.latitude + (to.latitude - from.latitude) * ratio,
        longitude: from.longitude + (to.longitude - from.longitude) * ratio,
      };
      if (drawing) {
        current.push(point);
        pieces.push(current);
        current = [];
      } else {
        current = [point];
      }
      drawing = !drawing;
      left = drawing ? on : off;
    }
    left -= length - used;
    if (drawing) current.push(to);
  }
  if (drawing && current.length >= 2) pieces.push(current);
  return pieces;
}

// 점선 단위: iOS Google 지도의 lineDashPattern은 "미터"라서 토큰 [10, 8](화면 점 기준)을 그대로 쓰면 도시 줌에서 빗금이 된다.
// 지도 위 화면 점 하나가 몇 m인지(metersPerPoint)로 곱해 화면 점 기준 점선으로 환산한다. 줌이 바뀌면 다시 구한다.
// 값을 아직 모르면(첫 영역 전, 테스트) 1이라 토큰 그대로다.
function RemainingRoute({ path, metersPerPoint }: { path: LatLng[]; metersPerPoint: number }) {
  const pattern = DASH.map((value) => Math.max(1, Math.round(value * metersPerPoint)));
  const pieces = DASH_MODE === 'segments' ? dashSegments(path, pattern, 1) : null;
  return (
    <>
      {/* 흰 테두리: 주황은 땅 위에서 흰 테두리 없이 쓰지 않는다 (DESIGN-001 §4-6) */}
      <Polyline
        testID="map-route-casing"
        coordinates={path}
        strokeColor={color.surface}
        strokeWidth={tokens.map['route-casing']}
        lineCap="round"
        zIndex={1}
      />
      {pieces ? (
        pieces.map((piece, index) => (
          <Polyline
            key={`remaining-${index}`}
            testID={`map-route-remaining-${index}`}
            coordinates={piece}
            strokeColor={color.brand}
            strokeWidth={tokens.map['route-width']}
            lineCap="butt"
            zIndex={2}
          />
        ))
      ) : (
        <Polyline
          testID="map-route-remaining"
          coordinates={path}
          strokeColor={color.brand}
          strokeWidth={tokens.map['route-width']}
          lineDashPattern={pattern}
          lineCap="butt"
          zIndex={2}
        />
      )}
    </>
  );
}

const MAP_STYLE = mapStyleFile as unknown as MapViewProps['customMapStyle']; // 원본: docs/design/google-map-style.json (§13 E1)

export function MapAdapter({
  ref,
  center,
  home,
  pins,
  routeDone,
  routeRemaining,
  position,
  onReady,
  onFail,
}: {
  ref?: Ref<MapAdapterHandle>;
  center: LatLng;
  home: LatLng;
  pins: NowPin[];
  routeDone: LatLng[];
  routeRemaining: LatLng[];
  position: LatLng | null;
  onReady: () => void;
  onFail: () => void;
}) {
  const map = useRef<MapView>(null);
  const { width: mapWidth } = useWindowDimensions();
  const [metersPerPoint, setMetersPerPoint] = useState(1);
  const ready = useRef(false);

  useImperativeHandle(ref, () => ({
    fit: (coordinates, padding) => {
      map.current?.fitToCoordinates(coordinates, {
        edgePadding: { top: padding.top, bottom: padding.bottom, left: layout.mapEdge, right: layout.mapEdge },
        animated: false,
      });
    },
    moveTo: (coordinate) => {
      map.current?.animateToRegion(
        { ...coordinate, latitudeDelta: layout.mapDelta, longitudeDelta: layout.mapDelta },
        motion['dur-base'],
      );
    },
  }));

  // 8초 안에 지도가 준비됐다는 신호가 없으면 실패로 본다
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!ready.current) onFail();
    }, MAP_READY_LIMIT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signalReady = () => {
    if (ready.current) return;
    ready.current = true;
    onReady();
  };

  return (
    <MapView
      ref={map}
      testID="map-view"
      provider={PROVIDER_GOOGLE}
      customMapStyle={MAP_STYLE}
      style={StyleSheet.absoluteFill}
      initialRegion={{ ...center, latitudeDelta: layout.mapDelta, longitudeDelta: layout.mapDelta }}
      toolbarEnabled={false}
      onRegionChangeComplete={(region) => {
        // 화면 가로 한 점이 몇 m인지: 경도 폭(도) -> m, 위도에 따라 줄어든다
        const meters = region.longitudeDelta * METERS_PER_DEGREE * Math.cos((region.latitude * Math.PI) / 180);
        const next = meters / mapWidth;
        setMetersPerPoint((now) => (Number.isFinite(next) && next > 0 && Math.abs(next - now) / now > 0.1 ? next : now));
      }}
      onMapReady={signalReady}
      onMapLoaded={signalReady}
    >
      {routeDone.length >= 2 ? (
        <Polyline
          testID="map-route-done"
          coordinates={routeDone}
          strokeColor={color['route-done']}
          strokeWidth={tokens.map['route-width']}
          lineCap="round"
          zIndex={0}
        />
      ) : null}
      {routeRemaining.length >= 2 ? <RemainingRoute path={routeRemaining} metersPerPoint={metersPerPoint} /> : null}
      <HomePin coordinate={home} />
      {pins.map((pin) => (
        <NumberPin key={pin.seq} pin={pin} />
      ))}
      {position ? <MyPosition coordinate={position} /> : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  pinColumn: { alignItems: 'center' },
  pinTouch: { width: control['touch-min'], height: control['touch-min'], alignItems: 'center', justifyContent: 'center' },
  faceDone: {
    width: layout.pinDone,
    height: layout.pinDone,
    borderRadius: radius['r-full'],
    backgroundColor: color['route-done'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceNow: {
    width: layout.pinNow,
    height: layout.pinNow,
    borderRadius: radius['r-full'],
    backgroundColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceNext: {
    width: layout.pinNext,
    height: layout.pinNext,
    borderRadius: radius['r-full'],
    backgroundColor: color.surface,
    borderWidth: layout.pinRing,
    borderColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceLater: {
    width: layout.pinLater,
    height: layout.pinLater,
    borderRadius: radius['r-full'],
    backgroundColor: color.surface,
    borderWidth: layout.routeHomeStroke,
    borderColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    height: layout.pinBubble,
    maxWidth: layout.pinBubbleMax,
    paddingHorizontal: space['space-2'],
    borderRadius: radius['r-full'],
    backgroundColor: color.surface,
    justifyContent: 'center',
    ...shadow.raise,
  },
  bubbleSpacer: { height: layout.pinBubble },
  home: {
    width: layout.homePin,
    height: layout.homePin,
    borderRadius: radius['r-full'],
    backgroundColor: color.surface,
    borderWidth: layout.routeHomeStroke,
    borderColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeRoof: {
    width: layout.homeRoof,
    height: layout.homeRoof,
    borderTopWidth: layout.homeStroke,
    borderLeftWidth: layout.homeStroke,
    borderColor: color.ink,
    transform: [{ rotate: '45deg' }],
    marginBottom: -layout.homeRoof / 2,
  },
  homeWall: {
    width: layout.homeWall[0],
    height: layout.homeWall[1],
    borderLeftWidth: layout.homeStroke,
    borderRightWidth: layout.homeStroke,
    borderBottomWidth: layout.homeStroke,
    borderColor: color.ink,
  },
  position: {
    width: layout.positionDot,
    height: layout.positionDot,
    borderRadius: radius['r-full'],
    backgroundColor: color.ink,
    borderWidth: layout.positionBorder,
    borderColor: color.surface,
  },
});
