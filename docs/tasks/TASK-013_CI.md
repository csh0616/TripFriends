# TASK-013 · CI: PR마다 테스트 자동 실행 (GitHub Actions)

| 항목 | 내용 |
|---|---|
| 발행 | PM · 2026-11-13 |
| 상태 | **v1.5** — §11 첫 CI 실행·tsc 답 · §10 남은 값 3개 · §9 test-writer 질문 답 · A6 바뀐 파일만·B7 운영 방침 (결정권자 11-13) |
| 관련 | TEAM-001(에이전트 운영) · TASK-012 §20(테스트 환경이 실제와 달라 놓친 일) · AC 숫자를 지금은 에이전트 보고로만 확인 |
| 브랜치 | `chore/task-013-ci` |
| 다음 | TASK-014 실제 위치 + "이 날 미리 걸어 보기" (그때부터 모든 PR에 CI) |

> 새 기능 없음. PR을 올리면 GitHub가 **지금 있는 테스트 전체**(Maestro 제외)를 돌려 ✅/❌를 붙인다. 결정권자 11-13: "지금은 머지하고 13에서 CI, 14부터 모든 PR 대상"

## 0. 순서와 팀
| 순서 | 에이전트 | 할 일 |
|---|---|---|
| 1 | `test-writer` | §A 표를 "CI에서 무엇을 어떻게 돌리나" 목록으로 확정 + 질문 → 승인 대기 (테스트 코드는 거의 없음. §B5 검사만) |
| 2 | `backend` | `.github/workflows/ci.yml` 작성 → PR을 올려 **실제 GitHub에서** 초록 확인 |
| 3 | `reviewer` | 일부러 깨뜨린 커밋으로 ❌가 나는지 확인(§C3) 뒤 되돌림 |

## A. CI가 돌리는 것 (리눅스 `ubuntu-latest`)
| 작업(job) | 내용 | 비고 |
|---|---|---|
| A1 server | `uv sync --frozen` → `uv run pytest` (기본: `live`·`slow` 제외) | Python은 `pyproject.toml`의 `>=3.12`에 맞게 고정 |
| A2 server-slow | `uv run pytest -m slow` | 시간 재는 테스트. CI 기계가 느려 흔들리면 **보고**(기준을 몰래 늘리지 않기) |
| A3 server-db | **Supabase CLI**로 로컬 DB(`supabase db start`)를 띄우고 마이그레이션 적용 → `TEST_DATABASE_URL=… uv run pytest -m db` | 맥 로컬 확인과 같은 방식(`supabase/README.md`). 순수 Postgres로 되면 그쪽이 빠르니 test-writer가 비교해 제안 |
| A4 mobile | `pnpm install --frozen-lockfile` → `tsc`(타입 0) → `jest` → `expo lint`가 이미 통과하면 포함 | Node·pnpm 버전은 저장소 설정(`package.json` `packageManager` 등)에서 읽기 |
| A5 secret-scan | 저장소에 키처럼 보이는 값 0 (AC-4를 사람 대신 매번) | 기존 검사 코드가 있으면 재사용 |
| A6 바뀐 파일만 (결정권자 11-13) | **PR에서는** 바뀐 폴더에 맞는 작업만: 서버·slow·DB ← `apps/server/**`·`supabase/**`·`packages/**`·`testdata/**` / 앱 ← `apps/mobile/**`·`packages/**`·`package.json`·`pnpm-lock.yaml`·`.npmrc` / 키 검사 ← 항상. **워크플로 파일 자체가 바뀌면 전부.** `docs/`만 바뀐 PR은 키 검사만. **main push는 항상 전부**(안전망) | 건너뛴 작업은 PR에 "건너뜀"으로 보이게(❌·✅와 구분). 표와 워크플로가 같은지 B5 검사에 포함 |

- **돌리지 않는 것**: `live`(실제 Jev 호출, 키 필요) · Maestro(iOS 시뮬레이터 = macOS 기계, 리눅스의 약 10배 비용) · 돌연변이 측정(느림). 이것들은 지금처럼 맥에서
- 언제: PR(→ main)마다 + main에 push될 때. 같은 PR에 새 커밋이 오면 이전 실행 취소(`concurrency`)
- 캐시: uv·pnpm 캐시를 써서 시간 줄이기. 한 번 실행 목표 **10분 안**(가설)

