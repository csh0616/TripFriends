# TASK-002 · 계획 엔진: 후보 점수 · 방향 해석 · 다음 묶음 · 코스 계산(DP)

| 항목 | 내용 |
|---|---|
| 발행 | PM · 2026-11-03 |
| 상태 | **v5 (11-05)** — 구현·점검 후 결정 반영. **§10 > §9 > §8 > §7 > §2~§4 순서로 우선** |
| 관련 | SRS-001 FR-02a~c·03·07·07a, NFR-04 · SCREEN-001 §2(머무는 시간) · GRAPH-001 §2 · ADR-011 B·C · POC-001 §5-1·§7-1 · DATA-001 |
| 브랜치 | `feat/task-002-planning-engine` |
| 디자인 | **TASK-004 시작 전에 디자인 시스템(토큰·기본 부품)을 결정권자와 함께 만든다** (11-04 결정, PM이 먼저 알림) |
| 다음 | TASK-003 G1 계획 대화 그래프 + `/planning` API (`backend`) · TASK-004 계획 화면 (`frontend`) — **둘은 이 작업의 공개 함수로 동시에 진행 가능** |

## 0. 배경
- G1 계획 대화(GRAPH-001 §2)의 **엔진 쪽 부품**을 만든다. 그래프는 TASK-003에서 이 함수들을 부른다
- 모두 **LLM 없는 순수 함수**. 같은 입력 → 같은 출력. 시각은 인자로 받는다
- 도시가 아직 정해지지 않았다(설문 대기). 그래서 **가상 도시 데이터**(이름·좌표·영업시간 모두 가상)로 만든다. 실제 도시 데이터는 장소 TASK에서 넣는다

## 1. 팀 나누기
| 순서 | 에이전트 | 할 일 |
|---|---|---|
| 1 | `test-writer` | §3 A~F의 테스트 + 한국어 요약표 → **승인 대기** |
| 2 | `backend` | §3 구현, 돌연변이 측정 (의존: 없음 — 서버만) |
| 3 | `reviewer` | PR 전 점검 |

## 2. 데이터 모양 (pydantic, `apps/server/engine/models.py`)
| 모델 | 필드 |
|---|---|
| `Place` | `id`, `name`, `category`(`cafe`/`food`/`walk`/`museum`/`landmark`/`shop`/`experience`/`night`), `lat`, `lng`, `crowd_level`(1~5), `price_level`(1~4), `mood_tags: list[str]`, `hours: list[Opening] \| None`(None = 모름), `hours_status`(`confirmed`/`unverified`/`unknown`), `stay: StayRange \| None` |
| `Opening` | `weekday`(0=월~6), `open`, `close` (HH:MM) |
| `StayRange` | `min`, `typical`, `max` (분) |
| `Reactions` | `liked: list[id]`, `skipped: list[id]` (unlike는 liked에서 빠진 상태로 넘어옴) |
| `DayPlan` | `date`, `start`, `end`, `lodging: (lat,lng)`, `fixed: list[FixedEvent]`, `must_visit: list[id]`, `stay_overrides: dict[id, 분]` |
| `CourseOption` | `label`(`relaxed`/`packed`), `items: list[CourseItem]`, `dropped: list[Dropped]`, `go_home_min`, `total_travel_min` |
| `CourseItem` | `seq`, `place_id`, `start`, `end`, `stay_min`, `stay_source`(`auto`/`user`), `travel_min`(앞에서 오는 시간), `is_fixed`, `hours_status` |
| `Dropped` | `place_id`, `reason`(`closed_at_time`/`no_time`/`fixed_conflict`) |
| `Infeasible` | `reason`, `suggest_drop: list[id]` (FR-07) |

**가상 도시 데이터**: `apps/server/engine/fixtures/demo_city.json`, 장소 30곳 (8종류 고르게, 반경 약 3km, 영업시간 모름 3곳·미확인 5곳 포함, 머무는 시간 값 있는 곳 10곳). 이름은 누가 봐도 가상("골목 카페 A" 등)

## 3. 만들 것과 규칙
### A. TASK-001 남은 테스트 보강 (돌연변이 생존 25개)
- `compose_screen`: T-05 영업 확인 조건, 이동 상태 값(`on_track`/`delayed`/`free`) 각 경우, 짝 표의 보조 카드 전부, 20:00 경계

