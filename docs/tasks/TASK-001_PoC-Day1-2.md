# TASK-001 · 서버 뼈대 + 카드 카탈로그 + 판단기(Decider) + 화면 조합 함수

| 항목 | 내용 |
|---|---|
| 발행 | PM · 2026-10-26 / v2 2026-11-01 (ADR-013) / **v3 2026-11-03** (Jev 측정 완료·SCREEN-001·GRAPH-001 반영) |
| 담당 | Claude Code. **코드 세션과 테스트 세션을 나눈다** (TEAM-001 §4-1) |
| 승인 | 결정권자 (승현) |
| 관련 | ADR-011 · ADR-013 · GRAPH-001 §1·§6 · SCREEN-001 §3~§5 · SRS-001 FR-10a·10b · TEAM-001 §4 |
| 브랜치 | `feat/server-skeleton` → PR |
| 다음 작업 | TASK-002: G1 계획 대화 그래프 (R1 규칙 노드) |

## 0. 배경 (에이전트가 먼저 읽을 것)
- 이 앱은 **AI 여행친구**다. 계획은 같이 고르고, 여행 중에는 지도 위 카드 시트로 지금 필요한 것을 보여 준다.
- 판단은 역할을 나눈다: **규칙**(분명한 상황, 안전), **Jev**(고르기형 판단, 측정으로 채택된 자리만), **엔진**(코스 계산·사실 값), **LLM**(말투만). 근거: ADR-011
- Jev는 글을 만들지 않고 `choice`·`score`·`noul`로 답하며 확률을 준다. **측정으로 확인된 사실** (POC-001 §5~8):
  - `choice` 응답: `{"type":"choice","choice":"<키>","confidence":0~1,"probabilities":{...}}`
  - `score`의 `criteria`는 **순서 있는 척도 배열**이다 (평가 항목 목록이 아님). 응답 `score`는 척도 위치의 기댓값
  - 지연 p50 약 450~580ms, p95 약 630~730ms. 호출당 약 $0.00002~0.0001
- 구조 (ADR-013): 앱(`apps/mobile`, RN·TS) + 서버(`apps/server`, Python FastAPI + LangGraph). 앱 타입은 서버 OpenAPI에서 생성(`packages/api-types`)
- 저장소 현재 상태: pnpm 모노레포. `apps/mobile`(Expo 기본), `apps/web`(**건드리지 않음**), `packages/` 비어 있음
- 환경: macOS, Python은 **uv**. 사용자는 터미널 초보 → **실행할 명령은 한 줄씩 무엇을 하는지 설명**

## 1. 목표
1. `apps/server` 뼈대: `api`, `catalog`, `deciders`, `engine` 모듈
2. 카드 카탈로그(SCREEN-001 §3)를 pydantic으로
3. `Decider` 인터페이스 + `RuleDecider` + `JevDecider` (시간 제한·확신 기준·대체 포함)
4. **`compose_screen()`** 순수 함수 (GRAPH-001 §6) — **TDD로**
5. OpenAPI → TS 타입 생성, 앱이 `/health`를 불러 카드 개수 표시

