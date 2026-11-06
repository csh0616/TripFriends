# TASK-006 · 여행 중 화면 1차 (지도 + 카드 시트, 데모 시계) + 화면 자동 확인

| 항목 | 내용 |
|---|---|
| 발행 | PM · 2026-11-07 |
| 상태 | **v1** — 결정권자 준비(§0) 끝난 뒤 `/run-task TASK-006` |
| 관련 | SCREEN-001 §2·§3-2·§4·§5·§6 · ADR-014(Google 지도) · API-001 §2-3 · TASK-001(`compose_screen`) · TASK-004·005(계획 화면) · DESIGN-001 §4 |
| 브랜치 | `feat/task-006-trip-now` |
| 다음 | TASK-007 사건(늦어짐·닫힘) 감지와 대안 카드 (T-04~T-07, G2) |

> 이번 범위는 **사건 없는 하루**: 저장한 코스를 데모 시계로 앞으로 돌리며 지도와 카드가 시각에 맞게 바뀌는 것. 늦어짐·닫힘·근처 추천은 다음 TASK

## 0. 결정권자 준비 (에이전트 시작 전, PM이 한 줄씩 안내)
1. Google Cloud: 프로젝트 → 결제 계정 연결 → **Maps SDK for iOS** 사용 설정 → API 키 만들기 → **iOS 앱 제한**(번들 ID `com.csh0616.tripfriends`)
2. 키를 `apps/mobile/.env.local`에 `GOOGLE_MAPS_IOS_API_KEY=...`로 직접 저장 (`open -e`로 열어서). **키를 채팅·Claude Code에 붙여 넣지 않는다**
3. Xcode 설치 확인, Xcode에 Apple ID 로그인 (무료 계정, 폰 설치용)

## 1. 순서와 팀
| 순서 | 에이전트 | 할 일 |
|---|---|---|
| 1 | `test-writer` | §A 서버 + §B 앱 로직·가드레일 + §D 첫 작업 테스트 → 승인 대기 |
| 2 | `backend` | §A |
| 3 | `frontend` | §B·§C·§D (§A 응답 모양이 정해진 뒤) |
| 4 | `reviewer` | 점검 + **§C Maestro 흐름을 시뮬레이터에서 돌려 스크린샷 첨부** |

## A. 서버: `GET /days/{day_id}/now` (`backend`)
| # | 할 것 |
|---|---|
| A1 | `GET /days/{day_id}/now?at=<ISO 시각>&lat=&lng=` → 200 `NowView`. 고른 코스(`select`된 안)가 없으면 404 `resource="course"`. 위치는 **저장하지 않는다** |
| A2 | `Snapshot` 만들기: `at`과 고른 코스로 지금 일정·다음 일정·이동 중·도착 직전·고정 일정·남은 일정 수. **이번에 만들지 않는 카드로 가는 신호는 중립값**: `open_events=[]`, `meal_eaten=True`, `rain_prob_2h=0`, `walked_km=0`, `outdoor_remaining=False`, `chat_pick=None`, `offline=False`, `safety=False` |
| A3 | `compose_screen(snapshot)` 결과를 그대로 쓴다. 단 결과 카드가 **지원 목록(T-01·T-02·T-03·T-07·T-08) 밖이면 T-01로 바꾸고** 보조는 §5 짝 표대로, 칩은 `null` (안전장치, 로그) |
| A4 | 카드 값 채우기 (§A-1 모양) |
| A5 | `/debug/seed-demo`에 **`chosen: true`** 옵션: 둘째 날을 자동으로 계획·선택까지 해 둔다 (데모 시계 화면을 바로 열 수 있게) |
| A6 | 타입 재생성 |

