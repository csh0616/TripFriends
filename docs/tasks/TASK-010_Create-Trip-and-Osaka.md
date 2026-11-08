# TASK-010 · 여행 만들기 + 오사카 데이터 (SC-01, 첫 실제 도시)

| 항목 | 내용 |
|---|---|
| 발행 | PM · 2026-11-09 |
| 상태 | **v1** |
| 관련 | ADR-015(장소 데이터 출처, **이 TASK의 근거**) · ADR-012 §3-3·§4 · SRS-001 FR-01, NFR-15 · SCREEN-001 SC-01·SC-03 · API-001 §2-1 · DATA-001 A·B · DESIGN-001 §4-7·§4-8·§4-9 · TASK-005 A3(꼭 갈 곳 5) · TASK-006 R10 |
| 브랜치 | `feat/task-010-create-trip` |
| 다음 | TASK-011 저장소(Supabase) + 실제 위치 |

> 가상 도시에서 만든 계획·여행 중 화면을 **실제 오사카 장소로 처음 돌린다.** 사용자가 직접 여행을 만들고(도시·날짜·숙소·꼭 갈 곳·고정 일정), 날짜 목록에서 각 날로 들어간다. 데모는 그대로 남긴다

## 0. 순서와 팀
| 순서 | 누가 | 할 일 |
|---|---|---|
| 0 | **PM → 결정권자** | `docs/data/osaka-seed.yaml` 초안(§S) → 결정권자 확인. **1~3은 이걸 기다리지 않는다** (테스트는 가짜 데이터) |
| 0 | **결정권자** | §K 키 두 개 만들기 |
| 1 | `test-writer` | §A~§E 테스트 + 요약표 → 승인 대기 |
| 2 | `backend` | §A·§B·§E 서버 몫 |
| 3 | `frontend` | §C·§D·§E 앱 몫 (2가 끝난 뒤, **같은 폴더 동시 실행 금지**) |
| 4 | 메인 세션 | 실제 키로 `places build osaka` 실행(§A2) → 채움 비율 측정(§A6) |
| 5 | `reviewer` | 점검 + Maestro 다섯 흐름(새 `create-trip` 포함) + 시뮬레이터 스크린샷 |

## 1. 범위
| 포함 | 제외 (다음 TASK) |
|---|---|
| 오사카 도시 팩(난바·신사이바시·우메다), Google Places·Serper 수집, 캐시 | Supabase 저장 (지금은 메모리 저장소 그대로 → **서버를 다시 켜면 여행이 사라진다**, 알려진 한계) |
| `POST /trips`, 고정 일정, 장소 검색(꼭 갈 곳·숙소) | 실제 GPS 위치 (TASK-011, 위치를 로그 밖으로 옮긴 뒤) |
| SC-01 여행 만들기, 빈 첫 화면, 날짜 목록 4상태 | 여러 여행 목록, 로그인 |
| 출처 표시 이름(ADR-015 §3-5) | Hot Pepper 등 추가 출처 (§A6 측정 뒤 결정) |

## S. 오사카 목록 (`docs/data/osaka-seed.yaml`, PM 작성·결정권자 확인)
- 50~80곳, 지역 3곳(`namba`·`shinsaibashi`·`umeda`), 카테고리 8종을 모두 포함
- 줄 하나 = `{id, name_ko, aliases[], query, area, category, stay{min,typical,max}, crowd_level 1~5, price_level 1~4, mood_tags[]}`
  - `id`: 우리 이름(`osaka-dotonbori` 등), 바뀌지 않음
  - `query`: Google 장소 검색에 넣을 문장(일본어 또는 영어 + "Osaka")
  - 나머지는 **우리가 정한 값** (`source_type="curated"`)
- 에이전트는 이 파일을 **읽기만** 한다 (`docs/` 규칙)

## K. 키 (결정권자)
| 키 | 어디서 | 제한 | 넣을 곳 |
|---|---|---|---|
| `GOOGLE_PLACES_API_KEY` | Google Cloud → **Places API (New)** 켜기 → 새 키 (지도 키와 **따로**) | API 제한: Places API (New)만 | `apps/server/.env` |
| `SERPER_API_KEY` | serper.dev (이미 있는 것) | — | `apps/server/.env` |
- 키 값은 Claude·Claude Code에 붙여 넣지 않는다. 에이전트는 `.env`를 읽지 않는다. 키가 없으면 서버는 **가짜 공급자로 켜지고** 경고 한 줄 (값은 찍지 않음)

