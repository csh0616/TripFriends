# TASK-004 · 계획 화면 3장 (앱 첫 화면) + 서버 소작업

| 항목 | 내용 |
|---|---|
| 발행 | PM · 2026-11-06 |
| 상태 | **v1** — 결정권자 승인 후 `/run-task TASK-004` |
| 관련 | DESIGN-001 §4(토큰, 유일한 출처) · TASK-003 §5·§6·§10(API 계약) · SCREEN-001 P-01~P-06 · SRS-001 FR-02~03·07a · ADR-013 |
| 브랜치 | `feat/task-004-planning-screens` |
| 다음 | TASK-005 여행 중 화면 (지도 + 카드 시트) |

> TASK-003에서 배운 것 두 가지를 처음부터 적는다: **실패하면 어떻게 되나**(§7), **두 규칙이 겹치면 무엇이 이기나**(§6-4). 표에 없는 동작은 만들지 말고 질문으로 돌려준다

## 0. 순서와 팀
| 순서 | 에이전트 | 할 일 | 의존 |
|---|---|---|---|
| 1 | `test-writer` | §A 서버 테스트 + §B 앱 로직·가드레일 테스트 + 요약표 → 승인 대기 | — |
| 2 | `backend` | §A (작음) | 승인 |
| 3 | `frontend` | §B. §A가 머지되거나 같은 브랜치에서 끝난 뒤 시작 (응답 모양이 바뀜) | 2 |
| 4 | `reviewer` | 점검. 특히 토큰 밖 색·크기, 가드레일, §7 실패 표 | — |

## A. 서버 소작업 (`backend`)
| # | 할 것 |
|---|---|
| A1 | **`GET /planning/{session_id}`** → 200, 지금 stage의 응답을 다시 준다: asking → `PlanningSession`, browsing → `CandidateBatch`(지금 묶음, 원칙 2로 다시 계산), composing → `CourseResult`(지금 `option_ids`), done → `{day_id, option_id, stage:"done"}`. 상태·저장소는 바뀌지 않는다. 없으면 404 |
| A2 | `PlanningSession`·`CandidateBatch`·`CourseResult`에 **`day` 요약** 필드 추가: `{day_id, day_number, date, start, end, lodging:{lat,lng}, must_visits:[{place_id, name}], fixed:[{place_id, name, start, end}]}`. 값은 저장소의 하루 데이터 그대로 |
| A3 | `CourseItem` 응답에 **`name`** 추가 (앱이 장소 이름을 다시 찾지 않게). `Dropped`에도 `name` |
| A4 | Q49: `/debug/compose`의 본문 오류도 400 `INVALID_REQUEST` 공통 형식 |
| A5 | 타입 재생성 (`packages/api-types`) |
- 401·403의 `code`는 로그인 TASK에서 정한다 (이번에 만들지 않음)

## B. 앱 (`frontend`, `apps/mobile`, `packages/design-tokens`)

### B-1. 디자인 토큰
- `packages/design-tokens/tokens.json` = DESIGN-001 §1·§2·§4 값 **그대로** (색·글꼴·크기·간격·컨트롤·모서리·그림자·움직임). TS로 읽는 `index.ts`와 `README.md`(쓰는 규칙·금지)
- 앱 코드는 **토큰만** 쓴다. `apps/mobile/src`에 색 hex, 숫자 글자 크기·모서리 값을 직접 쓰지 않는다 (테스트로 검사, §B-6 G1)
- 글꼴: Noto Sans KR(400·500·600·700) + DM Mono(500). `@expo-google-fonts/*`로 번들 (네트워크 없이 표시)
- 그림자는 RN 스타일로 옮긴다 (`sh-float`, `sh-sheet`). 정확히 같지 않아도 된다

