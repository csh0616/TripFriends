// TASK-006 B2·ADR-014: react-native-maps를 감싼 유일한 파일. 화면 코드는 이 부품만 쓴다 (SDK를 바꿀 수 있게).
// 노출하는 것: 핀·선·숙소·내 위치·카메라 맞추기·옮기기. 준비 신호가 8초 안에 없으면 onFail (§11 Q17).
// 핀 안은 Svg가 아니라 View와 Text로만 그린다: 지도 Marker는 안의 그림을 사진으로 떠 가는데 중첩 Svg는 네이티브에서 안 그려진 적이 있다 (TASK-005).
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type MapViewProps } from 'react-native-maps';

import mapStyleFile from '../../../assets/map/google-map-style.json';
import { Text } from '@/components/app-text';
import { metersPerPoint as metersPerPointOf, project, scaleBar, unproject, visibleArea, type Region } from '@/lib/map-project';
import type { NowPin } from '@/lib/now-api';
import { resolvePinOverlap, type Badge, type PinOverlapResult, type Rect, type ScreenPin } from '@/lib/pin-overlap';
import { layout } from '@/planning/layout';
import tokens from 'design-tokens';
import { color, control, motion, radius, shadow, space, text } from '@/planning/theme';

export type LatLng = { latitude: number; longitude: number };
export type MapAdapterHandle = {
  /** 모든 점이 보이게 맞춘다. bottom = 시트가 가리는 높이 */
  fit: (coordinates: LatLng[], padding: { top: number; bottom: number }) => void;
  /** TASK-014 §24: 직접 계산한 영역으로 한 번에 (연습 카메라) */
  showRegion: (region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) => void;
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
const Z_LABEL = 4; // 이름표는 핀 아래·내 위치 점 위 (PIN_STACK: 핀 > 이름표 > 내 위치 점)

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

const PIN_SIZE: Record<string, number> = { next: layout.pinNext, now: layout.pinNow, later: layout.pinLater, done: layout.pinDone };
/** 이름표 폭 (글자 수로 어림: 한글 12 · 그 밖 7 + 좌우 8, 최대 pinBubbleMax) */
const labelWidthOf = (name: string): number =>
  Math.min(layout.pinBubbleMax, [...name].reduce((sum, ch) => sum + (ch.charCodeAt(0) > 0x7f ? 12 : 7), 0) + space['space-2'] * 2);

const BADGE = 18; // 묶음 +N · 집 배지 지름 (글자 12 이상)

/** 핀 모서리 배지: +N (ink 면 · 흰 글자) 또는 집 (흰 면 · ink 테두리) */
function PinBadge({ badge, face }: { badge: Badge; face: number }) {
  const inset = (control['touch-min'] - face) / 2;
  const place = badge.corner === 'top-right' ? { top: inset - BADGE / 3, right: inset - BADGE / 3 } : { bottom: inset - BADGE / 3, right: inset - BADGE / 3 };
  return (
    <View testID={badge.type === 'plus' ? 'pin-badge-plus' : 'pin-badge-home'} style={[styles.badge, badge.type === 'home' && styles.badgeHome, place]}>
      {badge.type === 'plus' ? <Text style={text('label', 'surface')}>{`+${badge.count}`}</Text> : <HouseGlyph tint={color.ink} scale={0.6} />}
    </View>
  );
}

type Rules = { badges: Badge[]; a11yLabel: string; showBubble: boolean };

function NumberPin({ pin, rules }: { pin: NowPin; rules?: Rules }) {
  const badgeKey = rules ? rules.badges.map((b) => (b.type === 'plus' ? `+${b.count}` : 'h')).join('') : '';
  const tracking = useTrackingBriefly(`${pin.seq}-${pin.state}-${pin.state === 'next' ? pin.name : ''}-${badgeKey}-${rules?.showBubble}`);
  const next = pin.state === 'next' && (rules ? rules.showBubble : true);
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
        <View style={styles.pinTouch} accessible={rules !== undefined} accessibilityLabel={rules?.a11yLabel}>
          <PinFace pin={pin} />
          {rules ? rules.badges.map((badge) => <PinBadge key={badge.type} badge={badge} face={pin.state === 'next' ? layout.pinNext : pin.state === 'now' ? layout.pinNow : layout.pinLater} />) : null}
        </View>
        {/* 말풍선과 같은 높이의 빈 칸: 핀 가운데가 마커의 가운데가 되게 */}
        {next ? <View style={styles.bubbleSpacer} /> : null}
      </View>
    </Marker>
  );
}

