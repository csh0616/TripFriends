# Tripfriends

AI 여행친구. 구조와 규칙은 `CLAUDE.md`, 설계 문서는 `docs/`.

## CI (GitHub Actions, `.github/workflows/ci.yml`)
- CI가 도는 것: PR(→ main)과 main push마다 서버 테스트(기본·`slow`·`db`), 앱 타입 검사(`tsc`)와 Jest, 키 검사. PR에서는 바뀐 폴더에 맞는 작업만, main push는 전부.
- 맥에서 도는 것: `live`(실제 AI 호출, 키 필요), Maestro(iOS 시뮬레이터), 돌연변이 측정(mutmut·Stryker), 화면 점검.
- DB: 맥은 Supabase CLI, CI는 순수 Postgres 17 — 마이그레이션이 Supabase 전용 기능(auth 스키마·역할)을 쓰기 시작하면 CI를 CLI로 바꾼다.

## 서버 실행 (비밀 파일은 저장소 밖)
서버 비밀 파일은 `~/.config/tripfriends/server.env`에 둔다 (CLAUDE.md 규칙 1). 저장소 안에 `.env`를 두지 않는다.
- 서버 실행: `cd apps/server && uv run --env-file ~/.config/tripfriends/server.env fastapi dev api/main.py`
- 장소 팩 만들기: `cd apps/server && uv run --env-file ~/.config/tripfriends/server.env python -m places build osaka`

## 폰 확인 때 막히는 곳
클라우드 Supabase 쪽은 `supabase/README.md` "폰 확인 때 막히는 곳"에 있다.

| 증상 | 원인 | 해결 |
|---|---|---|
| `app.json`(권한 문구·플러그인)을 고쳤는데 빌드한 앱에 예전 설정이 남아 있음 (TASK-014 §18) | 예전에 만든 `apps/mobile/ios` 폴더가 남아 있으면 `expo run:ios`가 설정을 다시 읽지 않는다 | 설정을 바꾼 뒤 빌드는 **iOS 폴더를 새로 만든다**: `cd apps/mobile && npx expo prebuild --clean --platform ios` 뒤 `npx expo run:ios`. prebuild가 `apps/mobile/package.json` scripts를 바꾸면 `git checkout apps/mobile/package.json`으로 되돌린다 |
