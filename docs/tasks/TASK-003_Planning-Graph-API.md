# TASK-003 · 계획 대화 그래프(G1, R1 규칙 노드) + `/planning` API

| 항목 | 내용 |
|---|---|
| 발행 | PM · 2026-11-05 |
| 상태 | **v2** — 11-05 test-writer 질문 35개 답을 §10에 추가 (§5·§6 일부 수정). **§10이 §4~§6보다 우선** |
| 관련 | GRAPH-001 §1·§2 · API-001 §2-2·§3 · SRS-001 FR-02~03·07a · SCREEN-001 §3-1 · TASK-002(엔진 함수) · DATA-001 C·D |
| 브랜치 | `feat/task-003-planning-graph` |
| 다음 | TASK-004 계획 화면 (`frontend`, **디자인 시스템 확정 후**). 이 TASK의 API 응답 모양이 TASK-004의 계약 |

> TASK-002에서 질문이 65개 나왔다. 그래서 이번에는 **상태 전이표, 이벤트 모양, 응답 모양, 오류 규칙을 먼저 고정**한다. 표에 없는 동작은 만들지 말고 질문으로 돌려준다

## 0. 먼저 할 것 (TASK-002 남은 것)
- **Q53 확장**: `PlanFixed.start/end`, `Opening.open/close`에서 분 ≥ 60(`"10:75"`)과 음수(`"10:-5"`)는 `ValueError`. 형식은 `^\d{2}:\d{2}$`만 허용
- Q63~Q65 근거 주석 문구를 TASK-002 §10-5 표와 맞춘다 (동작 변경 없음)

## 1. 팀 나누기
| 순서 | 에이전트 | 할 일 | 의존 |
|---|---|---|---|
| 1 | `test-writer` | §0·§3~§7 테스트 + 요약표 → 승인 대기 | — |
| 2 | `backend` | `apps/server/graphs/planning.py`, `apps/server/planning/` 저장소, `api` 엔드포인트, 타입 재생성 | 없음 (서버만) |
| 3 | `reviewer` | 점검 (특히 §4 전이표와 1:1인지, 응답 모양이 §6과 같은지) | — |

## 2. 범위
| 만든다 | 만들지 않는다 |
|---|---|
| LangGraph G1 그래프 (규칙 노드만, LLM·Jev 없음) | LLM·Jev 노드 (R2) |
| 메모리 저장소 `PlanningRepo`(인터페이스 + 메모리 구현) | Supabase 연결 (별도 TASK). 인터페이스만 나중에 바꿔 끼운다 |
| 체크포인터 `MemorySaver` | Postgres 체크포인터 (Supabase TASK에서) |
| 개발용 데모 여행 `POST /debug/seed-demo` | `POST /trips` 정식 구현 (별도 TASK) |
| 엔드포인트 9개 (§5 표) | 앱 화면 (TASK-004) |

- LangGraph 사용법은 **작업 시점의 공식 문서**를 확인한다 (`StateGraph`, `interrupt()`, `Command(resume=...)`, 체크포인터). 고른 방식을 PR에 적는다

## 3. 그래프 상태 `PlanningState` (pydantic, 대화 맥락만)
| 필드 | 타입 | 뜻 |
|---|---|---|
| `session_id` | str | 스레드 ID = 세션 ID |
| `day_id` | str | |
| `mode` | `"conversation"` \| `"auto"` | |
| `stage` | `"asking"` \| `"browsing"` \| `"composing"` \| `"done"` | DATA-001 planning_sessions.state |
| `round` | int | 보여 준 묶음 수 (첫 묶음 = 1) |
| `categories` | list[str] | 첫 질문에서 고른 종류 |
| `shown` | list[id] | 지금까지 보여 준 장소 |
| `batch` | list[id] | 지금 묶음 |
| `last_direction` | Direction \| None | |
| `clarify_count` | int | 직접 입력을 못 알아들은 횟수 (이번 묶음 기준) |
| `option_ids` | list[str] | 지금 보여 주는 코스안 ID |

