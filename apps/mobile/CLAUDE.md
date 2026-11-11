# apps/mobile 규칙

- Expo + React Native + TypeScript. 화면만 그린다. 판단·계산은 서버가 한다
- **비밀값 금지**: 키를 여기 두지 않는다. `EXPO_PUBLIC_` 변수는 앱에 그대로 들어간다. 허용: `EXPO_PUBLIC_API_URL`(서버 주소), `EXPO_PUBLIC_CHECK_API_URL`(점검 전용 서버 주소, 있으면 먼저 읽음), `EXPO_PUBLIC_SUPABASE_URL`·`EXPO_PUBLIC_SUPABASE_KEY`(Supabase 프로젝트 URL·공개 키, TASK-012), `EXPO_PUBLIC_CHECK_SUPABASE_URL`·`EXPO_PUBLIC_CHECK_SUPABASE_KEY`(점검용 로컬 Supabase, 있으면 먼저 읽음). 비밀 키(secret·service_role)는 절대 안 됨
- 서버 응답 타입은 `packages/api-types`에서만 가져온다. 손으로 타입을 만들지 않는다
- 폰(Expo Go)에서 서버에 붙을 때는 `localhost`가 아니라 컴퓨터의 내부 IP를 써야 한다 — 승현에게 안내
- 테스트: Jest(`jest-expo`) + React Native Testing Library. 속성 테스트는 fast-check
- 화면 가드레일 (SCREEN-001): SOS·입력창 위치 고정, 장소에는 확인 상태 필수, 조합 카드 4장 이하
