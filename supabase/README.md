# supabase/ — 저장소 스키마와 로컬 점검용 Supabase (TASK-012)

- `migrations/` — DB 표 (DATA-001 R1 + decision_logs + 계획 그래프 체크포인트). 파일 이름 순서대로 적용된다. 실제 프로젝트에는 승현이 정한 방법으로 적용한다.
- `config.toml` — **로컬 점검용** 설정. 필요한 것만 켠다 (DB·로그인·API). 익명 로그인 켬, 로그인 토큰은 비대칭 키(ES256)로 서명 (`signing_keys_path`). Studio·Realtime·Storage·Edge·Analytics·메일함은 끈다.
- `signing_keys.json` — 로컬 로그인 토큰 서명 키(비공개). **git에 올리지 않는다** (`.gitignore`). 아래 1번으로 만든다.

## 로컬에서 쓰는 법 (Docker가 켜져 있어야 한다. OrbStack 가능)
1. 서명 키 만들기 (처음 한 번): `echo '[]' > supabase/signing_keys.json && supabase gen signing-key --algorithm ES256 --append`
2. 켜기: `supabase start` (처음엔 이미지를 받느라 몇 분)
3. 주소·키 보기: `supabase status -o env` — 이 값은 로컬 전용이다. 서버 로컬 주소: DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, API `http://127.0.0.1:54321`
4. 표를 처음부터 다시 만들기: `supabase db reset --local`
5. 끄기: `supabase stop`

## 서버·테스트에 연결
- DB 테스트: `cd apps/server && TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres uv run pytest -m db`
- 점검 서버(8010): `DATABASE_URL`에 위 DB 주소, `SUPABASE_URL=http://127.0.0.1:54321`, `PLACES_PROVIDER=fake`로 켠다. 앱은 `EXPO_PUBLIC_CHECK_SUPABASE_URL=http://127.0.0.1:54321`과 `EXPO_PUBLIC_CHECK_SUPABASE_KEY`(= `supabase status -o env`의 `PUBLISHABLE_KEY`)를 쓴다.
- 결정권자의 클라우드 프로젝트는 테스트·점검에 쓰지 않는다 (TASK-012 §8).
