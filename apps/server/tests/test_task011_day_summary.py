"""TASK-011 v1.1 §9 Q2·Q10: 날짜 목록이 코스를 따로 부르지 않게 서버가 날 요약을 같이 준다 + 코스 줄 영업시간 출처.
근거: TASK-011 §9 Q2(summary {end_time, place_count, move_min} · must_visits [{place_id, name}]), Q10(코스 줄 영업시간에 source_type·status),
Q5(고른 코스가 있는 날), DESIGN-001 §4-11(요약 글 "18:30 끝 · 8곳 · 이동 125분"), TASK-010 §13 O1·O2(늘 열림·curated 시간대).
가짜 오사카만 쓴다 (PLACES_PROVIDER=fake, Google·Serper 키 없음).

계약 (이 테스트가 정한 해석, 승인 대기 -> 질문 목록):
    GET /trips/current 의 trip_days[] 에 두 칸을 더한다 (기존 칸은 그대로)
        summary: 고른 코스가 있으면 {end_time, place_count, move_min}, 없으면 null(또는 칸 없음)
            end_time = 고른 코스 마지막 줄의 end ("HH:MM") · place_count = 장소가 있는 줄 수(place_id 있음, §11 Q2: 장소 있는 고정 일정은 셈, 장소 없는 고정 일정은 안 셈) · move_min = total_travel_min
            (GET /days/{id}/course 와 같은 값)
        must_visits: 그날 꼭 갈 곳 [{place_id, name}] (POST /trips 에 넣은 순서, 없으면 []). name = 도시 팩 장소 이름
    Q10 코스 줄(GET /days/{id}/course 의 items[], POST 계획 응답의 options[].items[])에 facts 를 더한다:
        facts = 여행 중 화면 NowCourseItem.facts 와 같은 Fact 모양 [{field, value, status, source_type, checked_at}]
        영업시간 fact(field "opening_hours")의 status 는 기존 hours_status 와 같다. 장소 없는 고정 일정은 [] (§11 Q1 승인)
"""

from test_task010_trips import DEVICE, osaka  # noqa: F401 (픽스처)

PARK = "osaka-fake-park"  # O1 늘 열림 (curated · confirmed · "00:00-24:00")
NIGHT = "osaka-fake-night-street"  # O2 curated 시간대 17:00~24:00
KUROMON = "osaka-fake-kuromon"
SUMMARY_KEYS = {"end_time", "place_count", "move_min"}


def course_of(osaka, day_id: str) -> dict:  # noqa: F811
    response = osaka.client.get(f"/days/{day_id}/course", headers={"X-Device-Id": DEVICE})
    assert response.status_code == 200, response.text
    return response.json()


def current_days(osaka) -> list[dict]:  # noqa: F811
    response = osaka.current()
    assert response.status_code == 200, response.text
    return response.json()["trip_days"]


# ---------- Q2 summary ----------


def test_T11_Q2_고른_코스가_있는_날은_summary_세_칸(osaka):  # noqa: F811
    trip = osaka.make_trip()
    day_id = trip["trip_days"][0]["day_id"]
    osaka.plan_and_select(day_id)
    summary = current_days(osaka)[0].get("summary")
    assert isinstance(summary, dict), summary
    assert set(summary) == SUMMARY_KEYS


def test_T11_Q2_summary_값은_고른_코스와_같다(osaka):  # noqa: F811
    trip = osaka.make_trip(must=[(0, KUROMON)])
    day_id = trip["trip_days"][0]["day_id"]
    osaka.plan_and_select(day_id)
    course = course_of(osaka, day_id)
    summary = current_days(osaka)[0]["summary"]
    assert summary["end_time"] == course["items"][-1]["end"]
    assert summary["place_count"] == sum(1 for item in course["items"] if item["place_id"] is not None)
    assert summary["move_min"] == course["total_travel_min"]


def test_T11_Q2_summary_end_time은_HH_MM(osaka):  # noqa: F811
    trip = osaka.make_trip()
    osaka.plan_and_select(trip["trip_days"][0]["day_id"])
    end_time = current_days(osaka)[0]["summary"]["end_time"]
    assert isinstance(end_time, str) and len(end_time) == 5 and end_time[2] == ":", end_time
    assert end_time.replace(":", "").isdigit()


def test_T11_Q2_summary_숫자는_정수(osaka):  # noqa: F811
    trip = osaka.make_trip()
    osaka.plan_and_select(trip["trip_days"][0]["day_id"])
    summary = current_days(osaka)[0]["summary"]
    assert isinstance(summary["place_count"], int) and summary["place_count"] >= 1
    assert isinstance(summary["move_min"], int) and summary["move_min"] >= 0


def test_T11_Q2_고른_코스가_없는_날은_summary_없음(osaka):  # noqa: F811
    osaka.make_trip()
    for day in current_days(osaka):
        assert day.get("summary") is None


def test_T11_Q2_한_날만_고르면_그날만_summary(osaka):  # noqa: F811
    trip = osaka.make_trip(days=3)
    osaka.plan_and_select(trip["trip_days"][1]["day_id"])
    found = [day.get("summary") is not None for day in current_days(osaka)]
    assert found == [False, True, False]


def test_T11_Q2_POST_trips_응답에도_같은_칸(osaka):  # noqa: F811
    trip = osaka.make_trip(must=[(0, KUROMON)])
    first = trip["trip_days"][0]
    assert first.get("summary") is None
    assert [one["place_id"] for one in first["must_visits"]] == [KUROMON]


def test_T11_Q2_기존_칸은_그대로(osaka):  # noqa: F811
    osaka.make_trip()
    for day in current_days(osaka):
        assert {"day_id", "date", "state", "chosen_option_id", "fixed_events"} <= set(day)