### A-1. `NowView` 모양
```json
{ "day": DaySummary, "at": "2026-12-02T13:20:00",
  "status": "on_track",               // compose의 move_status
  "status_text": "동선대로 가는 중",    // on_track / delayed "늦어지는 중" / free "다음까지 여유 있음"
  "reason": "...",                    // compose의 reason
  "main": Card, "subs": [Card],       // 최대 3
  "chip": null,
  "pins": [ {"seq":1,"place_id":"D01","name":"…","lat":0,"lng":0,"state":"done|now|next|later"} ],
  "route": { "done": [[lat,lng]], "remaining": [[lat,lng]] },   // 숙소 → 1 → 2 … → 숙소
  "position": {"lat":0,"lng":0} | null }
```
| 카드 `type` | 값 |
|---|---|
| `T-01` 지금 할 일 | `item`(CourseItemView), `ends_in_min` |
| `T-02` 다음 이동 | `next_item`, `leave_at`, `leave_in_min`, `travel_min`, `map_url` (구글 지도 길찾기 URL, 목적지 lat/lng, `travelmode=transit`) |
| `T-03` 남은 일정 | `items[]` (지금 이후) |
| `T-07` 고정 일정 임박 | `fixed`{name,start,end}, `leave_by`, `leave_in_min` |
| `T-08` 숙소 가는 법 | `go_home_min`, `lodging`{lat,lng} |
- `CourseItemView` = `{seq, place_id, name, start, end, lat, lng, is_fixed, facts:[Fact]}` (Fact는 TASK-003 모양, 상태 필수)
- 장소가 들어간 카드는 **확인 상태 칩 필수** (SCREEN-001 §3-2)

### A-2. 시각별 상태 (경계를 테스트)
| `at` | 지금·다음 | 예상 메인 |
|---|---|---|
| 하루 시작 전 | 지금 없음, 다음 = 1번 | 출발 10분 전 이내면 T-02, 아니면 T-01(첫 일정 미리보기, `item`=1번, `ends_in_min`=null) |
| 일정 안 (`start ≤ at < end`) | 지금 = 그 일정 | T-01 (끝나기 10분 전부터 T-02) |
| 일정 사이 (이동 중) | 다음 = 다음 일정 | T-02 |
| 고정 일정 출발 15분 이하 | | T-07 (순위 2) |
| 마지막 일정 끝난 뒤 | 다음 없음 | T-08 |
| 하루 밖 날짜 | | 400 `INVALID_REQUEST` (`at`이 그날이 아님) |

## B. 앱: 여행 중 화면 SC-04 (`frontend`)
| # | 할 것 |
|---|---|
| B1 | **개발 빌드로 전환**: `expo-dev-client`, `react-native-maps`(Google provider), `app.config.ts`(`.env.local`의 `GOOGLE_MAPS_IOS_API_KEY`를 빌드 때 읽음), `ios.bundleIdentifier = com.csh0616.tripfriends`, 앱 이름 "Tripfriends". 키가 없으면 빌드는 되고 지도 자리에 안내(§7) |
| B2 | `MapAdapter` 부품 하나로 지도를 감싼다 (핀·선·내 위치·카메라 맞추기만 노출). 화면 코드는 react-native-maps를 직접 import하지 않는다 (테스트로 검사) |
| B3 | 화면 틀 (SCREEN-001 §2): 지도 위 고정 — 왼쪽 위 프로필 자리(R1은 아바타), 가운데 **이동 상태 알약**(on_track `ok`/`ok-bg`, delayed `alert`, free `bg-2`+ink, 점 + 글자), 오른쪽 위 **SOS**(같은 자리·같은 testID). 오른쪽 아래 [내 위치] 44 원 |
| B4 | 지도: 지난 길 `line` 색 실선, 남은 길 `brand` 점선, 핀 = 번호 원(ink, 지금 = `brand` 고리), 숙소 = 집 아이콘 원 (TASK-005와 같은 모양), 내 위치 = 파란 점 대신 **ink 점 + 흰 테두리** |
| B5 | **카드 시트 3단**: 낮게(메인 한 줄) · 중간(기본, 메인 + 보조) · 높게(전체). `@gorhom/bottom-sheet` 허용. `r-sheet` 28, `sh-sheet`. 시트 아래 **입력창 고정**(R1은 비활성 안내 "곧 말로도 바꿀 수 있어") |
| B6 | 카드 부품: T-01(메인 카드: "지금 할 일" label, 장소 `title`, 남은 분 `num-xl`, 끝 시각), T-02(다음 이동: 이름, 출발 시각, 이동 분, [길 안내] 44 → `map_url` 열기), T-03(남은 일정 줄, TASK-005 P3 줄 모양 재사용), T-07, T-08. 바뀐 이유 한 줄 `caption` `muted` |
| B7 | **데모 시계** (개발 빌드·데모일 때만): 시트 위 작은 [▶ 데모] 버튼 → 패널: 시각 막대(하루 시작~끝, 5분 단위), [+10분], [▶ 재생](1초 = 5분). 위치는 "코스대로": 일정 안이면 그 장소, 이동 중이면 앞뒤 장소 사이를 시간 비율로 직선 보간 (`fakePosition(at, course)` 순수 함수) |
| B8 | 시각이 바뀔 때마다 `GET /now` (같은 요청 중이면 마지막 것만 반영, 300ms 디바운스). 화면 바꿈 규칙 SCREEN-001 §6의 30초·3분은 **이번엔 안 함** (데모 시계라서. TASK-007) |
| B9 | 진입: S9 완료 화면에 [여행 중 화면 보기(데모)] → SC-04 (그날 시작 시각부터). 앱 재실행 때 마지막 화면이 SC-04였으면 SC-04로 |
| B10 | 지도 카메라: 처음엔 코스 전체가 보이게 맞춤, 시트 높이만큼 아래 여백. [내 위치]를 누르면 위치로 |