반응(좋아/넘김), 코스안, 선택 결과는 **`PlanningRepo`에 저장**한다 (상태에 넣지 않음, ADR-013)

## 4. 상태 전이표 (이 표가 그래프의 정본)
| 지금 stage | 이벤트 (`Command(resume=...)`) | 처리 | 다음 stage |
|---|---|---|---|
| (시작) | `mode="conversation"` | 첫 질문 보냄 | asking |
| (시작) | `mode="auto"` | §4-2 자동 → 코스 계산 | composing |
| asking | `answer{choice_ids[], text?}` | §4-1 첫 묶음 | browsing |
| asking | `auto{}` ([알아서 짜 줘]) | §4-2 | composing |
| browsing | `reaction{place_id, action}` | 저장소에 반영 (`like`/`skip`/`unlike`). 묶음은 그대로 | browsing |
| browsing | `next{direction_id}` | 이번 묶음에서 반응 없는 곳 = `skip` 기록 → `next_batch(direction)` | browsing |
| browsing | `next{text}` | `parse_direction(text)`. 알아들으면 위와 같음. 못 알아들으면 §4-3 되묻기 | browsing |
| browsing | `next{}` (아무것도 안 줌) | 반응 없는 곳 skip 기록 → `next_batch(None)` | browsing |
| browsing | `compose{}` | 반응 없는 곳 skip 기록 → 담은 곳으로 `compose_courses` | composing |
| composing | `adjust{place_id, delta}` | `stay_overrides[place_id]` ±15 (현재 값 또는 그 안의 머문 시간 기준) → 다시 계산 | composing |
| composing | `back{}` ([더 고를래]) | `next_batch(None)` | browsing |
| composing | `select{option_id}` | 저장소에 선택 저장 | done |
| 그 외 조합 | 아무 이벤트 | **409 `STATE_CONFLICT`**, 상태 그대로 | 그대로 |

### 4-1. 첫 묶음
- 보기 칩 → 종류: 골목 산책→`walk`, 맛집 투어→`food`, 쇼핑→`shop`, 야경→`night`, 카페→`cafe`, 전시·체험→`museum`·`experience`
- 고른 종류의 장소를 점수순(반응이 없으니 동점 → id 숫자 순)으로 6곳. 5곳 미만이면 나머지를 거르지 않은 장소에서 채운다. 칩을 하나도 안 골랐으면 거르지 않음
- `text`가 있으면 `parse_direction`. 방향이 나오면 그 방향으로 거른 뒤 위 규칙 (못 알아들으면 무시하고 진행 — 첫 질문에서는 되묻지 않음)
- 이 규칙은 엔진 함수 **`first_batch(places, categories, direction, anchor, at, k=6) -> Batch`**로 `engine/planning.py`에 추가한다 (순수 함수, TDD)

### 4-2. 자동 ("알아서 짜 줘")
- 담은 곳 = 꼭 갈 곳 + `first_batch(categories, None)`의 6곳 → `compose_courses`
- 반응 기록은 남기지 않는다

### 4-3. 되묻기 (직접 입력을 못 알아들었을 때)
- `clarify_count == 0`이면: 응답에 `clarify` 보기 = `pick_directions(...)` 결과(0개면 `["quieter","food","night"]`), 묶음은 그대로. `clarify_count = 1`
- `clarify_count == 1`이면: 방향 없이 `next_batch(None)`으로 진행, `clarify_count = 0`
- 새 묶음을 보여 주면 `clarify_count = 0`
- 직접 입력 해석은 **매번 `decision_logs`에 기록** (`kind="parser"`, `model="rule"`, `output={text, direction, understood}`) — M-27 원자료

## 5. API (API-001 §2-2를 이 표로 확정)
공통: JSON. 오류는 `{"error": {"code", "message", "detail"}}`. 응답 모양은 §6