## 2. 범위
### 만들 것
| 위치 | 내용 |
|---|---|
| `apps/server` | uv 프로젝트. FastAPI, pydantic, httpx, pytest, hypothesis |
| `catalog` | 카드 **23종**: P-01~P-07, T-01~T-14, X-01~X-02 (SCREEN-001 §3). 각 카드: ID, 이름, 설명(Jev 보기용 "이 카드가 보여 주는 것" 한 줄), 장소 포함 여부(확인 상태 필수 표시 대상), props 스키마. **props는 T-01·T-02·T-04·T-09만 실제 정의**, 나머지는 빈 모델 + `TODO` |
| `deciders` | ① `Decider` Protocol: `decide(question, options, context) -> Decision` ② `Decision`: `pick`, `confidence`, `source`(`rule`/`jev`/`fallback`), `latency_ms`, `cost_usd`, `reason` ③ `RuleDecider` ④ `JevDecider`: httpx, **시간 제한 0.8초**, **확신 0.6 미만이면 `pick=None`(되묻기)**, 오류·시간 초과면 `source=fallback`으로 주입된 대체 Decider 결과 반환. Jev 요청·응답 타입은 모듈 밖으로 내보내지 않음 |
| `engine/compose.py` | `compose_screen(snapshot) -> Screen`. 입력 `Snapshot`(시각, 오프라인, 안전 플래그, 지금·다음 일정, 고정 일정, 열린 사건, 걸은 km, 이번 끼니 먹음, 2시간 강수 확률, 실외 일정 남음, 남은 일정 수, 대화가 고른 카드). 출력 `Screen`(메인 카드, 보조 카드 ≤3, 제안 칩 0~1, 이동 상태 `on_track`/`delayed`/`free`, 바뀐 이유). 규칙: **GRAPH-001 §6의 순서**로 SCREEN-001 §4-1 우선순위 표, §4-2a 강한·약한 신호, §5 짝 표를 적용. 깜빡임 규칙(30초·3분)은 이번엔 `TODO` |
| `api` | `GET /health` → `{ok, cards: 23}`. `GET /catalog`. `POST /debug/compose` (Snapshot → Screen, 개발 환경에서만 열림) |
| `packages/api-types` | `openapi-typescript`로 생성. `package.json` 스크립트 |
| `apps/mobile` | Jest(`jest-expo`) + React Native Testing Library 설정. 첫 화면에 서버 `/health` 결과 "카드 23개 로드됨". 타입은 `packages/api-types`. 주소 `EXPO_PUBLIC_API_URL` (폰에서는 컴퓨터 내부 IP 필요하다는 안내) |
| `apps/server/.env.example` | `AI_GATEWAY_API_KEY=` |

### 만들지 않을 것
- LangGraph 그래프 (TASK-002부터), Supabase 연결, 로그인, 지도, 카드 화면 디자인
- 측정 스크립트 (측정은 끝났다. 저장소에 실험 코드를 남기지 않는다)

### 건드리면 안 되는 것
- `apps/web` 전체, `apps/mobile` 템플릿 구조 (첫 화면 한 줄 + API 호출만)

## 3. TDD 진행 순서 (TEAM-001 §4-1)
1. **테스트 세션**이 §4의 완료 기준과 SCREEN-001 표에서 테스트를 먼저 쓴다 (`compose_screen` 최소 15개 + Hypothesis 속성 2개, `JevDecider`는 가짜 HTTP로)
2. 테스트 세션이 **한국어 요약표**(테스트 이름 | 상황 | 기대 결과)를 PR 초안에 올린다 → **결정권자가 읽고 승인** (핵심 테스트는 승인 전 진행 금지, §4-2)
3. **코드 세션**이 테스트를 통과시키는 코드를 쓴다. 테스트 파일은 고치지 않는다 (고쳐야 하면 이유를 적고 결정권자 확인)
4. `mutmut`로 `engine/compose.py` 돌연변이 점수 측정, PR에 기록 (목표 80%, M-25)