### B. 후보 점수 `score_candidates(reactions, places) -> dict[id, float]`
- **POC-001 §7-1 고정식 그대로** (태그 ±1, 종류 +1/−0.5, 붐빔·가격 평균 차 ×−0.5). 측정 때 쓴 식이라 바꾸지 않는다
- 좋아한 곳이 없으면 붐빔·가격 항은 0

### C. 방향 해석 `parse_direction(text) -> Direction | None`
- **POC-001 §5-1 키워드 표 그대로**, 위에서부터 먼저. 없으면 `None`(되묻기). 알려진 약점("까먹음" → food)은 R2 Jev가 맡으므로 고치지 않는다 (ADR-011 B)
- 방향 8개 → 거르기 규칙 (가설):

| 방향 | 남기는 후보 |
|---|---|
| quieter | `crowd_level ≤ 2` |
| closer | 숙소(또는 기준점)에서 1.2km 이내 |
| cheaper | `price_level ≤ 2` |
| different | 좋아한 곳 태그와 하나도 안 겹침 |
| photo | 태그에 `사진` 또는 `감성` |
| indoor | 태그 `실내` 또는 종류 `museum`/`shop` |
| food | 종류 `food` |
| night | 태그 `밤`/`야경` 또는 19:00 이후 영업 |

### D. 다음 묶음 `next_batch(places, reactions, direction, shown, k=6) -> Batch`
- 이미 보여 준 곳 제외 → 방향으로 거르기 → B 점수 높은 순 → `k`개 (동점은 id 순)
- 남은 후보가 5개 미만이면 있는 만큼 + `exhausted=True`. 방향으로 거른 결과가 0개면 방향을 무시하고 채우고 `direction_relaxed=True`

### E. 방향 버튼 고르기 `pick_directions(batch, remaining, last_direction) -> list[Direction]` (2~3개, 가설)
1. 묶음 평균 붐빔 ≥ 3이면 `quieter`, 평균 거리 > 1.0km면 `closer`, 평균 가격 ≥ 3이면 `cheaper`
2. 모자라면 `different`, `photo`, `indoor`, `food`, `night` 순으로, **남은 후보 중 그 방향에 맞는 곳이 3곳 이상**인 것
3. 직전에 쓴 방향은 빼고, 최대 3개. ([직접 말할래]는 앱이 항상 붙임)

### F. 코스 계산 `compose_courses(plan, picks, places) -> list[CourseOption] | Infeasible` (FR-03·07·07a)
- **이동 시간 (가설)**: 직선거리 ≤ 1.2km면 도보 `ceil(km / 4.5 × 60)`분, 넘으면 대중교통 `10 + ceil(km / 20 × 60)`분
- **머무는 시간**: 장소 값 → 없으면 SCREEN-001 종류별 기본(최소·보통·최대). 사용자가 바꾼 값(`stay_overrides`)은 그대로 지키고 `stay_source=user`
- **고르기 (DP)**: 꼭 갈 곳은 반드시, 담은 곳 중 **가장 많이** 넣는 방문 순서를 비트마스크 DP로 찾는다. 같으면 이동 합이 작은 쪽, 그래도 같으면 id 순. 확인할 때는 각 장소 **최소** 머무는 시간 기준
- **영업시간**: 머무는 동안 내내 열려 있어야 한다. 영업시간 모름(`None`)은 넣되 `hours_status=unknown`으로 표시
- **고정 일정**: 시각 그대로. 그 사이에 맞춰 넣는다. 하루 끝은 `end - 숙소까지 이동`
- **2안 만들기**:
  - `relaxed`: 장소 사이 쉬는 시간 15분, 남는 시간을 보통→최대 쪽으로 고르게 늘림
  - `packed`: 쉬는 시간 5분, 최소→보통. 남는 시간이 있으면 같은 고르기를 다시 해서 더 넣을 수 있으면 넣음
  - 두 안이 같으면 하나만
- **못 넣은 곳**: `dropped`에 이유. 꼭 갈 곳을 못 넣으면 `Infeasible` + 빼면 되는 담은 곳 제안
- **비교용 탐욕법** `compose_greedy`: 가장 가까운 곳부터. 포트폴리오 비교용(M-? DP vs 탐욕법)

