# TASK-002 · 계획 엔진: 후보 점수 · 방향 해석 · 다음 묶음 · 코스 계산(DP)

| 항목 | 내용 |
|---|---|
| 발행 | PM · 2026-11-03 |
| 상태 | **대기** — 결정권자 승인 후 `/run-task TASK-002` |
| 관련 | SRS-001 FR-02a~c·03·07·07a, NFR-04 · SCREEN-001 §2(머무는 시간) · GRAPH-001 §2 · ADR-011 B·C · POC-001 §5-1·§7-1 · DATA-001 |
| 브랜치 | `feat/task-002-planning-engine` |
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
| AC-3 | B, POC-001 §7 측정 데이터(H1~H10, P1~P12, S1~S6)를 테스트 fixture `poc_c.json`으로 | `score_candidates` | 상위 3곳이 측정 때 규칙 결과와 같음: S1 P7·P11·P1 / S2 P7·P1·P11 / S3 P6·P10·P4 / S4 P11·P9·P2 / S5 P11·P8·P1 / S6 P1·P3·P7 (순서 포함, 측정 재현) |
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