function HomePin({ coordinate, shape = 'home', badges = [], a11yLabel }: { coordinate: LatLng; shape?: 'home' | 'now'; badges?: Badge[]; a11yLabel?: string }) {
  const tracking = useTrackingBriefly(`home-${shape}`);
  return (
    <Marker testID="map-home" coordinate={coordinate} anchor={CENTER} tracksViewChanges={tracking} zIndex={Z_HOME}>
      <View style={styles.pinTouch} accessible={a11yLabel !== undefined} accessibilityLabel={a11yLabel}>
        {shape === 'now' ? (
          // 숙소에 머무는 동안: "지금 핀" 모양 32 (ink 면 · 흰 테두리 3 · 흰 집)
          <View style={styles.pickFace}>
            <HouseGlyph tint={color.surface} />
          </View>
        ) : (
          <View style={styles.home}>
            <HouseGlyph tint={color.ink} />
          </View>
        )}
        {badges.map((badge) => (
          <PinBadge key={badge.type} badge={badge} face={layout.homePin} />
        ))}
      </View>
    </Marker>
  );
}

/** 이름표 (겹침 규칙이 자리를 정한 뒤): 핀과 따로 선 Marker */
function NameTag({ coordinate, name, width }: { coordinate: LatLng; name: string; width: number }) {
  const tracking = useTrackingBriefly(`tag-${name}-${width}`);
  return (
    <Marker testID="map-pin-label" coordinate={coordinate} anchor={CENTER} tracksViewChanges={tracking} zIndex={Z_LABEL} tappable={false}>
      <View style={[styles.bubble, { width, maxWidth: undefined }]}>
        <Text numberOfLines={1} style={[text('label'), styles.tagText]}>
          {name}
        </Text>
      </View>
    </Marker>
  );
}