## 4. 완료 기준
| ID | Given | When | Then |
|---|---|---|---|
| AC-1 | 전체 | `uv run pytest` | 모두 통과, TASK-001 테스트 포함 |
| AC-2 | A | 돌연변이 재측정 | `compose` 생존 돌연변이가 "원래와 결과가 같은 것"만 남음 |
| AC-3 | B, `docs/poc/poc_c.json`(POC-001 §7 측정 데이터 H1~H10, P1~P12, S1~S6) | `score_candidates` | 상위 3곳이 측정 때 규칙 결과와 같음: S1 P7·P11·P1 / S2 P7·P1·P11 / S3 P6·P10·P4 / S4 P11·P9·P2 / S5 P11·P8·P1 / S6 P1·P3·P7 (순서 포함, 측정 재현) |
| AC-4 | C, POC-001 §5-1 키워드 | `parse_direction` | 표의 키워드마다 해당 방향, 여러 개면 위 순서, 없으면 None |
| AC-5 | D | 이미 보여 준 곳 | 다시 나오지 않음, 크기 ≤ k, 동점 id 순 |
| AC-6 | D, 방향 결과 0개 | `next_batch` | `direction_relaxed=True`, 묶음은 채워짐 |
| AC-7 | E | `pick_directions` | 2~3개, 직전 방향 없음, 규칙 1→2 순서 |
| AC-8 | F, 꼭 갈 곳 1 + 담은 곳 4, 시간 충분 | `compose_courses` | 2안 모두 5곳, 꼭 갈 곳 포함 |
| AC-9 | F, 17:00에 닫는 곳 | 순서상 17:00 이후가 됨 | 다른 순서로 넣거나 `dropped(closed_at_time)` |
| AC-10 | F, 고정 일정 15:00~16:00 | `compose_courses` | 고정 일정 시각 그대로, 겹치는 항목 없음 |
| AC-11 | F, 꼭 갈 곳이 영업시간 밖 | `compose_courses` | `Infeasible` + 제안 |
| AC-12 | F, 사용자가 카페를 120분으로 바꿈 | 다시 계산 | 그 카페 120분 `stay_source=user`, 넘치면 다른 곳이 `dropped(no_time)` |
| AC-13 | F, 임의 입력 (Hypothesis) | `compose_courses` | 겹침 0, 영업시간 위반 0, 고정 일정 위반 0, 하루 범위 안, 머무는 시간이 범위(또는 사용자 값) 안 (NFR-04) |
| AC-14 | F, 임의 입력 (Hypothesis) | DP와 탐욕법 | DP가 넣은 장소 수 ≥ 탐욕법 |
| AC-15 | F, 임의 입력 | 같은 입력 두 번 | 같은 결과 |
| AC-16 | F, 담은 곳 12개 | 실행 시간 | 1초 이내 (가설, 맥 기준) |
| AC-17 | 데이터 | fixture 검사 | 30곳, 8종류, 모름 3·미확인 5·머무는 시간 값 10, 이름이 가상 |

## 5. 하지 말 것
- LLM·Jev 호출 (이 TASK는 규칙·계산만), 그래프·API (TASK-003), 앱 (TASK-004), Supabase 연결
- POC-001 고정식·키워드 표 바꾸기, `docs/` 고치기

## 6. 학습 카드 (결정권자용)
1. **지도**: 계획 대화에서 "누가 뭘 계산하나" — 점수(B)·방향(C·E)·묶음(D)은 고르기 화면, 코스(F)는 [코스 짜 줘] 버튼 뒤
2. **핵심 개념**
   - 비트마스크 DP — 담은 곳 n개의 "어떤 곳을 이미 갔나"를 0/1 비트로 표현해 가능한 순서를 빠짐없이 비교. n ≤ 12라서 가능 (2¹² × 12 = 약 5만 상태)
   - 탐욕법과 비교 — 빠르지만 최선을 놓칠 수 있다. AC-14가 그 차이를 숫자로 보여 준다
   - 속성 기반 테스트 — "어떤 일정이든 영업시간을 어기지 않는다"를 무작위 수백 개로 확인 (코테 준비와도 연결)
3. **직접 해보기**: AC-12처럼 머무는 시간을 늘려 보고 무엇이 빠지는지 본다
4. **내 말로**: "왜 코스 계산은 LLM이 아니라 DP인가?" / "DP가 탐욕법보다 항상 낫다는 걸 어떻게 확인했나?"

