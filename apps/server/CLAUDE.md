# apps/server 규칙

- Python, **uv**로 관리 (`uv add`, `uv run`). pip 직접 쓰지 않기
- 모듈: `api`(FastAPI) · `catalog`(카드 pydantic) · `deciders`(Decider 인터페이스, Rule/Jev) · `engine`(규칙·코스 DP·감지·`compose_screen`, **LLM 없이 동작**) · `graphs`(LangGraph) · `places` · `evals`
- `engine`과 `compose_screen`은 **순수 함수 + TDD**. 같은 입력 → 같은 출력
- Jev는 `JevDecider`로만 부른다. 시간 제한 0.8초, 확신 0.6 미만이면 되묻기, 실패하면 대체 Decider (ADR-011). Jev 전용 타입은 `deciders` 밖으로 내보내지 않음
- Jev `score`의 `criteria`는 **순서 있는 척도 배열**이다 (평가 항목 목록 아님, POC 측정에서 확인)
- 테스트: pytest + Hypothesis(속성) + mutmut(돌연변이). 실제 Jev를 부르는 테스트는 `@pytest.mark.live`로 분리, 기본 실행에서 제외
- 키는 이 폴더의 `.env`의 `AI_GATEWAY_API_KEY`. 없으면 이해할 수 있는 오류로 멈춤. 값 출력 금지