function MyPosition({ coordinate, hollow }: { coordinate: LatLng; hollow: boolean }) {
  const tracking = useTrackingBriefly('position');
  return (
    <Marker testID={hollow ? 'map-reh-dot' : 'map-my-position'} coordinate={coordinate} anchor={CENTER} tracksViewChanges={tracking} zIndex={Z_POSITION}>
      <View style={hollow ? styles.rehDot : styles.position} />
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

/** 집 모양 (숙소 마커·찍은 핀 안): 45도 돌린 네모의 윗변·왼변이 지붕, 아래 네모가 벽. 지도 Marker 안이라 Svg 없이 View로 (변환은 View 하나에만) */
export function HouseGlyph({ tint, scale = 1 }: { tint: string; scale?: number }) {
  const roof = layout.homeRoof * scale;
  return (
    <View style={styles.homeGlyph}>
      <View style={{ width: roof, height: roof, borderTopWidth: layout.homeStroke, borderLeftWidth: layout.homeStroke, borderColor: tint, transform: [{ rotate: '45deg' }], marginBottom: -roof / 2 }} />
      <View style={{ width: layout.homeWall[0] * scale, height: layout.homeWall[1] * scale, borderLeftWidth: layout.homeStroke, borderRightWidth: layout.homeStroke, borderBottomWidth: layout.homeStroke, borderColor: tint }} />
    </View>
  );
}

// ---------- TASK-015 §A ③ a2: 지도에서 찍기 (길게 눌러 핀) ----------
const PICK_AREA_RADIUS = 64; // task-015-design §1-3 pick-area: 핀 중심 반지름 64 (그림일 뿐, 저장은 좌표 하나)
const PICK_FACE = 32; // pin-pick = 머무는 동안 숙소 마커 = "지금 핀" 모양 (지름 32 · ink 면 · 흰 테두리 3 · 흰 집)
const PICK_BORDER = 3;
const WIDE_DELTA = 8; // 중심을 모를 때(도시 정보를 못 받음) 일본이 보이는 정도

export function PickMap({
  center,
  pin,
  bottomPadding,
  onLongPress,
  onReady,
  onFail,
}: {
  /** 여행 도시 중심. 모르면 null (일본 가운데에서 넓게 시작) */
  center: LatLng | null;
  pin: LatLng | null;
  /** 아래 시트가 가리는 높이 (Google 로고가 가려지지 않게 mapPadding.bottom) */
  bottomPadding: number;
  onLongPress: (at: LatLng) => void;
  onReady: () => void;
  onFail: () => void;
}) {
  const ready = useRef(false);
  const pinKey = pin ? `${pin.latitude},${pin.longitude}` : 'none';
  const tracking = useTrackingBriefly(pinKey);
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
  const start = center ?? NO_CENTER;
  const delta = center ? layout.mapDelta : WIDE_DELTA;
  return (
    <MapView
      testID="pick-map"
      provider={PROVIDER_GOOGLE}
      customMapStyle={MAP_STYLE}
      style={StyleSheet.absoluteFill}
      initialRegion={{ ...start, latitudeDelta: delta, longitudeDelta: delta }}
      mapPadding={{ top: 0, left: 0, right: 0, bottom: bottomPadding }}
      toolbarEnabled={false}
      onLongPress={(event) => onLongPress(event.nativeEvent.coordinate)}
      onMapReady={signalReady}
      onMapLoaded={signalReady}
    >
      {pin ? (
        <>
          <Marker testID="pick-area" coordinate={pin} anchor={CENTER} tracksViewChanges={tracking} zIndex={0} tappable={false}>
            <View style={styles.pickArea} />
          </Marker>
          <Marker testID="pin-pick" coordinate={pin} anchor={CENTER} tracksViewChanges={tracking} zIndex={1}>
            <View style={styles.pickFace}>
              <HouseGlyph tint={color.surface} />
            </View>
          </Marker>
        </>
      ) : null}
    </MapView>
  );
}

// ---------- TASK-015 §D: 코스 크게 보기 (실제 지도 위 경로·핀·축척) ----------
export type CourseStop = { seq: number; lat: number; lng: number; /** 이름표에 쓴다. 없으면 그 핀은 이름표 없음 */ name?: string };

/** 축척 막대 (react-native-maps의 showsScale은 Apple 지도 전용이라 Google 지도에서는 직접 그린다): 위 글자, 아래 L자 눈금 */
function MapScale({ region, width }: { region: Region; width: number }) {
  const bar = scaleBar(metersPerPointOf(region, width));
  if (!bar) return null;
  const digits = bar.label.match(/^(\d+)(.*)$/);
  return (
    <View testID="map-scale" accessible accessibilityLabel={`축척 ${bar.label}`} style={styles.scale}>
      <Text style={text('label', 'ink')}>
        {digits ? <Text style={text('num-sm', 'ink')}>{digits[1]}</Text> : null}
        {digits ? digits[2] : bar.label}
      </Text>
      <View style={[styles.scaleBar, { width: bar.width }]} />
    </View>
  );
}

export function CourseMap({
  stops,
  home,
  padding,
  scaleBottom,
  panels = [],
  onReady,
  onFail,
}: {
  stops: CourseStop[];
  /** 숙소가 없으면 null */
  home: LatLng | null;
  /** 경로 전체가 보이게 맞출 때의 여백 (위: 머리줄, 아래: 시트 + 로고) */
  padding: { top: number; bottom: number; left: number; right: number };
  /** 축척 막대의 아래 자리 (시트 위 10) */
  scaleBottom: number;
  /** TASK-015 §17: 떠 있는 판(위 버튼 줄·아래 시트)의 사각형 — 이름표가 피한다. 지도 화면 pt, 맨 위 0 */
  panels?: Rect[];
  onReady: () => void;
  onFail: () => void;
}) {
  const map = useRef<MapView>(null);
  const ready = useRef(false);
  const { width, height } = useWindowDimensions();
  const [region, setRegion] = useState<Region | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!ready.current) onFail();
    }, MAP_READY_LIMIT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const path = [...(home ? [home] : []), ...stops.map((stop) => ({ latitude: stop.lat, longitude: stop.lng })), ...(home ? [home] : [])];
  const signalReady = () => {
    if (ready.current) return;
    ready.current = true;
    onReady();
    map.current?.fitToCoordinates(path, { edgePadding: padding, animated: false });
  };

  let rules: PinOverlapResult | null = null;
  const mapPadding = { top: 0, left: 0, right: 0, bottom: padding.bottom - 40 > 0 ? padding.bottom - 40 : 0 };
  const size = visibleArea({ width, height }, mapPadding); // region은 mapPadding을 뺀 보이는 영역을 채운다 (TASK-015 §20 #4)
  if (region) {
    try {
      const screenPins: ScreenPin[] = stops.map((stop) => ({ id: `p${stop.seq}`, kind: 'later', ...project(region, size, { latitude: stop.lat, longitude: stop.lng }), size: layout.pinLater, seq: stop.seq }));
      if (home) screenPins.push({ id: 'home', kind: 'lodging', ...project(region, size, home), size: layout.homePin, seq: null });
      const named = stops.filter((stop) => stop.name);
      rules = resolvePinOverlap({
        pins: screenPins,
        screen: { width, height },
        labelWidth: 0,
        panels,
        labelMode: 'all',
        labelWidths: Object.fromEntries(named.map((stop) => [`p${stop.seq}`, labelWidthOf(stop.name as string)])),
      });
    } catch {
      rules = null; // 규칙 없이 지금처럼 (§6)
    }
  }
  const shown = new Map(rules ? rules.pins.map((pin) => [pin.id, pin]) : []);
  const drawn = (id: string) => !rules || shown.has(id);

  return (
    <>
      <MapView
        ref={map}
        testID="course-map"
        provider={PROVIDER_GOOGLE}
        customMapStyle={MAP_STYLE}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...(home ?? (stops[0] ? { latitude: stops[0].lat, longitude: stops[0].lng } : NO_CENTER)), latitudeDelta: layout.mapDelta, longitudeDelta: layout.mapDelta }}
        mapPadding={mapPadding}
        toolbarEnabled={false}
        onRegionChangeComplete={setRegion}
        onMapReady={signalReady}
        onMapLoaded={signalReady}
      >
        {path.length >= 2 ? (
          <>
            {/* 도식과 같은 실선 (점선은 Google iOS에서 안 그려질 수 있다, ADR-014 A1) */}
            <Polyline testID="course-route-casing" coordinates={path} strokeColor={color.surface} strokeWidth={tokens.map['route-casing']} lineCap="round" zIndex={1} />
            <Polyline testID="course-route" coordinates={path} strokeColor={color.brand} strokeWidth={tokens.map['route-width']} lineCap="round" zIndex={2} />
          </>
        ) : null}
        {home && drawn('home') ? <HomePin coordinate={home} badges={shown.get('home')?.badges} a11yLabel={shown.get('home')?.a11yLabel} /> : null}
        {stops.map((stop) => {
          if (!drawn(`p${stop.seq}`)) return null; // 다른 핀에 묶여 빠짐 (+N 배지가 대신 알린다)
          const rule = shown.get(`p${stop.seq}`);
          return (
            <NumberPin
              key={stop.seq}
              pin={{ seq: stop.seq, place_id: '', name: '', lat: stop.lat, lng: stop.lng, start: '', end: '', travel_min: 0, state: 'later' } as NowPin}
              rules={rule ? { badges: rule.badges, a11yLabel: rule.a11yLabel, showBubble: false } : undefined}
            />
          );
        })}
        {region && rules
          ? (rules.labels ?? []).map((placed) => {
              const stop = stops.find((candidate) => `p${candidate.seq}` === placed.pinId);
              if (!stop?.name) return null;
              const at = unproject(region, size, { x: placed.rect.x + placed.rect.width / 2, y: placed.rect.y + placed.rect.height / 2 });
              return <NameTag key={placed.pinId} coordinate={at} name={stop.name} width={placed.rect.width} />;
            })
          : null}
      </MapView>
      {region ? (
        <View pointerEvents="none" style={[styles.scaleSlot, { bottom: scaleBottom }]}>
          <MapScale region={region} width={width} />
        </View>
      ) : null}
    </>
  );
}