| 메서드·경로 | 요청 | 성공 | 실패 |
|---|---|---|---|
| POST `/debug/seed-demo` | — | 201 `{trip_id, day_ids[]}` (demo_city, 3일, 숙소 = 중심점, 둘째 날 꼭 갈 곳 1곳) | `APP_ENV=production`이면 404 |
| POST `/days/{day_id}/planning` | `{mode}` | 201 `PlanningSession` (auto면 201 `CourseResult`) | 404 day 없음, 422(auto에서 코스 불가, 세션 안 만듦) |
| POST `/planning/{session_id}/answer` | `{choice_ids[], text?}` 또는 `{auto: true}` | 200 `CandidateBatch` 또는 `CourseResult` | 404, 409, 422(auto에서 코스 불가) |
| POST `/planning/{session_id}/reactions` | `{place_id, action}` | 200 `Picks` | 404, 409, 400(묶음에 없는 place_id) |
| POST `/planning/{session_id}/next` | `{direction_id?}` 또는 `{text?}` | 200 `CandidateBatch` (되묻기면 `clarify` 채움) | 404, 409, 400(없는 direction_id) |
| POST `/planning/{session_id}/compose` | — | 200 `CourseResult` | 404, 409, **422 `COURSE_INFEASIBLE`**(Infeasible 내용을 `detail`에) |
| POST `/planning/{session_id}/adjust` | `{option_id, place_id, delta: 15 \| -15}` | 200 `CourseResult` | 404, 409, 400, 422 |
| POST `/planning/{session_id}/back` | — | 200 `CandidateBatch` | 404, 409 |
| POST `/course-options/{option_id}/select` | — | 200 `{day_id, option_id}` | 404, 409 |

- `/adjust`, `/back`은 API-001에 없던 것 → PM이 API-001에 추가한다
- 세션 ID·코스안 ID는 서버가 만든 문자열 (`uuid4`)

## 6. 응답 모양 (pydantic → OpenAPI → `packages/api-types`)
```json
// PlanningSession
{ "session_id": "…", "stage": "asking",
  "question": { "text": "둘째 날은 어떤 하루면 좋겠어? 끌리는 거 다 골라 줘!",
                "choices": [ {"id": "walk_alley", "label": "골목 산책"}, … 6개 ],
                "allow_text": true, "allow_auto": true } }

// CandidateBatch
{ "session_id": "…", "stage": "browsing", "round": 2,
  "message": "좀 더 한적한 데 쪽으로 다시 찾아봤어!",
  "candidates": [ { "place": Place, "why": "골목 좋아해서 골랐어요" } ],
  "directions": [ {"id": "quieter", "label": "좀 더 한적한 데"} ],
  "clarify": null,
  "picks_count": 3, "exhausted": false, "direction_relaxed": false }

// Place (앱에 보내는 모양)
{ "id": "D07", "name": "골목 카페 A", "category": "cafe", "lat": 35.0, "lng": 135.0,
  "crowd_level": 2, "price_level": 2, "mood_tags": ["골목"],
  "facts": [ { "field": "opening_hours", "value": "10:00-18:00",
               "status": "confirmed", "source_type": "demo", "checked_at": null } ] }

// Picks
{ "picks": ["D07", "D12"], "picks_count": 2 }

// CourseResult
{ "session_id": "…", "stage": "composing",
  "options": [ { "option_id": "…", "label": "relaxed", "items": [CourseItem], "dropped": [Dropped],
                 "go_home_min": 25, "total_travel_min": 80 } ] }
```
- 방향 이름표 (고정): quieter 좀 더 한적한 데 · closer 숙소랑 가까운 데 · cheaper 좀 더 저렴한 데 · different 완전 다른 느낌 · photo 사진 예쁜 데 · indoor 실내로 · food 먹을 데 · night 밤에 갈 데
- `message` 대본 (고정): 첫 묶음 "이런 곳들 어때? 마음에 들면 담아 줘" / 방향 있음 "{이름표} 쪽으로 다시 찾아봤어!" / 방향 없음 "다른 곳들도 찾아봤어" / 되묻기 "이 중에 있어?" / `exhausted` "더 보여 줄 곳이 거의 없어. 이제 코스 짜 볼까?"
- `why` 대본: 좋아한 곳과 겹치는 태그가 있으면 "{첫 태그} 좋아해서 골랐어요" → 아니고 방향이 있으면 "{이름표} 쪽이에요" → 아니면 "이런 곳도 있어요"
- `facts.value`는 그날 요일의 영업 구간(`"10:00-18:00"`, 여러 구간이면 `,`로). 모름이면 `null`, `status="unknown"`. 데모 데이터는 `source_type="demo"` (DATA-001에 PM이 추가)
- `clarify`: 되묻기일 때 `[{id, label}]`, 아니면 `null`

