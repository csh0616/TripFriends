/// <reference types="jest" />
// 테스트 환경에는 네이티브 worklets 모듈이 없어서, 라이브러리가 제공하는 가짜 모듈로 바꾼다
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/lib/module/mock'));