## 포트폴리오 포인트
- 같은 입력에 대해 DP vs 탐욕법을 속성 테스트로 비교한 숫자 (넣은 장소 수, 이동 시간 합)
- 측정 때 쓴 규칙(POC-001)을 그대로 코드로 옮겨 "측정한 것 = 출시한 것"을 테스트로 보장 (AC-3·4)
- 예상 면접 질문: "여행 코스를 왜 LLM에 맡기지 않았나요?" → "영업시간·고정 일정을 어기면 안 되는 제약 문제라서. DP로 풀고 속성 테스트로 위반 0건을 확인했다. LLM은 설명 문장에만 쓴다"


## 7. 질문 답변과 확정 (v2, 2026-11-04) — 이 절이 위보다 우선
> 1차 test-writer가 질문 20개를 냈다. **PM이 TASK를 덜 구체적으로 쓴 탓**이다. 아래로 확정한다. 1차 test-writer는 저장소 밖 파일과 `Claude outputs/`를 읽어 "문서만 보고 쓴다"를 벗어났으므로, **새 test-writer로 다시 시작**한다

### 7-1. 자료
| Q | 결정 |
|---|---|
| Q1 | `docs/POC-001_Jev-Composition-PoC-Plan.md`와 **`docs/poc/poc_c.json`**(측정 데이터 + 측정된 규칙 상위 3곳)을 추가했다. 이 둘만 근거로 쓴다. 스크립트·저장소 밖 파일은 보지 않는다 |
| Q2 | 동점은 **id의 숫자 부분 오름차순** (P2 < P10). 가상 도시 id는 `D01`~`D30` (두 자리, 글자 순 = 숫자 순) |
| Q3 | 종류 대응: 카페→`cafe`, 음식→`food`, 쇼핑→`shop`, 산책→`walk`, 체험→`experience`, 전망→`landmark` (`poc_c.json`의 `category_map`) |
| Q4 | 시그니처 `score_candidates(reactions, places: dict[id, Place], candidate_ids) -> dict[id, float]`. `places`에는 기록용(H)과 후보(P)가 모두 들어 있고, 점수는 `candidate_ids`만. 종류 규칙: 좋아한 곳 종류에 있으면 **+1(넘김에도 있어도)**, 좋아한 곳 종류에 없고 넘긴 곳 종류에만 있으면 −0.5 |
| Q9 | 기본 머무는 시간(최소·보통·최대, 가설): `shop` 30·60·120, `experience` 60·90·150, `night` 60·90·150. 나머지: `cafe` 30·60·90, `food` 45·60·90, `walk` 30·60·120, `museum` 60·90·150, `landmark` 60·120·180 (SCREEN-001 표에도 반영) |

### 7-2. 후보 고르기 (B~E)
| Q | 결정 |
|---|---|
| Q5 | 시그니처 확정 (TASK-003·004도 이것을 쓴다):<br>`next_batch(places, reactions, direction, shown, anchor, at, k=6) -> Batch`<br>`pick_directions(batch, remaining, reactions, last_direction, anchor, at) -> list[Direction]`<br>`anchor` = 거리 기준점 `(lat, lng)` (지금 위치, 없으면 숙소). `at` = 계획하는 날짜·시각 (night의 요일·19:00 판정). night: 그 요일에 **닫는 시각이 19:00보다 늦은** 영업 구간이 있으면 |
| Q6 | `pool` = 아직 안 보여 준 곳. `pool`이 5개 미만이면 `pool` 전부 + `exhausted=True`. 아니면 방향으로 거른 결과가 5개 미만일 때 **나머지를 거르지 않은 `pool`에서 점수순으로 채워** `min(k, len(pool))`개로 만들고 `direction_relaxed=True` (0개일 때도 같은 규칙) |
| Q7 | 규칙 1 다음 3개 미만이면 규칙 2(그 방향 남은 곳 3곳 이상). 그래도 2개 미만이면 같은 순서로 **1곳 이상**인 방향으로 채운다. 그래도 모자라면 있는 만큼 (0~1개 가능, 앱은 [직접 말할래]를 항상 붙인다) |
| Q8 | **TASK가 우선** (GRAPH-001의 "가장 차이 나는 속성"은 이 규칙으로 구체화한 것, PM이 GRAPH-001 문구 정리). `Direction = Literal["quieter","closer","cheaper","different","photo","indoor","food","night"]`. `Batch`: `place_ids: list[id]`, `direction: Direction \| None`, `exhausted: bool`, `direction_relaxed: bool` |