## 7. 완료 기준
| ID | Given | When | Then |
|---|---|---|---|
| AC-1 | 전체 | `uv run pytest` | 모두 통과 (TASK-001·002 포함) |
| AC-2 | §0 | 잘못된 시각 6종 | `ValueError`, `"09:59"`는 정상 |
| AC-3 | `first_batch` | 칩·텍스트·종류 부족 경우 | §4-1대로 (Hypothesis 포함: 크기, 중복 없음, 결정적) |
| AC-4 | §4 전이표 | 표의 **각 줄** | 표의 처리와 다음 stage (줄마다 테스트) |
| AC-5 | 표에 없는 조합 | 아무 이벤트 | 409, stage 그대로, 저장소 그대로 |
| AC-6 | browsing, 묶음 6곳 중 2곳 like | `next{}` | 나머지 4곳이 skip으로 기록, 새 묶음에 이전 6곳 없음 |
| AC-7 | `unlike` | 반응 | picks에서 빠짐, skip으로 바뀌지 않음 |
| AC-8 | 못 알아듣는 글 2번 연속 | `next{text}` | 1번째 `clarify` 채움·묶음 그대로, 2번째 방향 없이 새 묶음 |
| AC-9 | 직접 입력 | 해석 | `decision_logs`에 한 줄씩 (`parser`/`rule`, understood 포함) |
| AC-10 | 담은 곳 0곳 | `compose` | 빈 코스 1안 (TASK-002 Q37) |
| AC-11 | 꼭 갈 곳이 그날 휴무 | `compose` | 422 `COURSE_INFEASIBLE`, `detail.reason="must_visit_closed"` |
| AC-12 | composing | `adjust{+15}` 두 번 | 그 곳 +30분, `stay_source=user`, 다시 계산된 안 |
| AC-13 | composing | `back` → `compose` | 반응이 이어지고, 새로 담은 곳까지 포함 |
| AC-14 | composing | `select` | stage done, 저장소에 선택 저장, 이후 이벤트는 409 |
| AC-15 | auto 모드 | 세션 시작 | 바로 `CourseResult` (꼭 갈 곳 포함) |
| AC-16 | 같은 세션 | 요청 사이에 `PlanningRepo`·그래프를 다시 만들지 않고 이어짐 | interrupt 재개로 이어짐 (체크포인터) |
| AC-17 | 응답 | 모든 성공 응답 | §6 모양과 같음 (pydantic 모델로 검증), `facts`에 상태 필수 |
| AC-18 | API | 타입 생성 | `packages/api-types`가 §6 모델을 담고, 생성 결과가 커밋본과 같음 |
| AC-19 | 그래프 | LLM·Jev 호출 | 0회 (R1) |
| AC-20 | `APP_ENV=production` | `/debug/seed-demo` | 404 |

## 8. 하지 말 것
- 표(§4·§5·§6)에 없는 이벤트·필드·문구를 만들지 않는다. 필요하면 질문으로
- 엔진(`engine/planning.py`의 기존 함수) 동작을 바꾸지 않는다. `first_batch` 추가와 §0만
- `docs/` 내용 수정, 저장소 밖 검색