## B. 규칙
| # | 규칙 |
|---|---|
| B1 | **비밀값 0**: GitHub Secrets를 만들지 않는다. 테스트는 가짜 장소·로그인 공급자로 돈다. 키가 필요해 보이는 테스트가 있으면 CI에서 빼지 말고 **보고** |
| B2 | 클라우드 Supabase·Google·Serper 호출 0 (CI 로그에서 확인) |
| B3 | 액션은 공식(`actions/*`)·널리 쓰는 것(`astral-sh/setup-uv`, `pnpm/action-setup`, `supabase/setup-cli`)만, **버전 고정**. 권한은 `permissions: contents: read` |
| B4 | "나온 지 얼마 안 된 패키지" 안전장치(`.npmrc`)를 CI에서도 그대로. 예외 설정 금지 |
| B5 | 작은 검사 테스트 하나: 워크플로 파일에 `secrets.`·`pull_request_target`·`write` 권한이 없는지 + A6 폴더 표와 워크플로의 경로 목록이 같은지 |
| B6 | 머지 규칙(사람): **❌면 머지하지 않는다.** GitHub Free 개인 계정의 비공개 저장소는 브랜치 보호(통과해야 머지)를 못 써서 강제는 못 함 (공식 문서 11-13 확인) |
| B7 | **운영 방침** (결정권자 11-13): CI를 **적극적으로 쓰고, 모자라면 결제**(결제 수단 등록 때 예산 상한, 알림 90·100%). 한도는 매달 1일 09:00(KST)에 초기화, 리눅스 분당 $0.006·무료 월 $12어치(공식 문서 11-13). 필요하면 저장소 공개(무제한)도 선택지 — 공개 전 PM이 git 기록 전체의 키·민감 문서 점검. macOS 기계는 분당 $0.062라 Maestro를 CI에 넣을 땐 다시 결정 |

## C. 완료 기준
| ID | Then |
|---|---|
| AC-1 | 이 PR에서 A1~A5가 GitHub에서 모두 ✅ |
| AC-2 | 숫자가 맥 로컬과 같다(서버·DB·slow·앱 통과 수) — 다르면 이유 보고 |
| AC-3 | reviewer가 일부러 테스트 하나를 깨뜨린 커밋을 올려 ❌ 확인 → 되돌려 ✅ |
| AC-4 | 한 번 실행 시간(전부 / 앱만 / 서버만 / docs만)과 이번 달 예상 사용 분을 PR에 적음 (무료 월 $12 ≈ 리눅스 2,000분) |
| AC-5 | `supabase/README.md`·루트 안내에 "CI가 무엇을 돌리고, 무엇은 맥에서 돌리나" 3줄 |

## 9. test-writer 질문 답 (11-13, 커밋 `db2cc93` 승인)
| Q | 답 |
|---|---|
| 1 A3 DB | **순수 Postgres 17 승인** (Supabase 전용 기능을 안 쓰고, 서명 키를 CI에서 만들 필요가 없고, 빠름). `supabase/README.md`에 "맥은 Supabase CLI, CI는 순수 Postgres 17 — 마이그레이션이 Supabase 전용 기능(auth 스키마·역할)을 쓰기 시작하면 CI를 CLI로 바꾼다" 한 줄 |
| 2 docs를 읽는 테스트 | **넣는다**: 테스트가 실제로 읽는 `docs/` 경로(장소 시드·디자인 이미지 등)를 각 목록에 정확히 추가. docs만 바뀐 PR이라도 그 파일이면 해당 테스트가 돈다 |
| 3 앱이 읽는 다른 폴더 파일 | **넣는다**: `testdata/particles.json`, `apps/server/trip/link.py`를 앱 목록에. **규칙**: 테스트가 자기 폴더 밖 파일을 읽으면 그 경로가 목록에 있어야 한다 — B5 검사로 고정(테스트 코드에서 읽는 경로를 찾아 목록과 비교, 어려우면 알려진 목록 대조) |
| 4 Node·pnpm·안전장치 | 맥 값으로 고정: 루트 `package.json`에 `"packageManager": "pnpm@12.15.0"`, `.node-version`에 `26.10.0`. 안전장치는 저장소에 없음 → pnpm 기본값이거나 맥의 전역 설정. `pnpm config get minimumReleaseAge`로 지금 값을 확인해 **`pnpm-workspace.yaml`에 명시**(맥·CI가 같은 규칙). 값은 보고 |
| 5 Python | **맥과 같은 버전으로 고정**: `apps/server/.python-version`(맥 `uv run python --version` 값). `requires-python >=3.12`는 그대로 |
| 6 lint | **CI에서 뺀다 확정.** lint 설정·21개 정리는 백로그(작은 TASK). 그리고 **자동으로 패키지를 설치하는 명령은 실행 전에 묻는다**(이번 `expo lint`처럼) — 되돌린 것 확인함 |
| 7 키 검사 | **pytest 테스트로** (`apps/server/tests/test_secret_scan.py`) — 규칙 6(실험 스크립트)에 해당 안 함. `git ls-files` 전체를 본다. 패턴: Google `AIza[0-9A-Za-z_-]{35}`, `sk-`로 시작하는 긴 키, Supabase `sb_secret_`, `service_role` JWT, 긴 `eyJ…` JWT, `-----BEGIN … PRIVATE KEY-----`, 비밀번호가 든 `postgres(ql)://user:pass@`(로컬 `postgres:postgres@127.0.0.1`·`localhost` 테스트 주소는 허용). `.env.example`의 빈 값·자리표시는 허용. 찾으면 **값은 출력하지 않고 파일:줄만**. A5 작업은 이 테스트 파일만 돌림 |
| 8 B5 계약 | **승인**: `changes` 작업 + `SERVER_PATHS`·`MOBILE_PATHS`·`ALL_PATHS` |
- 시간 기준 테스트(기본 5·slow 1·속성 9): **그대로 돌린다.** CI에서 흔들리면 실제 측정값과 함께 보고 → PM이 기준을 정함 (몰래 늘리지 않기, §B)