### 7-3. 코스 계산 (F)
| Q | 결정 |
|---|---|
| Q10 | 안마다 **쉬는 시간을 넣은 채로** DP 고르기를 따로 한다 (최소 머무는 시간 기준). relaxed = 쉬는 15분으로 고르기 → 남는 시간으로 보통까지 → 그다음 최대 쪽. packed = 쉬는 5분으로 고르기 → 남는 시간으로 보통까지만. 그래서 relaxed는 더 적게 넣을 수 있다 (정상) |
| Q11 | 두 안이 같으면 **1안 허용**. SRS FR-03 "2~3안"은 R1에서 "1~2안"으로 변경 (PM이 SRS 변경 이력에 기록) |
| Q12 | 닫는 정각에 끝나는 것 **허용** (`끝 ≤ 닫는 시각`). 일찍 도착하면 **기다릴 수 있다** (항목 시작 = 여는 시각, 기다린 시간은 `wait_min` 필드). 자정 넘어 닫는 곳은 `"26:00"`처럼 24 이상으로 표기(최대 `"29:59"`). `closed_at_time` = 그날 영업 구간 어디에도 최소 머무는 시간이 하루 범위 안에 들어갈 수 없음(그날 휴무 포함). `no_time` = 그 외 이유로 못 넣음 |
| Q13 | `hours=None`이면 무조건 `unknown`. `hours`가 있으면 데이터의 `hours_status`(`confirmed`/`unverified`)를 쓰고, 값이 `unknown`이면 `unverified`로 본다. 항목에는 이 판정값을 복사 |
| Q14 | 새 모델 **`PlanFixed`** (기존 `compose`의 `FixedEvent`와 별개): `id`, `title`, `start`, `end`, `place_id: id \| None`, `lat`, `lng` (장소 없으면 좌표도 없음). 장소 없는 고정 일정은 **직전 위치에서 그대로**(이동 0분)로 본다. 하루 시작은 숙소에서 출발, 첫 장소까지 이동 시간 포함 |
| Q15 | 꼭 갈 곳이 그날 영업시간 밖이면 `Infeasible(reason="must_visit_closed", blocking=[그 곳], suggest_drop=[])`. `Infeasible`에 `blocking: list[id]` 추가 |
| Q16 | 사용자 값은 범위 밖이어도 **15~300분이면 그대로 지키고**, 그 밖이면 15/300으로 자른다. 두 안 모두 같은 값. 사용자 값 때문에 꼭 갈 곳을 못 넣으면 `Infeasible(reason="user_stay_conflict", blocking=[바꾼 곳], suggest_drop=[...담은 곳])` |
| Q17 | `compose_greedy(plan, picks, places, buffer_min) -> list[CourseItem]` (한 줄). 숙소에서 시작해 **들어갈 수 있는 곳 중 가장 가까운 곳**을 차례로, 최소 머무는 시간 기준. AC-14는 **packed와 같은 조건(쉬는 5분, 최소 머무는 시간)**으로 비교하고, DP가 `Infeasible`인 입력은 비교에서 뺀다 |
| Q18 | 12개 = 꼭 갈 곳 + 담은 곳의 **합집합** (고정 일정 제외). 꼭 갈 곳은 담은 곳에 없어도 포함. 1초 기준은 **3번 실행의 중앙값**, `@pytest.mark.slow`로 표시 |

### 7-4. TASK-001 보강과 데이터 (A, fixture)
| Q | 결정 |
|---|---|
| Q19 | `compose_screen`으로 나올 수 없는 짝(T-14 등)은 **시험 대상에서 뺀다**. 비공개 함수는 직접 시험하지 않는다. 나올 수 없는 돌연변이는 "원래와 결과가 같은 것"으로 분류 |
| Q20 | 30곳 = `cafe` 4 · `food` 4 · `walk` 4 · `museum` 4 · `shop` 4 · `experience` 4 · `landmark` 3 · `night` 3. 중심 `(35.000, 135.000)`(가상), 모두 중심에서 3km 이내. 이름 규칙 `"<한글 설명> <대문자 한 글자>"`(예: "골목 카페 A")로, AC-17은 이 패턴으로 판정. 영업시간 모름 3(`hours=None`), 미확인 5, **나머지 22곳 확인됨** |

