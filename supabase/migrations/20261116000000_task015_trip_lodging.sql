-- TASK-015 §A·§11 Q9: 숙소를 한 칸(jsonb)으로. 옛 lodging_place_id를 {kind: place, place_id, 나머지 null}로 옮긴 뒤 옛 칸을 지운다.
-- 같은 뜻의 값이 두 곳이면 어긋나기 때문이다. 여행·날 줄은 하나도 지우지 않는다 (칸만 바뀐다).
-- lodging = null(숙소 없음) 또는 여섯 칸이 늘 있는 객체 {kind, place_id, address_text, lat, lng, label}.
-- 사용자 주소 글자·찍은 좌표는 이 칸에만 둔다. Google 이름·주소 문구는 어디에도 두지 않는다.
alter table trips add column lodging jsonb;

update trips
set lodging = jsonb_build_object(
    'kind', 'place',
    'place_id', lodging_place_id,
    'address_text', null,
    'lat', null,
    'lng', null,
    'label', null
)
where lodging_place_id is not null;

alter table trips drop column lodging_place_id;