## 10. 남은 값 3개 답 (11-13, 커밋 `ac76107` 승인)
| Q | 답 |
|---|---|
| 1 `minimumReleaseAge` | **1440 (분 = 1일)** 을 `pnpm-workspace.yaml`에 명시. pnpm 11부터 기본값이 1일(공식 11.0 릴리스 노트) — TASK-012 때 갓 나온 `expo-secure-store` 58.0.3이 막힌 것과 맞음. 테스트는 "양의 정수"가 아니라 **1440과 같음**으로 |
| 2 `.node-version`·`pnpm-workspace.yaml`을 앱 목록에 | **승인** (§9 Q3 규칙 그대로). A6 표의 앱 목록에 두 줄 더한 것으로 본다. 표에 없는 경로가 생기는 건 PM 문서보다 실제 읽는 파일이 우선 |
| 3 "긴 키" 기준 | **승인**: `sk-` 뒤 20자 이상 · JWT 세 조각 각 10자 이상 · `sb_secret_` 뒤 1자 이상 |
- 다음: backend가 `ci.yml`·`.python-version`(3.15.2)·`.node-version`(26.10.0)·`packageManager`(pnpm@12.15.0)·`minimumReleaseAge: 1440` → PR을 올려 GitHub에서 확인

## 11. 첫 CI 실행 (11-13, PR #16) · 앱 tsc 실패 답
| 작업 | 결과 | 숫자(맥과 비교) | 시간 |
|---|---|---|---|
| server | ✅ | 3541 통과 · 76 건너뜀 (같음) | 약 4분 20초 (테스트 2분 32초) |
| server-slow | ✅ | 22 (같음) | 약 2분 |
| server-db | ✅ | 74 · 1 건너뜀 (같음), 순수 Postgres 17에 마이그레이션 오류 0 | 약 2분 10초 |
| secret-scan | ✅ | 27 (같음) | 약 1분 30초 |
| mobile | ❌ | `tsc`에서 멈춤 | 30초 |
- **CI가 첫 실행에서 찾은 것**: 테스트용 가짜 모듈 4개(`module.exports`)의 타입을 맥에서는 **git에 없는 `expo-env.d.ts`**(Expo 실행 때 저절로 생김)가 채워 주고 있었다 → "맥 tsc 0"은 숨은 파일 덕분. 맥에서 파일을 치워 같은 오류 4개 재현함. TASK-012 §20과 같은 종류(환경 차이)
- **답: 2안(앱에서 근본 해결, frontend)**. 저장소를 새로 받은 어디서나 같은 결과가 나와야 한다. 방법은 frontend가 더 작은 쪽으로: ① 가짜 모듈 4개를 ESM `export`로 바꿔 타입 문제를 없애거나(jest 동작이 그대로인지 테스트로 확인) ② git에 올라가는 작은 타입 파일 하나. `expo-env.d.ts`는 계속 git 밖, `@types/node` 설치 없음. CI에서 파일을 만들어 숨기는 1안은 쓰지 않는다
- 시간 기준 테스트 흔들림 0 · pnpm이 lockfile에 더한 자기 항목(`9bc31f2`)은 `--frozen-lockfile` 통과 · 외부 액션은 커밋 SHA로 고정(승인)

## 8. 하지 말 것
- GitHub Secrets 만들기, 키 값 출력·`.env` 읽기, 클라우드 Supabase 사용
- 테스트를 CI에서 통과시키려고 건너뛰기·기준 늘리기 (보고 먼저)
- `docs/` 수정, 저장소 밖 검색, 이름으로 프로세스 끄기, main에 바로 커밋

## 포트폴리오 포인트
- 에이전트 보고에만 기대던 테스트 숫자를 **PR마다 기계가 다시 확인**하게 바꿈. 비밀값 없이 도는 테스트 구조(가짜 공급자) 덕분에 CI에 키를 하나도 두지 않음
- 비용을 보고 범위를 정함: 리눅스에서 단위·DB 테스트, iOS 화면 흐름은 맥에서

| 예상 면접 질문 | 답 |
|---|---|
| "CI가 느려지거나 비용이 늘면요?" | PR에서는 바뀐 폴더에 맞는 작업만 돌리고(main은 항상 전부), 캐시와 이전 실행 취소를 썼습니다. 실행 시간과 월 사용량을 재서 무료 한도 안에 있는지 확인했습니다 |
| "CI에 비밀값은 어떻게 관리했나요?" | 하나도 두지 않았습니다. 외부 API는 가짜 공급자로 테스트하게 처음부터 설계해서, CI는 키 없이 돕니다. 실제 API를 부르는 테스트는 `live`로 표시해 따로 돌립니다 |
| "통과 못 한 PR이 머지되는 건 어떻게 막나요?" | 무료 요금제 비공개 저장소라 브랜치 보호를 못 써서, ❌면 머지하지 않는 팀 규칙으로 막았습니다. 공개 전환이나 유료 전환 때 강제 규칙으로 바꿉니다 |
