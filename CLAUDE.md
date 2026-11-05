# Tripfriends — AI 여행친구

같이 고르며 설레는 계획 + 여행 중 지도 위에서 동행하는 AI 여행친구. 첫 시장은 일본을 여행하는 한국인.
포트폴리오 프로젝트다: **절차(요구사항 → 설계 → 테스트 → 코드)와 숫자(측정)를 남기는 것**이 목표.

## 사람과 역할
- 결정권자: 승현. 터미널 초보다. **실행할 명령은 한 줄씩 무엇을 하는지 한국어로 설명**한다
- PM(claude.ai 프로젝트의 Claude)이 설계 문서를 관리한다. 너(Claude Code)는 개발을 맡는다
- 답과 보고는 **한국어**로, 짧게

## 구조 (docs/adr/ADR-013)
- `apps/server` — Python 3 · uv · FastAPI · LangGraph. 판단·계산·AI 호출은 전부 여기
- `apps/mobile` — React Native · Expo · TypeScript. 화면만
- `packages/api-types` — 서버 OpenAPI에서 자동 생성한 TS 타입 (손으로 고치지 않음)
- `apps/web` — **건드리지 않는다** (R2 이후 관측 대시보드용)

## 문서 지도 (필요할 때 찾아 읽기)
| 알고 싶은 것 | 문서 |
|---|---|
| 지금 할 작업, 완료 기준 | `docs/tasks/TASK-*.md` |
| 카드 23종, 화면 우선순위 표, 강한·약한 신호, 짝 표, 머무는 시간 | `docs/SCREEN-001_Card-Catalog-v4.md` |
| LangGraph 그래프 4개, `compose_screen()` 순서 | `docs/GRAPH-001_LangGraph-Design.md` |
| Jev를 어디에 쓰고 어디에 안 쓰나 (측정 근거) | `docs/adr/ADR-011_Where-to-Use-Jev.md` |
| 서버 구조, 테스트 도구 | `docs/adr/ADR-013_Architecture-App-and-Python-Server.md` |
| TDD 진행 방식, 리뷰 단계 | `docs/TEAM-001_Agent-Team-Operations.md` |
| 요구사항 FR·NFR·AC | `docs/SRS-001_Requirements-Specification.md` |
| 테이블, API | `docs/DATA-001_Data-Model.md`, `docs/API-001_API-Specification.md` |

**`docs/`는 PM이 관리한다. 내용을 직접 고치지 않는다** (결과·질문은 PR 초안에 쓴다). PM이 바꾼 `docs/` 파일은 내용 그대로 `docs:` 커밋해도 된다.
**근거는 저장소 안 `docs/`와 코드뿐이다.** 저장소 밖(`~/Documents`, `~/Downloads` 등) 검색·읽기 금지. `Claude outputs/`는 진행 담당(메인)이 PR 초안을 쓰는 곳이고, test-writer·backend·frontend는 읽지 않는다. 필요한 자료가 없으면 찾으러 가지 말고 질문으로 돌려준다.
**문서에 없는 규칙을 지어내지 않는다.** 문서끼리 다르거나 비어 있으면 멈추고 승현에게 묻는다.

## 절대 규칙
1. **비밀값**: API 키는 `apps/server/.env`에만. `apps/mobile`에 절대 두지 않는다 (`EXPO_PUBLIC_`은 앱에 그대로 들어감). 키 값을 화면에 출력하지 않는다. `.env`는 커밋하지 않고 `.env.example`만 커밋
2. **사실 값**: 영업시간·가격 등은 엔진·DB 결과만 쓴다. LLM이 사실 값을 만들지 않는다. 장소에는 확인 상태(확인됨/미확인/모름) 필수
3. **일정 변경**: 사용자가 고르기 전에는 일정을 바꾸지 않는다 (interrupt)
4. **AI 호출**: 앱은 Jev·LLM을 직접 부르지 않는다. 모든 AI 노드에 시간 제한과 규칙 대체 경로
5. **안전**: 안전 키워드는 규칙으로 먼저 처리. 모델을 거치지 않는다
6. **실험 코드**: 측정·실험용 스크립트를 저장소에 남기지 않는다

## 작업 방식
- **TDD, 세션 분리** (TEAM-001 §4-1): 테스트 세션은 테스트만, 코드 세션은 테스트를 고치지 않고 통과시키기만. 명령: `/test-session`, `/code-session`
- 핵심 테스트는 승현이 한국어 요약표를 승인하기 전에 구현하지 않는다
- 커밋: `feat:` `fix:` `chore:` `docs:` `test:` + 한국어 설명. `main`에 직접 커밋하지 않고 브랜치 → PR
- 막히면: 에러 원문, 세운 가설, 확인한 것을 남긴다 (학습 자료가 된다)
- 단계마다 보고: 무엇을 했는지 / 승현이 실행할 명령 / 확인 방법

## 자주 쓰는 명령 (생기면 갱신)
- 서버 테스트: `cd apps/server && uv run pytest`
- 서버 실행: `cd apps/server && uv run fastapi dev`
- 앱 테스트: `pnpm --filter mobile test`
- 타입 생성: `pnpm --filter api-types generate`