## A. 도시 데이터 (`apps/server/places`)
| # | 할 것 |
|---|---|
| A1 | **공급자 인터페이스** `PlacesProvider`: `resolve(query, area) → place_id`, `details(place_id) → {location, opening_hours, website, maps_url, business_status}`, `search_lodging(q) → [{place_id, name, address_short}]`. 구현 둘: `GooglePlaces`(필드 마스크 필수, 필요한 필드만), `FakePlaces`(손으로 만든 `testdata/cities/osaka-fake.json`) |
| A2 | **만들기 명령** `uv run python -m places build osaka`: seed를 읽어 → `resolve`로 `place_id` → `details` → ① **도시 팩** `apps/server/places/packs/osaka.json` = seed 값 + `place_id`만 (**git에 올린다**, Google 값 없음) ② **캐시** `apps/server/.cache/places/osaka.json` = Google 값 + `fetched_at` (**gitignore**). `resolve`가 0곳·여러 곳이면 그 줄은 빼고 보고 |
| A3 | **Serper 보완** (ADR-015 §3-3 ②): `details`에 영업시간이 없을 때만, 만들기 명령 안에서 한 번 `"{query} 営業時間"` 검색 → 결과 문장에서 **시각 값만** 규칙(정규식)으로 뽑는다. 뽑은 값이 하나로 맞으면 `source_type="serper"`, `status="unverified"`, `source_url`=결과 링크. 못 뽑거나 값이 엇갈리면 `unknown`. **문장은 저장·로그하지 않는다** |
| A4 | **폐업**: `business_status`가 영구 폐업이면 팩에서 빼고 보고. 임시 휴업은 넣고 그 fact를 `unknown` |
| A5 | **캐시 수명**: 좌표 30일, 영업시간 24시간 (⚠️ ADR-015 §3-2). 서버 시작 때 캐시를 읽고, 계획 세션 시작 때 그날 후보 중 오래된 것만 다시 부른다. 다시 부르다 실패하면 이전 값을 쓰되 **`status`를 `unverified`로 내린다** (확인됨으로 보이지 않게) |
| A6 | **측정** (메인 세션, 실제 키): 만들기 결과 표 = 카테고리별 장소 수, 영업시간 채움 비율 **Google만 / + Serper**, 뺀 곳(검색 실패·폐업)과 이유, 호출 수. PR에 붙인다 (ADR-015 §3-4) |
| A7 | **호출 상한**: 만들기 한 번에 Google 300회·Serper 100회, 다시 부르기 한 번에 Google 30회. 넘으면 멈추고 보고. 요청 간격 0.1초 이상 |
| A8 | 엔진은 도시 팩 + 캐시를 **`demo_city.json`과 같은 모양**의 장소 목록으로 받는다 (엔진 코드는 그대로, NFR-15). 시간대는 도시 팩에 (`Asia/Tokyo`) |

