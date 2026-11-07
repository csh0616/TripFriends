# API-001 · API 명세 초안 (v4, R1~R2)

| 항목 | 내용 |
|---|---|
| 상태 | **초안** — PM 작성 2026-11-02. 계획 대화 부분은 TASK-003 §5·§6이 정본 (11-05) |
| 서버 | Python FastAPI (`apps/server`). 이 문서가 기준이고, 구현 후 서버의 OpenAPI가 자동 생성되어 앱 타입(`packages/api-types`)이 된다 (ADR-013) |
| 입력 | SRS-001 · DATA-001 |
| 공통 | JSON. 시간은 ISO 8601(도시 현지 시간대 포함). 인증: R1은 `X-Device-Id` 헤더, 로그인 후 `Authorization: Bearer <Supabase JWT>` |

## 1. 공통 규칙
| 규칙 | 내용 |
|---|---|
| 사실 값 표시 | 장소 정보는 항상 `facts` 배열로: `{field, value, status, source_type, source_url, checked_at}`. 앱은 status에 따라 "확인됨/미확인/모름"을 표시 |
| 오류 형식 | `{ "error": { "code": "COURSE_INFEASIBLE", "message": "사람이 읽을 문장", "detail": {...} } }` |
| 상태 코드 | 200 성공, 201 생성, 400 입력 오류, 404 없음, 409 상태 충돌(예: 이미 선택된 대안), 422 계산 불가, 429 사용 한도 |
| 비밀값 | 앱은 Jev·LLM을 직접 부르지 않는다. 모든 AI 호출은 서버 안에서 |
| 측정 | 판단이 일어나는 요청은 서버가 decision_logs에 기록 (앱은 신경 쓰지 않음) |

## 2. 엔드포인트
### 2-0. 기본
| 메서드·경로 | 설명 | FR |
|---|---|---|
| GET `/health` | `{ok, cards}` | TASK-001 |
| GET `/catalog` | 카드 종류와 스키마 | — |

### 2-1. 여행
| 메서드·경로 | 요청 | 응답 | FR |
|---|---|---|---|
| POST `/trips` | `{city_code, start_date, end_date, lodging_place_id?, must_visit_place_ids[]}` | 201 `Trip` (trip_days 포함) | FR-01 |
| GET `/trips/{trip_id}` | — | `Trip` + 날짜별 선택 코스 | FR-33 |
| POST `/trips/{trip_id}/fixed-events` | `{trip_day_id, title, start_at, end_at, place_id?}` | 201 `FixedEvent` | FR-01 |
| GET `/places/search?city_code&q` | 장소 이름 검색 (꼭 갈 곳·숙소 입력용) | `Place[]` | FR-01 |

### 2-2. 계획 대화 (FR-02~03)
> **11-05**: 계획 API의 경로·요청·응답·오류는 **TASK-003 §5·§6·§10이 정본**이다. 아래와 다르면 TASK-003을 따른다

| 메서드·경로 | 요청 | 응답 | FR·AC |
|---|---|---|---|
| POST `/days/{day_id}/planning` | `{mode: "conversation" \| "auto"}` | 201 `PlanningSession` (첫 질문과 보기) | FR-02·05, AC-16 |
| POST `/planning/{session_id}/answer` | `{choice_ids[]?, text?}` 첫 질문 답 | `CandidateBatch` (후보 5~6개) | FR-02 |
| POST `/planning/{session_id}/reactions` | `{place_id, action: "like" \| "skip" \| "unlike"}` | `{picks[], picks_count}` | FR-02a·02b |
| POST `/planning/{session_id}/next` | `{direction_id?, text?}` (없으면 추정만으로) | `CandidateBatch` + `directions[]`(다음 방향 버튼) 또는 `{clarify: Direction[]}` | FR-02c, AC-17·17a |
| POST `/planning/{session_id}/compose` | — | `CourseOption[]` (2~3안) 또는 422 `COURSE_INFEASIBLE` + 뺄 후보 | FR-03·07, AC-18 |
| POST `/course-options/{option_id}/select` | — | `TripDay` (선택 코스 반영) | FR-03 |
| POST `/planning/{session_id}/adjust` | `{option_id, place_id, delta: 15\|-15}` | `CourseResult` (머무는 시간 조정 후 다시 계산) | FR-07a (11-05 추가, TASK-003) |
| POST `/planning/{session_id}/back` | — | `CandidateBatch` ([더 고를래]) | FR-02 (11-05 추가, TASK-003) |
| POST `/debug/seed-demo` | — | `{trip_id, day_ids[]}` (개발 전용, 운영에서 404) | TASK-003 |
| POST `/days/{day_id}/items/{item_id}/alternatives` | — | 같은 종류 대안 3곳 + 동선 변화(분) | FR-06, AC-04 |
| POST `/days/{day_id}/items/{item_id}/replace` | `{place_id}` | `TripDay` | FR-06 |

