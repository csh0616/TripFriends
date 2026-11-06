// react-native-maps 가짜 (TASK-006). 지도·핀·선을 View로 남기고 카메라 호출을 기록한다.
// 지도가 실제로 그려지는지, 핀이 어디에 보이는지는 이 가짜로 알 수 없다 (svg-mock이 중첩 Svg를 못 잡은 것과 같다). Maestro·폰 몫.
import { createElement, forwardRef, useEffect, useImperativeHandle } from 'react';
import { View } from 'react-native';

type Props = Record<string, any>;

export const mapControl = {
  failRender: false, // true면 지도 부품을 그릴 때 던진다 (TASK-006 §7 지도 로드 실패)
  fits: [] as { coordinates: { latitude: number; longitude: number }[]; options?: { edgePadding?: { bottom?: number } } }[],
  moves: [] as { latitude: number; longitude: number }[], // animateToRegion·animateCamera의 가운데
  reset() {
    this.failRender = false;
    this.fits = [];
    this.moves = [];
  },
};

const MapView = forwardRef<unknown, Props>(function MapView(props, ref) {
  if (mapControl.failRender) throw new Error('지도 부품을 불러오지 못함');
  useImperativeHandle(ref, () => ({
    fitToCoordinates: (coordinates: never, options: never) => {
      mapControl.fits.push({ coordinates, options });
    },
    animateToRegion: (region: { latitude: number; longitude: number }) => {
      mapControl.moves.push({ latitude: region.latitude, longitude: region.longitude });
    },
    animateCamera: (camera: { center: { latitude: number; longitude: number } }) => {
      mapControl.moves.push(camera.center);
    },
  }));
  useEffect(() => {
    props.onMapReady?.();
    props.onMapLoaded?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createElement(View, { ...props, testID: props.testID ?? 'map-view', mapElement: 'MapView' } as object);
});

const part = (mapElement: string) => (props: Props) => createElement(View, { ...props, mapElement } as object);

module.exports = {
  __esModule: true,
  mapControl,
  default: MapView,
  PROVIDER_GOOGLE: 'google',
  PROVIDER_DEFAULT: undefined,
  Marker: part('Marker'),
  Polyline: part('Polyline'),
  Circle: part('Circle'),
  Callout: part('Callout'),
};