### B-2. 화면 흐름
```
시작(S0) ─[데모 여행 시작]→ 첫 질문(P1) ─[이걸로 찾아 줘]→ 후보 고르기(P2) ─[코스 짜기]→ 코스안(P3) ─[이걸로 할래]→ 완료(S9)
                                    └[알아서 짜 줘]──────────────────────────→ P3
                                                    P3 ─[더 고를래]→ P2
```
- 화면 전환은 **서버 응답의 `stage`가 정한다** (asking→P1, browsing→P2, composing→P3, done→S9). 앱이 stage를 혼자 바꾸지 않는다
- S0: `POST /debug/seed-demo` → **둘째 날** `day_id`로 `POST /days/{id}/planning {mode:"conversation"}`. 받은 `session_id`를 기기에 저장 (`@react-native-async-storage/async-storage`)
- 앱을 다시 켜면: 저장된 `session_id`가 있으면 `GET /planning/{id}`로 이어 간다. 404면 저장값을 지우고 S0
- S9 완료: "코스 저장했어" + [처음부터] (저장값 지우고 S0). 여행 중 화면은 TASK-005

### B-3. 공통 틀 (모든 화면, 가드레일)
| 부품 | 규칙 |
|---|---|
| 머리 `Header` | 높이 52. 왼쪽 뒤로(44 원), 가운데 제목 17/600 + 부제 13/500 muted, **오른쪽 SOS 44 원 `danger` 고정**. 안전 영역 아래 |
| SOS | 모든 화면 같은 자리. 누르면 R1은 시트 "긴급 도움은 준비 중이야" + [닫기]. `danger` 색은 SOS에만 |
| 입력창 `InputBar` | **화면 맨 아래 고정**, 높이 48, `bg-2`, 모서리 16, 오른쪽 말하기 버튼 48 원(`ink` 바탕, 흰 아이콘). 키보드가 올라오면 키보드 위. 마이크는 R1에서 비활성(누르면 "곧 돼") |
| 친구 말풍선 `FriendBubble` | 아바타 32 + `bg-2` 말풍선, 모서리 20(왼쪽 아래 6), body 15/22. 서버 `message`·`question.text`를 그대로 보여 준다 |
| 떠 있는 줄 `FloatingBar` | 입력창 바로 위, 모서리 24, `sh-float`, 높이 72. 주 버튼은 오른쪽 |
| 주 버튼 | 높이 52, `brand` 바탕 + **`on-brand` 글자**(흰 글자 금지), 모서리 16. 보조 버튼은 `bg-2` + ink |

### B-4. 화면별 (이 문서와 DESIGN-001만 근거. 디자인 캔버스 "Tripfriends UI v1"은 저장소 밖이라 결정권자가 폰 화면과 비교할 때만 본다)
**P1 첫 질문 (캔버스 보드 5)** — `PlanningSession`
- 친구 말풍선 = `question.text`. 보기 = `question.choices` 6개를 **2열 사진 타일**(높이 108, 모서리 20)로. 사진 대신 **종류별 그라데이션 자리표시**(§B-5). 아래 왼쪽에 흰 알약 라벨
- 여러 개 고름. 고른 타일 = 흰 2px + `brand` 2.5px 고리, 라벨 앞 체크, 굵게 (`dur-draw` 동그라미)
- 오늘 시간표 카드(`bg-2`, 모서리 24): `day.start~end`, 막대에 꼭 갈 곳·고정 일정 구간(ink), "{시각} {이름}은 먼저 넣어 뒀어". 꼭 갈 곳이 없으면 이 줄을 숨김
- 아래: [알아서 짜 줘](보조, `answer{auto:true}`) · [이걸로 찾아 줘](주, `answer{choice_ids}`). 칩을 하나도 안 골랐으면 [이걸로 찾아 줘]는 "아무거나 찾아 줘"로 글자만 바뀐다(거르지 않음, §4-1)
- 입력창에 글을 보내면 `answer{choice_ids: 지금 고른 것, text}` (§10-10 R7)