## 4. 완료 기준 (Given / When / Then)
| ID | Given | When | Then |
|---|---|---|---|
| AC-1 | `apps/server` | `uv run pytest` | 모두 통과 (실제 Jev 호출 테스트는 `-m live`로 분리, 기본 실행에서 제외) |
| AC-2 | 서버 실행 | `GET /health` | `{ "ok": true, "cards": 23 }` |
| AC-3 | 서버 실행, Expo Go | 앱 첫 화면 | "카드 23개 로드됨" (서버 값) |
| AC-4 | 서버 실행 | 타입 생성 | `packages/api-types`에 응답 타입 생성, 앱 타입 오류 없음 |
| AC-5 | `catalog` | 단위 테스트 | 23종, ID 중복 없음, 장소 포함 카드 목록이 SCREEN-001과 같음, 정의된 4종 props가 예시를 통과 |
| AC-6 | `JevDecider`, 가짜 응답 확신 0.55 | `decide` | `pick=None`, `source=jev` (되묻기) |
| AC-7 | `JevDecider`, 가짜 응답 1.2초 지연 | `decide` | 0.8초 근처에서 끊고 `source=fallback`, 대체 Decider 결과 |
| AC-8 | `JevDecider`, 키 없음 | 생성 | "AI_GATEWAY_API_KEY가 없습니다" 오류 |
| AC-9 | `deciders` | 공개 API | `Decider`, `Decision`, `RuleDecider`, `JevDecider`만. Jev 전용 타입 비공개 |
| AC-10 | 고정 일정 출발까지 12분 + 늦어짐 사건 열림 | `compose_screen` | 메인 T-07 (§4-1 순위 2가 3보다 먼저) |
| AC-11 | 12:10, 점심 안 먹음, 다음 일정까지 80분 | `compose_screen` | 메인 T-10 (강한 신호) |
| AC-12 | 14:20, 9km, 여유 50분, 사건 없음 | `compose_screen` | 메인 T-01, 제안 칩 "쉴 곳" (약한 신호) |
| AC-13 | 남은 일정 없음, 16:00 / 21:00 | `compose_screen` | 16:00은 T-01 + 칩, 21:00은 메인 T-08 |
| AC-14 | 안전 플래그 켜짐 (다른 조건 무엇이든) | `compose_screen` | 메인 X-01 |
| AC-15 | 대화가 T-09를 고름 + 이동 중(순위 5) + 강한 신호(점심 안 먹음) | `compose_screen` | 메인 T-09 (사용자의 말이 순위 3~8·신호보다 우선. 안전·오프라인·고정 일정 임박보다는 아래, GRAPH-001 §6) |
| AC-16 | 임의의 Snapshot (Hypothesis) | `compose_screen` | 메인 1장, 보조 ≤3, 칩 ≤1, 같은 카드 중복 없음, 결과 카드는 모두 catalog에 있음 |
| AC-17 | 임의의 Snapshot (Hypothesis) | 같은 입력 두 번 | 같은 결과 (순수 함수) |
| AC-18 | 커밋 전체 | 키 문자열 검색 | 실제 키 0건, `.env.example`만 커밋 |
| AC-19 | `-m live`, 키 있음 | Jev A 질문 1회 ("근처 라멘집 지금 열린 곳") | `pick=request`, 지연·비용 기록 (실제 연결 확인용, 1회만) |
| AC-20 | `apps/mobile`, Jest(`jest-expo`) + RNTL, `/health` 가짜 응답 | `pnpm --filter mobile test` | "카드 23개 로드됨" 표시, 서버 오류면 "서버에 연결할 수 없어요" 표시 (테스트 2개) |

## 5. 비밀값 규칙 (중요)
- 키는 **`apps/server/.env`에만**. **`apps/mobile`에는 절대 두지 않는다** (`EXPO_PUBLIC_`은 앱에 그대로 들어감)
- `.gitignore`: `.env`, `.env.*` 막고 `!.env.example` 추가. `.venv/`, `__pycache__/`, `.pytest_cache/`, `.hypothesis/`, `mutants/` 추가
- **키 옮기기**: 지금 키는 `apps/web/.env.local`에 있다. `apps/server/.env`로 옮기는 방법을 안내하고, 키 값은 화면에 출력하지 않는다

## 6. 진행 방식
- 단계마다 짧게 보고: 무엇을 했는지, 사용자가 실행할 명령(한 줄씩 설명), 확인 방법
- 막히면 에러 원문, 가설, 확인한 것을 남긴다 (학습 자료)
- 커밋: `feat:` `fix:` `chore:` `docs:` `test:` + 한국어
- PR 설명: 무엇을, 왜, AC-1~20 결과, 돌연변이 점수, 테스트 요약표 링크, 막혔던 것

## 7. PM 검토 항목
- 테스트가 코드보다 먼저 커밋됐는지, 결정권자 승인 기록이 있는지
- `compose_screen`이 SCREEN-001 표와 1:1로 대응하는지 (표에 없는 규칙을 만들지 않았는지)
- `deciders`가 Jev에 묶이지 않았는지 (AC-9), 실험 코드가 저장소에 없는지
- `apps/web`을 건드리지 않았는지

