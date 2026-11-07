/// <reference types="jest" />
// 테스트 환경에는 네이티브 worklets 모듈이 없어서, 라이브러리가 제공하는 가짜 모듈로 바꾼다
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
// 라이브러리 가짜의 useSharedValue는 그릴 때마다 새 값을 만든다. 진짜처럼 같은 부품 안에서는 같은 값을 유지하게 감싼다
// (TASK-006 리뷰: 시트 위치(animatedPosition)를 바꾼 뒤 다시 그려도 떠 있는 줄이 그 값을 보게)
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/lib/module/mock');
  const { useRef } = require('react');
  return {
    ...mock,
    useSharedValue: (init: unknown) => {
      const kept = useRef(null);
      if (kept.current === null) kept.current = mock.useSharedValue(init);
      return kept.current;
    },
  };
});

// TASK-004: 아래 런타임 의존성은 frontend가 추가한다. 없어도 테스트가 돌도록 가짜 모듈로 고정한다 (virtual).
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('./test-support/async-storage-mock'),
  { virtual: true },
);
jest.mock('react-native-svg', () => require('./test-support/svg-mock'), { virtual: true });
jest.mock('@expo-google-fonts/noto-sans-kr', () => require('./test-support/google-font-mock'), { virtual: true });
jest.mock('@expo-google-fonts/dm-mono', () => require('./test-support/google-font-mock'), { virtual: true });
// 글꼴 로드 성공이 기본값. 실패는 §7 테스트에서 이 가짜 함수의 반환값을 바꾼다.
jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  useFonts: jest.fn(() => [true, null]),
  loadAsync: jest.fn(async () => undefined),
  isLoaded: jest.fn(() => true),
}));

// TASK-006 §B: 지도·시트·개발 빌드 패키지. 설치 전에도 테스트가 돌고, 설치 뒤에도 네이티브 대신 가짜를 쓴다 (virtual).
// 가짜 부품은 실제로 그려지는지 알려 주지 않는다. 지도·시트 모습은 Maestro·폰에서 확인한다.
jest.mock('react-native-maps', () => require('./test-support/maps-mock'), { virtual: true });
jest.mock('@gorhom/bottom-sheet', () => require('./test-support/bottom-sheet-mock'), { virtual: true });
jest.mock('expo-dev-client', () => ({}), { virtual: true });
