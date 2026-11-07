# ADR-014 · 지도 SDK: Google 지도로 통일 (react-native-maps, 개발 빌드)

| 항목 | 내용 |
|---|---|
| 상태 | **승인** — 결정권자 2026-11-07 |
| 관련 | SCREEN-001 §2(SC-04 지도 + 카드 시트) · ADR-013(앱 RN·Expo) · PORTFOLIO D-4 · TASK-006 |

## 1. 문제
여행 중 화면(SC-04)은 지도가 바탕이다. 첫 시장은 **일본**이고, 길 안내는 구글 지도 앱으로 넘긴다(SCREEN-001 §2). 앱은 Expo(RN)이고 지금까지 Expo Go로 폰에서 확인했다.

## 2. 선택지
| 안 | 장점 | 단점 |
|---|---|---|
| A. react-native-maps 기본 (iOS Apple 지도 / Android Google) | Expo Go에서 바로 됨, iOS 키 불필요 | 기기마다 지도가 달라 화면 확인이 두 배. 일본 지도 품질·장소 표기가 Google보다 약함 |
| **B. Google 지도로 통일 (react-native-maps `PROVIDER_GOOGLE`)** | 일본 지도 품질, 길 안내 앱(구글 지도)과 같은 지도, 두 기기 같은 모양 | **API 키 + 결제 계정 등록**, iOS에서 **Expo Go 불가 → 개발 빌드** |
| C. Mapbox | 스타일 자유 | 토큰·개발 빌드, 설정이 가장 복잡, 일본 장소 데이터 약함 |

## 3. 결정
**B.** 지도 부품은 `MapAdapter` 한 곳으로 감싸 SDK를 바꿀 수 있게 한다 (D-4 "어댑터로 교체 가능").

- 비용: Google 문서 기준 모바일 SDK(Maps SDK for iOS·Android)의 지도 표시는 **무제한 무료**, 다만 결제 계정 연결은 필요 (2026-11-07 확인, 가설: 바뀔 수 있음). 장소 검색·경로 API는 쓰지 않는다
- 키 관리: 앱 키는 앱 안에 들어가는 **공개 키**라 서버 비밀 키와 다르지만, 저장소에는 올리지 않는다. `apps/mobile/.env.local`의 `GOOGLE_MAPS_IOS_API_KEY`(EXPO_PUBLIC_ 아님)를 `app.config`가 빌드 때 읽는다. Google Cloud에서 **iOS 번들 ID로 사용 제한**
- 빌드: `expo-dev-client` 개발 빌드. 결정권자 폰에는 Xcode + 무료 Apple ID로 설치(7일마다 다시 설치). 시뮬레이터는 같은 빌드로 Maestro 자동 확인 (TASK-006)

## 4. 결과
- 폰 확인 방법이 Expo Go → **개발 빌드 앱**으로 바뀐다 (한 번 설치 후 `pnpm --filter mobile start`로 연결)
- Android는 키·빌드를 R2 전에 같은 방식으로 추가

## 포트폴리오 포인트
- "편한 길(A, 키 없음)" 대신 첫 시장(일본)과 길 안내 연결을 기준으로 B를 고르고, 비용(모바일 지도 무료)과 키 노출(번들 ID 제한, 저장소 제외)을 함께 설계
- 예상 면접 질문: "지도 SDK를 왜 Google로?" → "일본 지도 품질과, 길 안내를 넘기는 구글 지도 앱과 같은 지도를 쓰려고. Expo Go를 못 쓰는 비용은 개발 빌드와 시뮬레이터 자동 확인으로 메웠다"