### 7-5. 다시 시작하는 방법
- 1차 테스트 커밋이 있으면 브랜치째 버리고, `main`에서 새 브랜치로 **새 test-writer**에게 맡긴다
- test-writer는 `docs/`와 저장소 코드만 본다. **저장소 밖 검색, `Claude outputs/` 읽기 금지** (CLAUDE.md)


## 8. 추가 질문 답변 (v3, 2026-11-04) — 이 절이 가장 우선
test-writer 2차가 테스트 403개를 쓰고 남긴 질문 Q21~Q40과 B6에 대한 결정

| Q | 결정 |
|---|---|
| B6 | 붐빔·가격 항은 **절댓값**: `−0.5 × |후보 값 − 좋아한 곳 평균|`. 측정 스크립트가 절댓값이었고 S1~S6를 모두 재현한다 (POC-001 §7-1 문구 보완) |
| Q21 | `places`는 `dict[id, Place]` |
| Q22 | `pick_directions`의 `batch`, `remaining`은 `list[Place]`. `next_batch`가 돌려주는 `Batch`는 id만 (호출하는 쪽이 바꿔 넘김) |
| Q23 | `pick_directions`에 `places: dict[id, Place]` 인자 추가 (좋아한 곳 태그를 찾기 위해). 최종 시그니처: `pick_directions(batch, remaining, reactions, places, last_direction, anchor, at)` |
| Q24 | 좋아한 곳이 없으면 `different`에 맞는 곳은 **없음** (비교할 취향이 없으므로) |
| Q25 | 직전 방향을 **먼저 빼고** 규칙 1 → 2 → 1곳 이상 순서로 채운다 (최대 3개가 되게) |
| Q31 | 남는 시간은 **5분 단위**로, 항목을 방문 순서대로 돌아가며 5분씩 목표(보통 또는 최대)까지 늘린다. 남는 5분 미만은 그대로 둔다 |
| Q32 | 사용자가 시간을 바꾼 곳은 **꼭 갈 곳처럼 유지**한다 (사용자의 뜻이 우선, AC-12와 같음) |
| Q33 | 꼭 갈 곳끼리 시간이 모자라면 `Infeasible(reason="must_visit_overflow", blocking=[꼭 갈 곳 전부], suggest_drop=[빼면 나머지가 들어가는 꼭 갈 곳들])` — 꼭 갈 곳도 제안에 들어간다 |
| Q34 | `closed_at_time`의 "하루 범위"는 **이동 제외** (`start`~`end`와 영업 구간만 본다). 이동 때문에 못 들어가면 `no_time`. 최소는 들어가지만 사용자 값이 안 들어가는 꼭 갈 곳은 `user_stay_conflict` |
| Q36 | AC-14는 **꼭 갈 곳·사용자 값이 없는 입력만** 비교한다. F46은 지운다 |
| Q26 | 거리는 하버사인 공식, 지구 반지름 6371km |
| Q27 | 시각은 `"HH:MM"` 문자열(내부 계산은 분). `date`는 날짜 타입. `DayPlan.end`도 `"29:59"`까지 허용 |
| Q28 | 장소 없는 고정 일정 항목: `place_id=None`, `hours_status=None`, `stay_source=None`. 고정 일정 앞뒤에는 **쉬는 시간을 넣지 않고 이동 시간만** |
| Q29 | `fixed_conflict` 유지. 판정 순서: ① 영업 구간에 최소가 안 들어가면 `closed_at_time` ② 들어가는 시간대가 모두 고정 일정과 겹치면 `fixed_conflict` ③ 그 외 `no_time` |
| Q30 | 고정 일정끼리 겹치거나 하루 범위 밖이면 **입력 오류(`ValueError`)**. 시간 안에 갈 수 없으면 `Infeasible(reason="fixed_unreachable")` |
| Q35 | `total_travel_min`은 **숙소 복귀 포함**. `seq`는 1부터. 두 안이 같으면 `relaxed`만 남긴다 |
| Q37 | 넣을 곳이 0곳이면 **빈 코스 1안**(`items=[]`, 숙소 복귀만). 빈 묶음은 `pick_directions`가 빈 목록 |
| Q38 | 공개 함수는 `engine/planning.py`. `demo_city.json` 맨 바깥은 `{"places": [...]}` |
| Q39 | 남은 후보가 5개 미만이면: `direction`은 받은 값 그대로, `direction_relaxed`는 맞지 않는 곳이 하나라도 섞이면 True. 채운 경우도 `direction`은 받은 값. `k`는 5 또는 6만 받는다 (아니면 `ValueError`) |
| Q40 | SCREEN-001 §5에 추가: 메인 T-03 → 보조 T-02, 메인 X-01 → 보조·칩 없음, 오프라인일 때 칩 없음 |


