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

## 시드 계정과 가짜 로그인 공급자 점검 (TASK-012 §16 Q11)
- `seed.sql`은 `supabase db reset --local` 때 마이그레이션 뒤에 적용된다. **로컬 전용**이고 클라우드 프로젝트에는 적용하지 않는다.
- 시드 계정 `link-existing@example.test` ("이미 있는 계정"): 비밀번호는 `apps/mobile/src/lib/dev-login.ts`의 개발 전용 테스트 값과 같다. 여행은 넣지 않았다 (choose 흐름은 이 계정으로 로그인해 앱·API로 여행을 만든 뒤 점검).
- `link-new@example.test` ("새 계정")는 시드하지 않는다: 익명 사용자에게 이메일·비밀번호를 붙일 때 만들어진다 (같은 user_id). 로컬 설정 `enable_signup = true`, `enable_confirmations = false`라 바로 된다. 이미 만들어졌다면 다시 붙일 수 없으니 `supabase db reset --local`로 비운다.
- 점검: `supabase start` → `supabase db reset --local` → 서버(8010)를 로컬 주소로 켜고(위 "서버·테스트에 연결") 앱을 `EXPO_PUBLIC_DEV_LOGIN=new`(새 계정 길) 또는 `existing`(이미 있는 계정 길)로 연다 (`__DEV__`가 아니면 무시, TASK-012 §17). 끝나면 `supabase stop`.

## 폰 확인 때 막히는 곳 (클라우드 프로젝트, TASK-012 1단계 폰 확인에서 겪은 것)
값(키·비밀번호·연결 문자열)은 화면이나 채팅에 붙여 넣지 않는다.

| 증상 | 원인 | 해결 |
|---|---|---|
| 앱 익명 로그인이 안 되고, 개발 빌드 경고에 `anonymous_provider_disabled` | 프로젝트에서 익명 로그인이 꺼져 있음 | Supabase 화면 → Authentication → Sign In / Providers → **Allow anonymous sign-ins** 켜고 **Save** (켜기만 하고 Save를 안 누르면 그대로 꺼져 있다) |
| 서버를 켜면 `Address already in use` | 8000번에 예전 서버가 남아 있음 | `lsof -i :8000`으로 그 PID를 찾아 `kill <PID>` (이름으로 끄는 `pkill`은 쓰지 않는다) |
| 서버가 DB에 못 붙음 (503 `STORAGE_UNAVAILABLE`, 연결 문자열 오류) | `DATABASE_URL` 비밀번호에 `@`·`#`·`/` 같은 특수문자가 그대로 있거나, 화면 예시의 `[YOUR-PASSWORD]` 대괄호가 남아 있음 | 특수문자는 퍼센트 인코딩으로 바꾼다 (`@` → `%40`, `#` → `%23`, `/` → `%2F`). 대괄호 `[ ]`는 지우고 비밀번호만 남긴다 |
| `supabase` 명령이 로컬 DB를 건드리거나 "로컬이 안 켜져 있다"고 함 | Supabase CLI는 기본이 **로컬**이다 | 클라우드에는 `supabase link --project-ref <ref>`로 연결한 뒤 명령마다 **`--remote`**를 붙인다 (예: `supabase migration list --remote`, `supabase db push --remote`). project-ref는 프로젝트 URL `https://<ref>.supabase.co` 가운데의 **20글자** |

클라우드에 마이그레이션을 적용하는 순서 (저장소 맨 위에서):
1. `supabase login` — 브라우저로 로그인
2. `supabase link --project-ref <ref>` — 이 폴더를 클라우드 프로젝트에 연결 (DB 비밀번호를 물으면 화면에만 입력)
3. `supabase migration list --remote` — 클라우드에 적용된 것과 저장소 파일 비교
4. `supabase db push --remote --dry-run` — 적용할 파일만 미리 보기 (바꾸지 않음)
5. `supabase db push --remote` — 실제 적용

한 번 적용한 마이그레이션 파일은 고치지 않고, 바뀌는 것은 새 파일로 더한다.
