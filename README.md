# Tripfriends

AI 여행친구. 구조와 규칙은 `CLAUDE.md`, 설계 문서는 `docs/`.

## CI (GitHub Actions, `.github/workflows/ci.yml`)
- CI가 도는 것: PR(→ main)과 main push마다 서버 테스트(기본·`slow`·`db`), 앱 타입 검사(`tsc`)와 Jest, 키 검사. PR에서는 바뀐 폴더에 맞는 작업만, main push는 전부.
- 맥에서 도는 것: `live`(실제 AI 호출, 키 필요), Maestro(iOS 시뮬레이터), 돌연변이 측정(mutmut·Stryker), 화면 점검.
- DB: 맥은 Supabase CLI, CI는 순수 Postgres 17 — 마이그레이션이 Supabase 전용 기능(auth 스키마·역할)을 쓰기 시작하면 CI를 CLI로 바꾼다.