## B. 여행 API
| # | 메서드·경로 | 규칙 |
|---|---|---|
| B1 | POST `/trips` | 본문 `{city_code, start_date, end_date, lodging_place_id?, must_visits: [{date, place_id}]}`. **꼭 갈 곳은 날마다** (API-001의 `must_visit_place_ids[]`를 바꾼다, PM이 API-001 고침). `city_code`는 `osaka`만 (데모는 seed로만). 기간 **1~7일**(가설), 시작일은 도시 시간대의 오늘~180일 뒤. 하루 꼭 갈 곳 6곳 이상, 팩에 없는 장소, 날짜 밖이면 400. 201 `Trip`(trip_days, 날마다 `state`) |
| B2 | 여행 하나만 | 같은 기기(`X-Device-Id`)에 여행이 있으면 새로 만들 때 이전 여행은 `status=archived` (지우지 않음). GET `/trips/current` → 지금 여행 또는 404 |
| B3 | POST `/trips/{id}/fixed-events` · DELETE `/fixed-events/{id}` | `{trip_day_id, title, start_at, end_at, place_id?}`. 그날 안, 끝 > 시작, 같은 날 겹치면 400. 제목 1~30자. 이미 계획을 고른 날이면 **409 `PLAN_EXISTS`** (고른 코스를 몰래 바꾸지 않는다, FR-13) — 앱은 "계획을 다시 짜야 해" 안내 |
| B4 | GET `/places/search?city_code&q` | 팩 안에서 `name_ko`·`aliases` 부분 일치, 최대 10개, 한 글자부터. 장소 값은 `facts` 형식 + `image`(카테고리, §C5) |
| B5 | GET `/places/lodging-search?city_code&q` | **Google 실시간** (숙소는 팩 밖). 두 글자부터, 결과 5개, 도시 중심 반경 안으로 치우침. 고른 숙소는 `place_id`만 여행에 저장하고 좌표는 캐시(30일) |
| B6 | 날 상태 `state` | `planning`(계획 전) · `planned`(계획 완료) · `today`(오늘·여행 중) · `past`(지난 날). 도시 시간대 날짜로 계산, 데모 날은 데모 시계 (TASK-006). **매번 계산하고 저장하지 않는다** |
| B7 | 출처 | 모든 장소 `facts`에 ADR-015 §3-1의 `source_type`. 머무는 시간은 `curated` |

## C. 앱 화면
| # | 화면 | 규칙 |
|---|---|---|
| C1 | **첫 화면** | 앱 시작 → GET `/trips/current`. 404면 빈 상태 + 주 버튼 [여행 만들기] (DESIGN-001 §4-9). 데모 버튼들은 **개발 빌드에서만** 그 아래 보조로 |
| C2 | **SC-01 여행 만들기** | 한 화면에 순서대로: 도시(오사카 표지, 고를 것 없음) → 날짜(시작·끝, `field` 64) → 숙소(선택, 검색 B5) → 꼭 갈 곳(선택, 날 탭 `tab-day` + 검색 B4, 하루 5곳) → 주 버튼 [여행 만들기] 52. 날짜가 없으면 비활성 + 이유 한 줄 |
| C3 | **날짜 목록** (SC-03 위) | DESIGN-001 §4-9: 날 줄마다 알약 + 글자. `planning` → 계획 대화 · `planned` → 고른 코스 · `today` → 여행 중 화면 · `past` → 고른 코스 읽기만. 날 줄에 고정 일정 [+ 일정] → 시트(`sheet-form` 500) |
| C4 | **오늘(실제 여행)** | 실제 위치는 아직 없다 → 여행 중 화면은 **시계만** 쓴다: 다음 일정·고정 일정 임박(T-07)·영업 확인(T-05)은 시각으로, 위치가 필요한 늦어짐 감지는 꺼짐 (화면에 표시 안 함) |
| C5 | **장소 그림** | `placeholderFor`를 DESIGN-001 §4-8 체계로 바꾼다 (`docs/design/place-images/`). 오사카 표지는 `landmark` 색 + 도시 그림 |
| C6 | **출처 이름** | ADR-015 §3-5 표로 (TASK-009 B3 함수 확장) |
| C7 | 데모 버튼 | 실제 여행의 날에는 데모 시계·데모 버튼이 **없다** (TASK-006 R10의 빈틈을 이 TASK에서 시험) |

## D. Maestro
- 새 흐름 `create-trip.yaml`: 빈 첫 화면 → 날짜 → 꼭 갈 곳 1곳 → [여행 만들기] → 날짜 목록 → 첫날 계획 대화 시작. 서버는 **`PLACES_PROVIDER=fake`**(가짜 오사카)로 켠다 → 결과가 늘 같다
- 기존 네 흐름(`planning`·`trip-now`·`trip-delay`·`trip-closed`)은 데모 그대로 통과

## E. 넘어온 것 (작게)
| # | 할 것 | 누가 |
|---|---|---|
| E1 | 고르기 토큰(`sel-*`, `radio`, `action-bar` 등)을 `tokens.json`으로 옮김 (화면에 직접 적힌 값 0) | frontend |
| E2 | `trip/retime.py` 살아남은 돌연변이 2개("영업시간 모름 = 하루 종일 열림" 경계) 테스트 | test-writer |
| E3 | 조사 표에 영문 **소문자** l·m·n·r 추가 (대문자와 같게) | test-writer |
| E4 | Maestro `trip-now` 탭 재시도: 이번엔 **reviewer 실행만 재현되는 조건**(시뮬레이터 상태·실행 순서)을 기록 | reviewer |
| E5 | 서버 요청 로그에서 위치 값이 찍히지 않는지 테스트 (TASK-011 실제 GPS 전 바닥) | test-writer |