**P2 후보 고르기 (캔버스 보드 6)** — `CandidateBatch`
- 친구 말풍선 = `message`. 위에 방향 칩 줄 = `directions` (가로 스크롤, 높이 36, 누르는 영역 44). 누르면 `next{direction_id}`
- 후보 카드 **가로 캐러셀**(카드 폭 = 화면 − 72, 다음 카드가 오른쪽에 보임). 카드: 사진 자리표시(높이 316, 모서리 20, 왼쪽 위 "03 / 06" DM Mono 알약) → 이름 17/600 → `why` 15/22 → [패스 44 원 `bg-2`] [담기 44 원 `ink`] → 상태 칩 + 오늘 영업 값 + **숙소에서 거리**(§B-5 `distanceLabel`)
- 담기 = `reactions like`, 담은 카드는 사진에 `brand` 동그라미 + 담기 버튼이 체크로(다시 누르면 `unlike`). 패스 = `reactions skip` 후 다음 카드로 넘김
- 마지막 카드 다음에 **끝 카드**: "다른 곳도 볼래?" + [다른 곳 보여 줘](`next{}`). `exhausted=true`면 끝 카드 문구 = 서버 `message`, 버튼은 [코스 짜기]만 강조
- 되묻기: `clarify`가 있으면 말풍선 아래에 `clarify` 칩을 방향 칩 대신 보여 준다 (누르면 `next{direction_id}`)
- 떠 있는 줄: 담은 곳 사진 동그라미(최대 3개 + 빈 자리) + "{picks_count}곳 담았어" + [코스 짜기](`compose`)
- 입력창 글 = `next{text}`

**P3 코스안 (캔버스 보드 7)** — `CourseResult`
- 머리 제목 "코스 짜 봤어", 부제 "{n}째 날 · {items 수}곳"
- 코스 종류 토글: `options`의 `label` → relaxed "느긋하게", packed "꽉 채워서" (안이 1개면 토글 숨김)
- 동선 그림(높이 120, 모서리 20): 지도 SDK 없이 **`react-native-svg`로 그린 도식**. 숙소 + 장소 lat/lng를 상자에 맞춰 투영(§B-5 `projectRoute`), 순서대로 `brand` 선, 번호 원(ink). 실제 지도는 TASK-005
- 요약 줄: "{n}곳 · 이동 {total_travel_min}분"
- 순서 목록: 시각(DM Mono) · 번호 원 · 이름 + 보조(꼭 갈 곳/고정 일정, 이동 분) · 오른쪽 머문 시간("1시간 30분"). 머문 시간을 누르면 그 줄이 펼쳐져 [−15][+15] (`adjust{option_id, place_id, delta}`). **고정 일정 줄은 버튼 없음**(§10-10 R6). `stay_source=user`면 시간 옆에 "바꿈" 표시
- 점검 카드(`bg-2`): `dropped`가 없으면 "빠진 곳 없어", 있으면 "{n}곳은 못 넣었어" + 이름·이유(closed_at_time "그 시간엔 닫혀", no_time "시간이 모자라", fixed_conflict "다른 일정과 겹쳐"). 다음 줄 "숙소까지 {go_home_min}분"
- 떠 있는 줄: [더 고를래](`back`) · [이걸로 할래](`select`, 지금 보이는 안의 `option_id`)

### B-5. 순수 함수 (TDD, `apps/mobile/src/lib/`)
| 함수 | 하는 일 |
|---|---|
| `screenFor(response)` | 응답 → 화면 이름 (stage 기준). 모르는 stage면 오류 |
| `planningReducer(state, action)` | 요청 시작·성공·실패를 상태로. 요청 중 표시, 마지막 응답, 오류 메시지, 담은 곳 |
| `distanceLabel(from, to)` | 직선거리(하버사인) → "숙소에서 650m" / "숙소에서 1.2km" (1km 미만 m 단위 10m 반올림, 이상 소수 한 자리). **걷는 시간은 쓰지 않는다**(데이터 없음) |
| `formatStay(min)` | 90 → "1시간 30분", 60 → "1시간", 45 → "45분" |
| `todayHoursText(facts)` | opening_hours fact → 화면 글자 + 상태 칩 종류. null + confirmed = "오늘 휴무"(확인됨), null + unverified = "오늘 휴무"(미확인), null + unknown = "영업시간 모름"(모름) — TASK-003 §10-9 |
| `projectRoute(points, w, h, pad)` | lat/lng 목록 → 상자 안 좌표. 한 점이면 가운데, 모든 점이 상자 안 |
| `placeholderFor(category)` | 종류 → 자리표시 그라데이션 두 색 (차가운 톤, 토큰 아님): food `#8FA3B8→#4F6479` · cafe `#B7B2C7→#6E6A85` · walk `#D3CABB→#8D8576` · night `#5D6B8A→#2F3A55` · shop `#D9B8B4→#96706C` · museum·experience `#9DB8BF→#547882` · landmark `#BBC2CA→#737C88` |
| `contrast(fg, bg)` | WCAG 대비 계산 (G2 테스트용) |

