// TASK-006 B2·ADR-014: react-native-maps를 감싼 유일한 파일. 화면 코드는 이 부품만 쓴다 (SDK를 바꿀 수 있게).
// 노출하는 것: 핀·선·숙소·내 위치·카메라 맞추기·옮기기. 준비 신호가 8초 안에 없으면 onFail (§11 Q17).
// 핀 안은 Svg가 아니라 View와 Text로만 그린다: 지도 Marker는 안의 그림을 사진으로 떠 가는데 중첩 Svg는 네이티브에서 안 그려진 적이 있다 (TASK-005).
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { Text } from '@/components/app-text';
import type { NowPin } from '@/lib/now-api';
import { layout } from '@/planning/layout';
import { color, motion, radius, text } from '@/planning/theme';

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

function NumberPin({ pin }: { pin: NowPin }) {
  const tracking = useTrackingBriefly(`${pin.seq}-${pin.state}`);
  const now = pin.state === 'now';
  return (
    <Marker
      testID={`map-pin-${pin.seq}`}
      coordinate={{ latitude: pin.lat, longitude: pin.lng }}
      anchor={CENTER}
      tracksViewChanges={tracking}
      zIndex={now ? 2 : 1}
    >
      <View style={[styles.pinRing, now && styles.pinRingNow]}>
        <View style={styles.pin}>
          <Text style={text('num-md', 'surface')}>{String(pin.seq)}</Text>
        </View>
      </View>
    </Marker>
  );
}

function HomePin({ coordinate }: { coordinate: LatLng }) {
  const tracking = useTrackingBriefly('home');
  return (
    <Marker testID="map-home" coordinate={coordinate} anchor={CENTER} tracksViewChanges={tracking} zIndex={0}>
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
    <Marker testID="map-my-position" coordinate={coordinate} anchor={CENTER} tracksViewChanges={tracking} zIndex={3}>
      <View style={styles.position} />
    </Marker>
  );
}

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
      style={StyleSheet.absoluteFill}
      initialRegion={{ ...center, latitudeDelta: layout.mapDelta, longitudeDelta: layout.mapDelta }}
      toolbarEnabled={false}
      onMapReady={signalReady}
      onMapLoaded={signalReady}
    >
      {routeDone.length >= 2 ? (
        <Polyline testID="map-route-done" coordinates={routeDone} strokeColor={color.line} strokeWidth={layout.routeLine} lineCap="round" />
      ) : null}
      {routeRemaining.length >= 2 ? (
        <Polyline
          testID="map-route-remaining"
          coordinates={routeRemaining}
          strokeColor={color.brand}
          strokeWidth={layout.routeLine}
          lineDashPattern={[...layout.routeDash]}
          lineCap="round"
        />
      ) : null}
      <HomePin coordinate={home} />
      {pins.map((pin) => (
        <NumberPin key={pin.seq} pin={pin} />
      ))}
      {position ? <MyPosition coordinate={position} /> : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  pinRing: {
    width: layout.pin + 2 * layout.pinRing,
    height: layout.pin + 2 * layout.pinRing,
    borderRadius: radius['r-full'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinRingNow: { borderWidth: layout.pinRing, borderColor: color.brand },
  pin: {
    width: layout.pin,
    height: layout.pin,
    borderRadius: radius['r-full'],
    backgroundColor: color.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