## 6. 실패하면
| 상황 | 결과 |
|---|---|
| Google·Serper 키 없음 | 가짜 공급자로 시작 + 경고 한 줄, 숙소 검색은 "지금 숙소 검색을 못 해" + 건너뛰기 가능 |
| 숙소 검색 실패·시간 초과(3초) | 같은 안내. 여행 만들기는 숙소 없이 가능 |
| 캐시 다시 부르기 실패 | 이전 값 + `unverified` (A5), 계획은 계속 |
| `POST /trips` 400 | 틀린 칸에 `field-error` + 문장, 입력값은 그대로 |
| `POST /trips` 끊김·500 | 아무것도 만들어지지 않음 (원칙: 실패한 요청은 아무것도 바꾸지 않는다). 다시 누르면 새로 만든다 |
| 서버를 다시 켜서 여행이 없어짐 | `/trips/current` 404 → 빈 첫 화면 (알려진 한계, TASK-011) |

## 7. 완료 기준
| ID | Then |
|---|---|
| AC-1 | 서버·앱 테스트 통과(`slow` 따로), tsc 0. **테스트는 실제 Google·Serper를 부르지 않는다** (네트워크 막고 통과) |
| AC-2 | 저장소에 Google 응답 값 0 (도시 팩·테스트 데이터 검사: 좌표·영업시간 필드 없음), `.cache/` gitignore |
| AC-3 | A3: 시각을 뽑은 문장 표(손으로 만든 예 20개 이상: 일본어 `11:00～22:00`, `定休日`, 엇갈림, 없음)를 통과, 문장 저장 0 |
| AC-4 | B1~B3 경계(기간 0·1·7·8일, 꼭 갈 곳 5·6, 겹치는 고정 일정, 계획 고른 날 409)와 실패 표 |
| AC-5 | B6 날 상태 4가지를 시계 경계(자정, 도시 시간대)로 |
| AC-6 | §A6 측정표가 PR에 (실제 키 실행 결과) |
| AC-7 | Maestro 다섯 흐름 통과, 시뮬레이터 스크린샷: 빈 첫 화면 · SC-01 · 날짜 목록 4상태 · 오사카 후보 카드(출처 "Google 지도") |
| AC-8 | 결정권자 폰 확인: 오사카 여행 만들기 → 첫날 계획 대화에서 **실제 오사카 장소**가 나오고 → 코스 고르기 → 날짜 목록에서 "계획 완료" |

## 8. 하지 말 것
- Google 응답·Serper 결과 문장을 git·로그에 남기기, 리뷰·사진 가져오기
- 앱 사용자 요청마다 Serper 부르기 (ADR-015 §3-3)
- 키 값 출력·`.env` 읽기, `docs/` 수정, 저장소 밖 검색, 이름으로 프로세스 끄기, 두 에이전트 같은 폴더 동시 실행

## 포트폴리오 포인트
- 남의 데이터(Google)와 우리 데이터(목록·머무는 시간)를 **파일부터 나눠** 약관을 구조로 지킴 → "저장소에 Google 값 0"을 테스트로 증명
- 가짜 공급자로 테스트·Maestro는 늘 같은 결과, 실제 키는 측정에만
- 영업시간 채움 비율을 재서 다음 출처를 정함 (ADR-015 §3-4)

| 예상 면접 질문 | 답 |
|---|---|
| "외부 API에 의존하는 기능을 어떻게 테스트했나요?" | 공급자 인터페이스 하나에 실제·가짜 구현을 두고, 테스트는 네트워크를 막고 가짜로. 실제 키는 측정 명령에서만 썼다 |
| "영업시간이 비어 있으면?" | 공식 API → 검색 결과에서 값만(미확인) → 그래도 없으면 '모름'. 모르면 가기 전에 사용자에게 확인을 묻는다. 채움 비율은 측정값으로: (측정 후) |