### B-6. 가드레일 테스트 (앱 TDD는 로직·가드레일만, 겉모습은 폰 + 스크린샷)
| # | 검사 |
|---|---|
| G1 | `apps/mobile/src`(테스트 제외)에 `#RRGGBB`·`rgb(` 글자가 없다. 색은 토큰으로만 (자리표시 그라데이션은 `placeholderFor`의 한 파일만 예외) |
| G2 | 토큰에 적힌 **글자/바탕 조합 전부** 대비 ≥ 4.5 (DESIGN-001 §4-4 목록을 테스트 데이터로) |
| G3 | 누르는 부품(버튼, 칩, 타일, 카드 버튼, 머문 시간)의 누르는 영역 ≥ 44 (스타일 또는 `hitSlop` 합) |
| G4 | 모든 계획 화면에 SOS가 같은 testID로 있고, 입력창이 있다 |
| G5 | `danger` 토큰은 SOS 부품에서만 import된다 |
| G6 | 상태 칩은 색 + **글자**(확인됨/미확인/모름)를 항상 같이 보여 준다 |
| G7 | 주 버튼 글자색은 `on-brand` |

## 6. 규칙이 겹칠 때
| 겹침 | 이기는 것 |
|---|---|
| 서버 `message`와 앱 고정 문구 | 서버 `message`. 앱 문구는 끝 카드·빈 상태처럼 서버가 주지 않는 곳에만 |
| `clarify`와 `directions` | `clarify`가 있으면 그 칩만 보인다 |
| `exhausted`와 끝 카드 | `exhausted`면 [다른 곳 보여 줘] 대신 [코스 짜기] 강조 (next는 여전히 가능) |
| 사용자가 연타 | 요청 중이면 그 화면의 서버 요청 버튼을 모두 막는다 (한 번에 한 요청) |
| 서버 응답 stage와 지금 화면 | 응답 stage가 이긴다 |

## 7. 실패하면 (처음부터 정함)
| 상황 | 앱이 하는 것 | 상태 |
|---|---|---|
| 네트워크 끊김·시간 초과(10초) | 말풍선 아래 "연결이 안 돼. 다시 해 볼까?" + [다시] (같은 요청) | 화면·담은 곳 그대로 |
| 400 `INVALID_REQUEST` | "다시 해 볼래?" (앱 버그라서 로그만, 사용자에게 자세히 안 보임) | 그대로 |
| 404 (세션 없음) | 저장값 지우고 S0, "처음부터 다시 하자" | S0 |
| 409 `STATE_CONFLICT` | `GET /planning/{id}`로 지금 상태를 다시 받아 그 화면으로 | 서버 기준 |
| 422 `COURSE_INFEASIBLE` | `detail.reason`별 문구: must_visit_closed "{이름}이 그날 쉬어", must_visit_overflow "꼭 갈 곳이 하루에 다 안 들어가", user_stay_conflict "그 시간은 안 맞아". P2·P3 그대로 | 그대로 (서버도 그대로, 원칙 1) |
| 500 `INTERNAL_ERROR` | "잠깐 문제가 생겼어" + [다시] | 그대로 (서버도 그대로) |
| 앱이 요청 중에 꺼짐 | 다시 켜면 GET으로 이어 감 | 서버 기준 |
| 글꼴 로드 실패 | 시스템 글꼴로 표시 (막지 않음) | — |