const NO_CENTER: LatLng = { latitude: 36.2, longitude: 138.25 }; // 첫 응답 전 숙소·핀이 없을 때만 (곧 카메라가 옮긴다)
const MAP_STYLE = mapStyleFile as unknown as MapViewProps['customMapStyle']; // 원본: docs/design/google-map-style.json (§13 E1)

export function MapAdapter({
  ref,
  center,
  home,
  pins,
  routeDone,
  routeRemaining,
  position,
  hollowPosition = false,
  stayingAtLodging = false,
  panels,
  onReady,
  onFail,
}: {
  ref?: Ref<MapAdapterHandle>;
  /** 숙소도 핀도 없으면 null (일본 가운데에서 시작) */
  center: LatLng | null;
  /** 숙소가 없으면 null: 집 표시를 그리지 않는다 (§29 ④) */
  home: LatLng | null;
  pins: NowPin[];
  routeDone: LatLng[];
  routeRemaining: LatLng[];
  position: LatLng | null;
  /** TASK-014 §4-13 reh-dot: 연습 중 "계획대로라면 여기" = 속이 빈 점 */
  hollowPosition?: boolean;
  /** TASK-015 §B6: 계획상 지금 있는 곳이 숙소 (출발 전·귀가 후) -> 숙소 마커가 "지금 핀" 모양, 내 위치 점은 그리지 않는다 */
  stayingAtLodging?: boolean;
  /** TASK-015 §17: 화면에 실제로 떠 있는 판(위 버튼 줄·연습 시계 판·아래 시트) 사각형. 지도 화면 pt, 맨 위 0. 이름표가 피한다 */
  panels?: Rect[];
  onReady: () => void;
  onFail: () => void;
}) {
  const map = useRef<MapView>(null);
  const { width: mapWidth, height: mapHeight } = useWindowDimensions();
  const [region, setRegion] = useState<Region | null>(null); // 지도가 알려 준 영역. 모르면(첫 보고 전) 겹침 규칙 없이 그린다
  const [metersPerPoint, setMetersPerPoint] = useState(1);
  const ready = useRef(false);

  useImperativeHandle(ref, () => ({
    fit: (coordinates, padding) => {
      map.current?.fitToCoordinates(coordinates, {
        edgePadding: { top: padding.top, bottom: padding.bottom, left: layout.mapEdge, right: layout.mapEdge },
        animated: false,
      });
    },
    showRegion: (region) => {
      map.current?.animateToRegion(region, 0);
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
    // 첫 영역 보고를 기다리지 않고 지금 보이는 영역을 읽는다 (겹침 규칙의 화면 좌표용)
    void Promise.resolve(map.current?.getMapBoundaries?.())
      .then((box) => {
        if (!box) return;
        const { northEast: ne, southWest: sw } = box;
        setRegion((now) => now ?? { latitude: (ne.latitude + sw.latitude) / 2, longitude: (ne.longitude + sw.longitude) / 2, latitudeDelta: ne.latitude - sw.latitude, longitudeDelta: ne.longitude - sw.longitude });
      })
      .catch(() => undefined);
  };

  // TASK-015 §B6 핀 겹침 규칙. 계산이 던지면 규칙 없이 지금처럼 그린다 (§6, §11 Q6)
  let rules: PinOverlapResult | null = null;
  const size = { width: mapWidth, height: mapHeight };
  if (region) {
    try {
      const at = (c: LatLng) => project(region, size, c);
      const screenPins: ScreenPin[] = pins.map((pin) => ({ id: `p${pin.seq}`, kind: pin.state, ...at({ latitude: pin.lat, longitude: pin.lng }), size: PIN_SIZE[pin.state] ?? layout.pinLater, seq: pin.seq }));
      if (home) screenPins.push({ id: 'home', kind: 'lodging', ...at(home), size: layout.homePin, seq: null });
      const me = position ? { ...at(position), size: hollowPosition ? layout.rehDot : layout.positionDot } : null;
      const nextName = pins.find((pin) => pin.state === 'next')?.name ?? '';
      rules = resolvePinOverlap({ pins: screenPins, screen: size, labelWidth: labelWidthOf(nextName), me, panels, stayingAtLodging });
    } catch {
      rules = null;
    }
  }
  const shownById = new Map(rules ? rules.pins.map((shown) => [shown.id, shown]) : []);
  const nextPin = pins.find((pin) => pin.state === 'next');
  const labelCoord = rules?.label && region ? unproject(region, size, { x: rules.label.rect.x + rules.label.rect.width / 2, y: rules.label.rect.y + rules.label.rect.height / 2 }) : null;

  return (
    <MapView
      ref={map}
      testID="map-view"
      provider={PROVIDER_GOOGLE}
      customMapStyle={MAP_STYLE}
      style={StyleSheet.absoluteFill}
      initialRegion={{ ...(center ?? NO_CENTER), latitudeDelta: layout.mapDelta, longitudeDelta: layout.mapDelta }}
      toolbarEnabled={false}
      onRegionChangeComplete={(next0) => {
        setRegion(next0);
        // 화면 가로 한 점이 몇 m인지: 경도 폭(도) -> m, 위도에 따라 줄어든다
        const next = metersPerPointOf(next0, mapWidth);
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
      {home && (!rules || shownById.has('home')) ? (
        <HomePin
          coordinate={home}
          shape={shownById.get('home')?.shape === 'now' ? 'now' : 'home'}
          badges={shownById.get('home')?.badges}
          a11yLabel={shownById.get('home')?.a11yLabel}
        />
      ) : null}
      {pins.map((pin) => {
        const shown = shownById.get(`p${pin.seq}`);
        if (rules && !shown) return null; // 다른 핀에 묶여 빠졌다 (+N 배지가 대신 알린다)
        return <NumberPin key={pin.seq} pin={pin} rules={shown ? { badges: shown.badges, a11yLabel: shown.a11yLabel, showBubble: false } : undefined} />;
      })}
      {rules && rules.label && labelCoord && nextPin ? <NameTag coordinate={labelCoord} name={nextPin.name} width={rules.label.rect.width} /> : null}
      {position && (!rules || rules.meDot) ? <MyPosition coordinate={position} hollow={hollowPosition} /> : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', minWidth: BADGE, height: BADGE, paddingHorizontal: 3, borderRadius: radius['r-full'], backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' },
  badgeHome: { backgroundColor: color.surface, borderWidth: layout.routeHomeStroke, borderColor: color.ink },
  tagText: { textAlign: 'center' },
  scaleSlot: { position: 'absolute', right: space['space-4'], alignItems: 'flex-end' },
  scale: { minWidth: layout.scaleWidth, height: layout.scaleHeight, alignItems: 'flex-start', gap: layout.scaleGap },
  scaleBar: { height: layout.scaleBarHeight, borderLeftWidth: layout.scaleLine, borderRightWidth: layout.scaleLine, borderBottomWidth: layout.scaleLine, borderColor: color['ink-strong'] },
  homeGlyph: { alignItems: 'center', justifyContent: 'center' },
  pickArea: {
    width: PICK_AREA_RADIUS * 2,
    height: PICK_AREA_RADIUS * 2,
    borderRadius: radius['r-full'],
    borderWidth: layout.emptyBorder,
    borderStyle: 'dashed',
    borderColor: color.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickFace: {
    width: PICK_FACE,
    height: PICK_FACE,
    borderRadius: radius['r-full'],
    backgroundColor: color.ink,
    borderWidth: PICK_BORDER,
    borderColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  // reh-dot: 속 흰색 + 고리 3 ink, 바깥 지름 20, 퍼지는 고리 없음
  rehDot: {
    width: layout.rehDot,
    height: layout.rehDot,
    borderRadius: radius['r-full'],
    backgroundColor: color.surface,
    borderWidth: layout.rehDotRing,
    borderColor: color['ink'],
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