## 9. 학습 카드 (결정권자용)
1. **지도**: 앱이 버튼을 누를 때마다 API가 그래프를 **"멈춘 자리에서 다시 이어"** 실행한다. 멈춘 자리 = `interrupt()`, 이어 가기 = `Command(resume=…)`, 어디까지 갔는지 기억 = 체크포인터
2. **핵심 개념**: 상태 기계(전이표 = 테스트 목록) · 그래프 상태 vs 저장소(맥락만 vs 원본 데이터) · 409(지금 단계에서 할 수 없는 요청)
3. **직접 해보기**: `/debug/seed-demo` → 세션 시작 → 좋아 2번 → 코스 짜기를 `curl` 또는 `/docs` 화면에서 눌러 본다
4. **내 말로**: "왜 반응은 그래프 상태가 아니라 저장소에 두나?" / "R2에서 LLM으로 바꿀 때 어디만 바꾸면 되나?"

## 10. 질문 답 (11-05, test-writer Q1~Q35)
원칙 두 가지를 먼저 정한다. 아래 답은 모두 이 원칙에서 나온다
- **실패한 요청은 아무것도 바꾸지 않는다** (4xx면 그래프 상태·저장소 모두 요청 전과 같음)
- **응답 문구·값은 그 응답을 만들 때의 상태로 매번 새로 계산한다** (why, directions, exhausted)

### 10-1. 구현을 막던 질문
| Q | 답 |
|---|---|
| Q2 | 자동 모드에서 코스를 못 만들면 **422 `COURSE_INFEASIBLE`**. 시작(`mode="auto"`)이면 **세션을 만들지 않는다**. asking의 `answer{auto}`이면 stage는 asking 그대로 (앱은 대화 모드로 이어 간다) |
| Q3 | compose·adjust가 422면 **전부 그대로**: compose는 browsing 유지, skip 기록 안 함. adjust는 `stay_overrides`를 되돌리고 composing 유지 |
| Q4 | 칩 ID (이 순서로 보낸다): `walk_alley` 골목 산책 · `food_tour` 맛집 투어 · `shopping` 쇼핑 · `night_view` 야경 · `cafe` 카페 · `museum_experience` 전시·체험. **TASK-004 계약** |
| Q6 | `message` 우선순위: **되묻기 > exhausted > 첫 묶음 > 방향 있음 > 방향 없음** (위에서 처음 맞는 하나) |
| Q9 | 그날 휴무(`hours=[]` 포함): `value=null`, `status="confirmed"`. **뜻: confirmed + null = 그날 휴무, unknown + null = 모름**. 앱은 이 둘을 다르게 보여 준다 |
| Q14 | adjust 요청에 **`option_id`를 추가**한다 (§5 수정). 기준값 = `stay_overrides[place_id]`가 있으면 그 값, 없으면 **그 안(option_id)에서의 머문 시간**. 결과를 15~300으로 자른 뒤 저장. 저장된 값은 장소 단위라 다시 계산할 때 두 안 모두에 적용 |
| Q19 | 2번째 못 알아들음도 **반응 없는 곳을 skip 기록** (줄08과 같음) |
| Q20 | 자동 코스는 반응·shown을 남기지 않는다 (①). 자동 코스의 장소 목록은 코스안에 저장하고, adjust는 그 목록으로 다시 계산. 자동 세션에서 back → `next_batch(None)`, 담은 곳 0. **가설**: 사용자가 "더 고를래"에서 처음부터 고르는 게 괜찮은지 TASK-004 사용성 확인 때 본다 |

### 10-2. 임시 가정을 그대로 확정 (테스트 그대로)
Q1 ①(201 + CourseResult) · Q7 ②(채운 곳은 기본 문장) · Q8 후보의 `mood_tags` 순서 · Q10 unverified · Q11 next_batch 규칙과 같음 · Q13 next_batch와 같은 검사 · Q16 ①(adjust마다 새 ID, 옛 ID 404) · Q17 ①(unlike는 담은 곳 어디든, like·skip은 지금 묶음만) · Q18 반응 skip이면 담은 곳에서 빠짐, picks는 담은 순서 · Q21 저장소가 option_id로 찾음 · Q25 새 세션 (이전 세션도 유지) · Q34 대본 유지 (§6 예시 고침) · Q35 9개