## 8. 완료 기준
| ID | Given | When | Then |
|---|---|---|---|
| AC-1 | 전체 | `uv run pytest`, `pnpm --filter mobile test` | 모두 통과 (TASK-001~003 포함) |
| AC-2 | §A | GET /planning | stage별 응답 모양 = TASK-003 §6 + `day`, 상태·저장소 그대로, 없으면 404 |
| AC-3 | §A | 모든 성공 응답 | `day` 요약이 저장소 값과 같다, CourseItem·Dropped에 `name` |
| AC-4 | 토큰 | `tokens.json` | DESIGN-001 §4 표의 모든 이름·값과 같다 (테스트가 표를 데이터로 비교) |
| AC-5 | §B-5 | 순수 함수 | 표대로 (fast-check: `projectRoute` 모든 점이 상자 안, `distanceLabel` 단조, `formatStay` 15~300) |
| AC-6 | §B-6 | G1~G7 | 모두 통과 |
| AC-7 | 흐름 | 가짜 서버(fetch mock)로 S0→P1→P2→P3→S9 | 각 단계에서 맞는 요청 본문을 보내고, 응답 stage대로 화면이 바뀐다 |
| AC-8 | P2 | 담기·패스·취소 | `like`·`skip`·`unlike` 요청, 떠 있는 줄 숫자는 서버 `picks_count` |
| AC-9 | P3 | ±15 | `adjust`에 지금 보이는 안의 `option_id`, 고정 일정 줄엔 버튼 없음 |
| AC-10 | §7 | 실패 표의 각 줄 | 표대로 (줄마다 테스트) |
| AC-11 | §6 | 겹침 표의 각 줄 | 표대로 |
| AC-12 | 재실행 | 저장된 session_id | GET으로 같은 화면, 404면 S0 |
| AC-13 | 폰 | Expo Go에서 S0→S9 한 바퀴 | 결정권자가 보고 **스크린샷 4장**(P1·P2·P3·S9)을 PR에 첨부 |
| AC-14 | 돌연변이 | Stryker, §B-5 함수 | 80% 이상 (첫 측정, 결과를 PR에) |

## 9. 하지 말 것
- 실제 지도 SDK·위치 권한 (TASK-005), 사진 수집, 로그인
- 토큰 밖 색·크기, `docs/` 수정, 저장소 밖 검색
- 서버 계약에 없는 필드를 앱이 가정하기 → 질문으로
- `EXPO_PUBLIC_` 변수에 비밀 값 (API 주소만 허용)

## 10. 폰에서 보기 (결정권자용, frontend가 PR에 한 줄씩 설명)
- 폰과 Mac이 같은 Wi-Fi. 서버는 `uv run fastapi dev api/main.py --host 0.0.0.0`, 앱은 `apps/mobile/.env.local`의 `EXPO_PUBLIC_API_URL=http://<Mac IP>:8000`, `pnpm --filter mobile start` → Expo Go로 QR

## 11. 학습 카드 (결정권자용)
1. **지도**: 앱은 "화면을 그리는 쪽", 흐름의 주인은 서버 그래프. 앱은 응답의 `stage`를 보고 화면을 고른다
2. **핵심 개념**: 디자인 토큰(이름 붙인 값 = 유일한 출처) · 가드레일을 테스트로 고정 · 낙관적 갱신을 하지 않는 이유(서버 숫자가 진실)
3. **직접 해보기**: 토큰의 `brand` 값을 바꿔 보고 화면이 한꺼번에 바뀌는지, G1 테스트가 hex를 잡는지
4. **내 말로**: "왜 앱이 stage를 혼자 바꾸지 않나?" / "색 hex를 직접 쓰면 무엇이 문제인가?"

## 포트폴리오 포인트
- 디자인 결정(DESIGN-001 §4) → 토큰 파일 → 코드, 그리고 **토큰 밖 값을 테스트가 잡는다** (G1·G2). 접근성 기준(대비 4.5, 터치 44)을 숫자로 검증
- 실패 표를 구현 전에 정해 테스트로 고정 (TASK-003 R1 교훈)
- 예상 면접 질문: "디자인 시스템을 코드에서 어떻게 지켰나요?" → "토큰 JSON 하나만 출처로 두고, 앱 코드에 hex가 들어오면 테스트가 실패하게 했다. 대비도 토큰 조합 전부를 테스트로 계산했다"