### 2-3. 여행 중 (FR-10~19)
> **11-07**: `GET /days/{day_id}/now`의 요청·응답은 **TASK-006 §A-1·§11이 정본** (시간대 없는 `at`, 사건은 TASK-007)
> **11-09**: `check`(위치는 본문)·`accept`·`dismiss`(경로 `/events/{id}/dismiss`)와 `NowView.event`는 **TASK-007 B-4·B-5·§11이 정본**. `GET /now`는 위치 쿼리를 받지 않는다
> **11-09**: `POST /places/{place_id}/visit-checks`(본문 `{day_id, at, was_open}`)와 T-05·T-06은 **TASK-008 §A·§B·§11이 정본**

| 메서드·경로 | 요청 | 응답 | FR·AC |
|---|---|---|---|
| GET `/days/{day_id}/now?lat&lng&at` | 현재 위치·시간 (위치는 저장 안 함) | `NowView`: 지금 할 일, 다음 이동, 남은 일정, 숙소 가는 방법, 열린 사건·대안 | FR-10·16 |
| POST `/days/{day_id}/check` | `{lat, lng, at}` | 새 `TripEvent[]` + `RecomposeProposal[]` (같은 사건은 다시 안 만듦) | FR-11·12·19, AC-05·10 |
| POST `/proposals/{proposal_id}/accept` | — | `TripDay` (반영) | FR-13 |
| POST `/proposals/{proposal_id}/dismiss` | — | 204 (일정 그대로) | FR-13, AC-06 |
| POST `/places/{place_id}/visit-checks` | `{trip_day_id, was_open}` | 닫혔으면 대안 3곳 | FR-14·15, AC-07·08 |
| GET `/sos?lat&lng&trip_id` | — | 긴급 번호, 현재 위치 주소, 숙소 주소 (오프라인 캐시용) | FR-30, AC-11 |

### 2-4. 대화 (R2)
| 메서드·경로 | 요청 | 응답 | FR·AC |
|---|---|---|---|
| POST `/chat` | `{trip_id, conversation_id?, text}` | **SSE 스트림**: `route`(chat/request/clarify/safety) → `token`… → `cards`(요청 결과) → `done` | FR-20~24, AC-12~14 |

## 3. 주요 응답 모양
```json
// CandidateBatch
{
  "batch_id": "…", "round": 2,
  "message": "조용한 쪽으로 다시 찾아봤어!",
  "candidates": [
    { "place": { "id": "…", "name": "…", "category": "cafe", "crowd_level": 2,
                 "facts": [ { "field": "opening_hours", "value": "10:00-18:00",
                              "status": "confirmed", "source_type": "official",
                              "source_url": "…", "checked_at": "2026-10-28" } ] },
      "why": "골목 산책 취향과 비슷해요" }
  ],
  "directions": [ { "id": "quieter", "label": "좀 더 한적한 데" },
                  { "id": "closer", "label": "숙소랑 가까운 데" },
                  { "id": "different", "label": "완전 다른 느낌" } ],
  "picks_count": 3
}
```
```json
// CourseOption
{
  "option_id": "…", "label": "relaxed",
  "items": [ { "seq": 1, "place_id": "…", "start_at": "2026-12-12T13:00+09:00",
               "end_at": "2026-12-12T14:00+09:00", "travel_min": 12, "is_fixed": false } ],
  "dropped": [ { "place_id": "…", "reason": "영업시간이 다른 곳과 겹치지 않음" } ],
  "go_home": { "text": "숙소까지 지하철 25분, 마지막 열차 23:58", "status": "unverified" }
}
```

## 4. 앱과 서버의 역할
| 앱 (TS) | 서버 (Python) |
|---|---|
| 화면, 카드 그리기, 버튼, 스트리밍 표시 | 대본(R1)·그래프(R2), 후보 검색·점수, 취향 추정, 코스 계산, 감지, 안전 규칙 |
| 위치는 `now`/`check` 호출 때만 보냄 | 위치를 저장하지 않음 |
| 오늘 일정·SOS를 기기에 캐시 (오프라인) | 사실 값은 place_facts에서만 |

## 5. 열린 질문
| ID | 질문 |
|---|---|
| OQ-A1 | `check` 호출 주기: 앱이 열려 있을 때 몇 분마다? (배터리 vs 감지 속도) |
| OQ-A2 | 푸시 알림 (R1은 앱 안 표시만, FR-19 S로 내릴 수 있음) |
| OQ-A3 | ~~계획 대화를 R2에서 `/chat`으로 합칠지~~ → **`/planning` 유지** (11-03, GRAPH-001 OQ-G2) |

## 포트폴리오 포인트
- **보여주는 것**: 요구사항 번호(FR·AC)가 붙은 API, 사실 값과 출처를 응답 구조에 고정, 앱은 화면만·판단은 서버에서
- **예상 면접 질문**: "앱과 서버 사이 타입은 어떻게 맞췄나요?" → "FastAPI의 OpenAPI 명세에서 TS 타입을 자동 생성하고, CI에서 커밋본과 다르면 실패시켰다"