### 10-3. 임시 가정과 다르게 정함 (테스트 고침)
| Q | 답 |
|---|---|
| Q12 | 칩 + 방향으로 채울 때 순서: **둘 다 맞는 곳 → 칩만 맞는 곳 → 방향만 맞는 곳 → 나머지**, 각 묶음 안은 점수순·id 숫자 순 (칩은 사용자가 직접 고른 것이라 먼저) |
| Q15 | 400 조건: `option_id`의 `items`에 없는 장소 (dropped 포함, 다른 안에만 있는 곳 포함) |
| Q29 | 형식은 **ASCII 숫자만** (`re.fullmatch(r"[0-9]{2}:[0-9]{2}", s)`). `"10:00\n"`, 전각 숫자도 `ValueError` 테스트 추가. `DayPlan`은 이번 범위 밖 |

### 10-4. 비어 있던 값
| Q | 답 |
|---|---|
| Q5 | 첫 질문의 날짜 말: 첫째·둘째·셋째·넷째·다섯째 날, 6일째부터 "{n}일째" (trip 안 순서) |
| Q22 | `next{}`·back 뒤 `last_direction = None` |
| Q23 | 본문 오류는 모두 **400 `INVALID_REQUEST`** 공통 형식 (FastAPI 기본 422를 바꿔 끼움). `direction_id`+`text` 동시, 빈 글, `auto`+`choice_ids`도 400 |
| Q24 | `code` 값: `NOT_FOUND` · `INVALID_REQUEST` · `STATE_CONFLICT` · `COURSE_INFEASIBLE` (이 4개뿐) |
| Q26 | 시드: 날짜 **2026-12-01~12-03 고정**, 하루 10:00~20:00, `at` = 그날 시작 시각. 꼭 갈 곳은 둘째 날 여는 곳 중 id가 가장 작은 곳. 고른 id를 PR에 적는다 |
| Q28 | R1은 `decision_logs`만. `message_id=null`, 글 원문은 200자까지 저장 (데모 데이터라 R1만 허용, 개인정보 처리는 Supabase TASK에서 정함) |
| Q30 | 되묻기 응답: 묶음 그대로, directions·exhausted·why는 원칙대로 지금 상태로 계산 |
| Q31 | 빈 묶음이면 round 그대로, `exhausted=true` |
| Q32 | §4대로 즉시 다시 계산. "빠지는 곳"은 앱이 `dropped`로 보여 주고 -15로 되돌릴 수 있게 한다 (TASK-004) |
| Q33 | 꼭 갈 곳은 **후보에서 뺀다**. 그래프가 꼭 갈 곳을 뺀 장소 목록을 `first_batch`·`next_batch`에 넘긴다. 자동의 6곳도 꼭 갈 곳 제외 6곳 |

### 10-5. 다음 TASK로
- Q27 현재 상태 조회 `GET /planning/{session_id}` (앱 재시작 이어 가기) → TASK-004 시작 전 `backend` 소작업

### 10-6. 문서끼리 다른 곳
test-writer가 찾은 11곳은 **TASK-003이 정본**이다. API-001 §2-2·§3, GRAPH-001 §1-1·§2, SRS-001 AC-16에 "계획 부분은 TASK-003이 정본" 표시를 PM이 넣었다. 전체 정리는 TASK-004 문서와 함께 한다

### 10-7. PM 메모
- 표를 먼저 고정해도 질문이 35개 나왔다. 대부분 **표의 줄끼리 겹치는 곳**(대본 충돌, 실패 뒤 상태, 자동 + back)이었다 → 다음 TASK부터 "실패하면 어떻게 되나"와 "두 규칙이 겹치면 무엇이 이기나"를 처음부터 적는다

## 포트폴리오 포인트
- 전이표 한 줄 = 테스트 하나. 그래프 흐름이 문서·테스트·코드에서 같다
- R1 규칙 노드 그래프를 R2에서 **노드만 LLM·Jev로 바꿔** 같은 그래프로 비교 (M-27)
- 예상 면접 질문: "LangGraph를 왜 R1부터 썼나요?" → "사용자 입력을 기다렸다 이어 가는 흐름(interrupt·체크포인트)이 핵심이라서. R2에서 노드만 바꿔 규칙 vs LLM을 같은 조건으로 비교하려고"