## C. 화면 자동 확인 (Maestro) — 이번 TASK부터 규칙
| # | 할 것 |
|---|---|
| C1 | Maestro를 개발 도구로 추가하고 iOS 시뮬레이터 + 개발 빌드에서 돈다 |
| C2 | 흐름 2개: `planning.yaml`(S0→P1→P2→P3→S9, 각 화면 스크린샷), `trip-now.yaml`(SC-04, 데모 시계 10:00·13:20·이동 중·고정 일정 직전·끝난 뒤 스크린샷) |
| C3 | 스크린샷은 **저장소에 넣지 않는다** (`.gitignore`). `reviewer`가 돌려 PR에 첨부 |
| C4 | testID는 기존 계약을 그대로 쓰고, 새 testID는 test-writer 보고에 적는다 |

## D. 첫 작업: TASK-005 넘어온 것
| # | 할 것 |
|---|---|
| D1 | P2 떠 있는 줄: 점선 빈 자리 원이 담은 사진 원과 겹침 → 원 사이 간격 4, 겹치지 않게 |
| D2 | P1 "{n}시간 비어 있어": 꼭 갈 곳의 머문 시간(typical, 없으면 60분)도 뺀다. 문구는 그대로 |
| D3 | P3 보조 줄: 좁은 화면에서 "꼭 갈 곳 · 이동…"으로 잘림 → 보조 줄은 **두 줄까지 허용**(줄 높이는 내용만큼, 최소 52) |
| D4 | **글자 확대 규칙**: 시스템 글자 크기 1.3배까지 모든 줄·버튼이 잘리지 않는다 (`maxFontSizeMultiplier=1.3`, 고정 높이 대신 최소 높이) |

## 6. 겹치면
| 겹침 | 이기는 것 |
|---|---|
| 앱이 보고 싶은 카드와 서버 `main` | 서버. 앱은 카드를 고르지 않는다 |
| `compose_screen` 결과와 지원 목록 | A3 대체 (T-01) |
| 데모 시계 재생 중 사용자가 시트를 끎 | 재생은 계속, 시트 높이는 사용자 것 |
| 데모 시계와 실제 시계 | R1은 데모 시계만. 실제 시계 모드는 실제 여행 데이터 TASK에서 |