# ---------- Q2 must_visits ----------


def test_T11_Q2_must_visits는_place_id와_name(osaka):  # noqa: F811
    trip = osaka.make_trip(must=[(0, PARK), (0, KUROMON)])
    osaka.plan_and_select(trip["trip_days"][0]["day_id"])
    names = {item["place_id"]: item["name"] for item in course_of(osaka, trip["trip_days"][0]["day_id"])["items"]}
    must = current_days(osaka)[0]["must_visits"]
    assert [set(one) for one in must] == [{"place_id", "name"}, {"place_id", "name"}]
    assert [one["place_id"] for one in must] == [PARK, KUROMON]  # 넣은 순서
    for one in must:
        assert one["name"] == names[one["place_id"]]  # 도시 팩 이름 (코스 줄 이름과 같다)


def test_T11_Q2_꼭_갈_곳은_그날에만(osaka):  # noqa: F811
    osaka.make_trip(days=3, must=[(1, KUROMON)])
    musts = [[one["place_id"] for one in day["must_visits"]] for day in current_days(osaka)]
    assert musts == [[], [KUROMON], []]


def test_T11_Q2_꼭_갈_곳이_없으면_빈_목록(osaka):  # noqa: F811
    osaka.make_trip()
    assert all(day["must_visits"] == [] for day in current_days(osaka))


# ---------- Q10 코스 줄 영업시간 출처 ----------


def hours_of(item: dict) -> dict | None:
    found = [fact for fact in item.get("facts", []) if fact.get("field") == "opening_hours"]
    assert len(found) <= 1, item
    return found[0] if found else None


def planned_course(osaka) -> dict:  # noqa: F811
    trip = osaka.make_trip(must=[(0, PARK), (0, NIGHT), (0, KUROMON)])
    day_id = trip["trip_days"][0]["day_id"]
    osaka.plan_and_select(day_id)
    return course_of(osaka, day_id)


def test_T11_Q10_코스_줄마다_facts가_있다(osaka):  # noqa: F811
    for item in planned_course(osaka)["items"]:
        assert isinstance(item.get("facts"), list), item


def test_T11_Q10_영업시간_fact는_source_type과_status(osaka):  # noqa: F811
    for item in planned_course(osaka)["items"]:
        hours = hours_of(item)
        if item["place_id"] is None:
            continue
        assert hours is not None, item
        assert {"field", "value", "status", "source_type"} <= set(hours)
        assert hours["status"] == item["hours_status"]  # 칩은 늘 데이터의 상태 (규칙 2)


def test_T11_Q10_늘_열림은_curated_confirmed_00_24(osaka):  # noqa: F811
    park = next(item for item in planned_course(osaka)["items"] if item["place_id"] == PARK)
    hours = hours_of(park)
    assert (hours["source_type"], hours["status"], hours["value"]) == ("curated", "confirmed", "00:00-24:00")


def test_T11_Q10_밤거리는_curated_시간대(osaka):  # noqa: F811
    night = next(item for item in planned_course(osaka)["items"] if item["place_id"] == NIGHT)
    hours = hours_of(night)
    assert (hours["source_type"], hours["status"]) == ("curated", "confirmed")
    assert hours["value"] != "00:00-24:00"


def test_T11_Q10_계획_응답의_코스안_줄에도_facts(osaka):  # noqa: F811
    trip = osaka.make_trip(must=[(0, NIGHT)])
    started = osaka.client.post(f"/days/{trip['trip_days'][0]['day_id']}/planning", json={"mode": "auto"})
    assert started.status_code == 201, started.text
    for option in started.json()["options"]:
        for item in option["items"]:
            assert isinstance(item.get("facts"), list), item


def test_T11_Q10_장소_없는_고정_일정_줄은_facts_빈_목록(osaka):  # noqa: F811
    trip = osaka.make_trip()
    assert osaka.add_fixed(trip, 0, "12:00", "13:00").status_code == 201
    started = osaka.client.post(f"/days/{trip['trip_days'][0]['day_id']}/planning", json={"mode": "auto"})
    fixed = [item for option in started.json()["options"] for item in option["items"] if item["is_fixed"] and item["place_id"] is None]
    assert fixed, started.json()
    assert all(item.get("facts") == [] for item in fixed)


# ---------- §11 Q2 place_count 경계: 장소 없는 고정 일정은 안 센다, 장소 있는 고정 일정은 센다 ----------


def selected_with_fixed(osaka, **fixed_extra) -> tuple[dict, dict]:  # noqa: F811
    trip = osaka.make_trip()
    assert osaka.add_fixed(trip, 0, "12:00", "13:00", **fixed_extra).status_code == 201
    day_id = trip["trip_days"][0]["day_id"]
    osaka.plan_and_select(day_id)
    return course_of(osaka, day_id), current_days(osaka)[0]


def test_T11_S11_Q2_장소_없는_고정_일정은_place_count에_안_센다(osaka):  # noqa: F811
    course, day = selected_with_fixed(osaka)
    placeless = [item for item in course["items"] if item["is_fixed"] and item["place_id"] is None]
    assert len(placeless) == 1, course["items"]
    summary = day["summary"]
    assert summary["place_count"] == len(course["items"]) - 1
    assert summary["end_time"] == course["items"][-1]["end"]
    assert summary["move_min"] == course["total_travel_min"]


def test_T11_S11_Q2_장소_있는_고정_일정은_place_count에_센다(osaka):  # noqa: F811
    course, day = selected_with_fixed(osaka, place_id=KUROMON)
    fixed = [item for item in course["items"] if item["is_fixed"]]
    assert [item["place_id"] for item in fixed] == [KUROMON], course["items"]
    summary = day["summary"]
    assert summary["place_count"] == len(course["items"])