## 9. 마지막 질문 답변 (v4, 2026-11-04) — 이 절이 가장 우선
| Q | 결정 |
|---|---|
| Q41 | "1곳 이상" 단계는 **3개가 될 때까지** 채운다 (Q25 "최대 3개가 되게"와 같은 뜻). E9·E13·E14를 이 기준으로 고친다 |
| Q42 | 꼭 갈 곳이 `packed`에는 들어가고 `relaxed`에는 안 들어가면 **`packed` 1안만** 돌려준다 |
| Q43 | 담은 곳·꼭 갈 곳이 아닌 장소의 `stay_overrides`는 **무시** |
| Q44 | ① 시간을 바꾼 담은 곳이 그날 휴무면 `dropped(closed_at_time)` (꼭 갈 곳이 아니므로 Infeasible 아님) ② 꼭 갈 곳 1곳이 혼자서도 하루에 안 들어가면 `must_visit_overflow`, `blocking=[그 곳]`, `suggest_drop=[]` ③ Infeasible이 여러 이유에 걸리면 **`fixed_unreachable` → `must_visit_closed` → `must_visit_overflow` → `user_stay_conflict`** 순서로 첫 번째 ④ `user_stay_conflict`의 `suggest_drop`에는 **바꾼 곳 자신도 포함** (되돌리거나 빼는 선택지) |
| Q45 | ① `fixed_unreachable`: `blocking=[갈 수 없는 고정 일정 id]`, `suggest_drop=[]` ② 고정 일정 뒤 숙소 복귀가 하루 끝을 넘으면 `fixed_unreachable` ③ 시작 ≥ 끝이거나 `"29:59"`를 넘는 시각은 `ValueError` |
| Q46 | 장소 있는 고정 일정 항목: `hours_status`는 그 장소의 판정값(Q13), `stay_source=None` |
| Q47 | 남은 후보가 5개 미만일 때도 **방향에 맞는 곳을 먼저(점수순), 그다음 나머지(점수순)** |

## 10. 구현 후 결정 (v5, 2026-11-05) — 이 절이 가장 우선
reviewer가 찾은 §9 Q44② 위반과 backend가 문서 없이 정한 9가지에 대한 결정

### 10-1. "닫힘"과 "하루가 짧음"을 가르는 규칙 (Q34·Q44② 충돌 정리)
`L` = 하루 길이(`end − start`, 이동 제외). 장소의 필요 시간 `m` = 최소 머무는 시간(사용자가 바꾼 곳은 그 값)
1. `m > L`이면 → **하루가 짧음**: 꼭 갈 곳은 `must_visit_overflow`, 담은 곳은 `dropped(no_time)`
2. 아니고, 영업 구간을 하루 범위로 자른 어디에도 `m`이 안 들어가면 → **닫힘**: 꼭 갈 곳은 `must_visit_closed`, 담은 곳은 `dropped(closed_at_time)`
3. 그 외는 기존 규칙 (`fixed_conflict` → `no_time`)