## 7. 실패하면
| 상황 | 결과 |
|---|---|
| 지도 키 없음·지도 로드 실패 | 지도 자리에 `bg-2` 판 + "지도를 불러오지 못했어" + 동선 도식(TASK-005 `RouteDiagram`). **카드는 그대로** 동작 |
| `GET /now` 끊김·시간 초과 | 마지막 화면 유지 + 시트 위 띠 "연결이 안 돼, 저장된 일정만 보여" (X-02 모양 미리) + [다시] = 같은 GET (읽기라 안전) |
| 404 `course` | "고른 코스가 없어" + [계획 다시 하기] → S0 |
| 500 | 마지막 화면 유지 + "잠깐 문제가 생겼어" + [다시] |
| `map_url` 열기 실패 | "구글 지도를 열 수 없어" 2초 안내 |
| 위치 값 없음 | 내 위치 점 숨김, [내 위치] 비활성 |

## 8. 완료 기준
| ID | Then |
|---|---|
| AC-1 | 서버·앱 테스트 모두 통과 (`slow` 따로) |
| AC-2 | A-2 표의 줄마다 서버 테스트 (경계: 출발 10분 전 ±1분, 고정 15분 전 ±1분, 일정 끝 시각 정각) |
| AC-3 | NowView 모양 = §A-1, 장소 카드에 상태 칩, 위치를 저장하지 않음 (저장소 비교) |
| AC-4 | A3: 지원 밖 카드가 나오는 Snapshot을 강제하면 T-01 대체 |
| AC-5 | `fakePosition` 속성 테스트 (일정 안 = 그 장소, 이동 중 = 두 점 사이, 시각 단조) |
| AC-6 | 가드레일: SOS·입력창 고정, 토큰 밖 색 없음, `MapAdapter` 밖 react-native-maps import 없음, 터치 44, 대비 4.5 |
| AC-7 | §7 실패 표 줄마다 |
| AC-8 | **Maestro 두 흐름이 시뮬레이터에서 통과**, 스크린샷 PR 첨부 (`reviewer`) |
| AC-9 | 결정권자 폰(개발 빌드)에서 SC-04 데모 시계 한 바퀴 |
| AC-10 | D1~D4 테스트 + 스크린샷 |

## 9. 하지 말 것
- 사건 감지·대안(T-04~06), 근처 추천(T-09~11), 대화, 실제 GPS 권한 요청 (TASK-007 이후)
- 장소 검색·경로 API 호출 (비용·약관). 길 안내는 `map_url`로 구글 지도 앱에 넘김
- 지도 키를 코드·로그·PR에 남기기, `.env.local` 읽어서 출력하기
- `docs/` 수정, 저장소 밖 검색, 이름으로 프로세스 끄기

## 10. 학습 카드 (결정권자용)
1. **지도**: 서버가 "지금 상황(Snapshot)"을 만들고 → `compose_screen`이 카드를 고르고 → 앱은 그리기만. 데모 시계는 "지금"을 바꿔 끼우는 장치
2. **핵심 개념**: 개발 빌드 vs Expo Go · 공개 키와 비밀 키 · E2E 화면 자동 확인(Maestro)
3. **직접 해보기**: 데모 시계를 고정 일정 16분 전 → 15분 전으로 옮기며 메인이 T-07로 바뀌는 순간 보기
4. **내 말로**: "앱이 카드를 고르지 않는 이유는?" / "지도 키는 왜 저장소에 안 올리나?"

## 포트폴리오 포인트
- 같은 규칙 엔진(`compose_screen`, TASK-001)이 실제 화면을 움직임: 시각 경계마다 카드가 바뀌는 것을 **Maestro 스크린샷으로 증명**
- 지도 SDK 결정(ADR-014)과 키 관리, 지도 실패 시에도 카드는 동작하는 설계
- 예상 면접 질문: "여행 중 화면을 어떻게 테스트했나요?" → "시각을 주입하는 데모 시계로 경계(출발 10분 전, 고정 일정 15분 전)를 서버 테스트로 고정하고, 시뮬레이터 E2E로 화면 스크린샷을 남겼다"