## 8. 학습 카드 (결정권자용)
1. **지도**: 서버 안에서 `compose_screen`은 "화면 규칙의 단 한 곳"이다. 규칙이든 Jev든 결과는 결국 이 함수를 거친다
2. **핵심 개념 3개**
   - 순수 함수와 TDD — 같은 입력이면 같은 출력. 그래서 표의 한 줄이 테스트 한 개가 된다
   - 속성 기반 테스트 — "어떤 입력이 와도 카드 4장 이하" 같은 성질을 무작위 입력 수백 개로 확인
   - 인터페이스(Decider) — Jev를 바꿔 끼워도 나머지 코드는 그대로
3. **직접 해보기 (10분)**: `POST /debug/compose`에 AC-11 상황을 넣고 T-10이 나오는지 본다. 시각을 14:00으로 바꾸면 어떻게 되는지 예상하고 확인한다
4. **내 말로**: "왜 화면 규칙을 그래프가 아니라 함수로 두었나?" / "확신 0.6 미만이면 왜 고르지 않고 되묻나?"

## 9. 1차 결과와 후속 (11-03)
**1차 결과**: 브랜치 `feat/server-skeleton`. 기본 테스트 63개 통과(결정권자 맥 확인), 돌연변이 251/258 = 97.3%, AC-4 타입 생성 완료, `.env.example` 커밋, AC-19 실제 Jev 연결 통과(두 번째 시도). 남은 것: AC-3·20

### 9-1. 후속 테스트 세션이 할 것
| ID | 내용 |
|---|---|
| AC-21 | 가짜 Jev 응답을 **실제 모양**으로: `{"answers": {"<질문 id>": {"type":"choice","choice":...,"confidence":...,"probabilities":{...}}}, "provider_metadata": {"gateway": {"cost": ...}}}` (POC-001 측정에서 확인). `cost`는 숫자와 숫자 문자열을 둘 다 받는다 |
| AC-22 | 경계값: 식사 시간대 13:30 정각·11:00·11:29, 7km 정각, 10km 정각에서 칩 여부, 18:00 정각 |
| AC-23 | 약한 신호 칩 매핑 (SCREEN-001 §4-2a 11-03): 7~10km → T-09, 식사 30분 전 → T-10, 여유 30분 → T-11, 18시 전 일정 끝 → T-11, 여러 개면 표 순서로 첫 번째 |
| AC-20 | 앱 첫 화면 테스트 2개 (정상 / 서버 오류) |
| AC-24 | 첫 호출 지연 대비 (1차 live 결과: 첫 호출 3.24초 → fallback, 두 번째 0.95초): `JevDecider`는 HTTP 연결을 **재사용**하고(호출마다 새로 만들지 않음), 서버 시작 시 연결을 미리 여는 **예열(warm-up)** 을 한 번 한다. 예열 실패는 서버 시작을 막지 않는다. 실패한 호출은 `reason`에 원인(시간 초과/HTTP 오류/응답 모양)을 남긴다 |

### 9-2. 후속 코드 세션이 할 것
- AC-21~24 통과, AC-3(앱 첫 화면), AC-4(타입 생성 확인), AC-20 통과
- 기준값 상수(15분·45분·0.6 등)도 돌연변이 대상이 되게 방법을 찾아 점수를 다시 잰다 (안 되면 이유를 PR에)
- PR 초안에 1차·2차 결과를 함께 정리

### 9-3. 2차 결과 (11-03)
- 서버 테스트 95개 통과, 앱 Jest 3개 통과. AC-20~24 완료. AC-3은 실제 폰(Expo Go) 확인 남음
- 돌연변이 **91.0%** (313/344). 1차 97.3%는 한글 테스트 이름 escape 문제로 무효 (pytest 설정으로 해결)
- 살아남은 25개(테스트 없는 곳: T-05 영업 확인, 이동 상태 값, 일부 짝, 20:00 경계) → **TASK-002 시작 전 보강 테스트**로
- 예열 시간 제한 5초 (구현 중 결정) → PM 결정: **서버 시작을 막지 않게 백그라운드로 예열**. 예열이 끝나기 전 요청은 0.8초 규칙대로(늦으면 규칙 대체)
- 앱 타입 검사 오류 1건: Expo 템플릿 원래 오류, 건드리지 않음