### 10-2. 9가지 결정
| # | 상황 | 결정 |
|---|---|---|
| 1 | 영업 12:00~20:00, 하루 09:00~10:00인 꼭 갈 곳 | **지금대로 `must_visit_closed`** (10-1의 2번) |
| 2 | 꼭 갈 곳 큰 명소+카페, 하루 50분 | 꼭 갈 곳이 **2곳 이상이면 Q33 형식**: `must_visit_overflow`, `blocking=[둘 다]`, `suggest_drop=[큰 명소]`. Q44②의 "혼자서도 안 들어감" 형식은 꼭 갈 곳이 1곳일 때만 |
| 3 | 시간 바꾼 담은 곳 120분, 영업 60분 | **지금대로 `user_stay_conflict`** (`blocking=[그 곳]`, `suggest_drop`에 그 곳 포함). Q44①의 `closed_at_time`은 그날 **휴무**(영업 구간 없음)일 때만 |
| 4 | 꼭 갈 곳 없이 시간 바꾼 담은 곳만 못 들어감 | `user_stay_conflict`로 바꿈 (`must_visit_overflow` 아님) |
| 5 | 영업시간의 잘못된 값 (`"31:00"`, 여는 시각 ≥ 닫는 시각, 요일 0~6 밖) | **`ValueError`** (Q45③과 같은 입력 오류) |
| 6 | 사용자 값이 최소보다 짧음 (영업 20분, 사용자 15분) | **지금대로 들어감** (사용자 값이 그 곳의 필요 시간) |
| 7 | 고정 일정 장소를 담은 곳에도 넣음 | **한 번만 방문**: 고정 일정으로 방문한 것으로 보고 담은 곳에서 뺀다 (`dropped`에 넣지 않음) |
| 8 | 5분 미만 잔여 (최소 30, 보통 33) | **5분 단위만**: 한 번 늘리면 목표를 넘는 경우 늘리지 않는다 → 30에서 멈춤 (Q31 "5분 미만은 그대로") |
| 9 | 없는 장소 id | **`ValueError`** (어떤 id인지 메시지에) |

### 10-3. 그 밖
- **테스트 변경 추인**: E22·E26·F35·F53·F59·F60·F62·F38 수정, E29·E30 신규, `Infeasible.blocking` 타입 변경은 reviewer가 §9와 맞다고 확인했으므로 **승인**
- **주석**: §7~§10 결정에서 나온 규칙에는 `# TASK-002 §10 #2`처럼 근거 주석을 단다 (`planning.py:533·648·724` 포함)
- **동점일 때 고정 일정을 먼저 지나 카페가 앞 시간을 비우는 문제**: R1에서는 그대로 둔다 (PR 초안에 기록, R2 검토)
- **AC-18 (신규) DP vs 탐욕법 측정**: `apps/server/evals/dp_vs_greedy.py`(평가 코드, 실험 코드 아님 — ADR-013 `evals`)로 가상 도시에서 무작위 입력 **1000건**(꼭 갈 곳·사용자 값 없음, packed 조건, 시드 고정)을 돌려 **넣은 장소 수 평균·차이 분포, DP가 더 많이 넣은 비율, 이동 합 평균**을 `apps/server/evals/results/dp_vs_greedy.json`에 저장한다. 결과 숫자는 PR 설명에 적는다
- 저장소 밖 임시 파일(`/private/tmp/...`)은 시스템이 지우므로 그대로 둔다

### 10-4. 추가 결정 (11-05, Q55~Q61)
- **10-1의 `m`은 "사용자 값이 없을 때의 최소 머무는 시간"이다.** 사용자가 바꾼 값 때문에만 안 들어가는 경우는 10-1이 아니라 **항상 `user_stay_conflict`** (되돌리면 풀리는 문제)

| Q | 결정 |
|---|---|
| Q55 | 사용자 값이 하루 길이보다 김 → 꼭 갈 곳·담은 곳 모두 `user_stay_conflict` |
| Q56 | 꼭 갈 곳의 사용자 값이 영업 구간에 안 들어감 → `user_stay_conflict` (#3과 같은 처리) |
| Q57 | 바꾼 담은 곳 둘이 함께 못 들어감 → `blocking=[둘 다]`, `suggest_drop`에 둘 다 포함 |
| Q58 | 영업시간 검사는 함수에 넘어온 `places` **전부** (`compose_courses`, `next_batch` 모두). 잘못된 값이면 `ValueError` |
| Q59 | `stay_overrides`의 없는 id는 **무시** (Q43과 같음). `compose_greedy`의 없는 id는 `ValueError` (#9와 같음) |
| Q60 | 고정 일정 장소가 꼭 갈 곳에도 있으면 **고정 일정 방문으로 꼭 갈 곳을 채운 것**으로 본다 (한 번만 방문) |
| Q61 | AC-18의 이동 합은 **DP·탐욕법 모두 숙소 복귀 포함** (Q35 `total_travel_min`과 같은 기준). 탐욕법 값은 측정 코드에서 더한다 |
| 테스트 | #1·#3·#6을 고정하는 테스트 3개 추가, F87·F53을 Q55·Q56 값으로 수정 — **승인 범위에 포함** |
