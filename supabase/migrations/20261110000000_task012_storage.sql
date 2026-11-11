-- TASK-012 A1: DATA-001 A·C·D·E의 R1 표 + 판단 기록(decision_logs) + 계획 그래프 체크포인트.
--
-- 지키는 것
--   * 위치 열 0 (A6, AC-4): 사용자의 위치도, 장소 좌표도 이 DB에 두지 않는다. 장소는 place_id(와 우리 장소 id)만 두고
--     읽을 때 도시 팩 + 좌표 캐시 + 영업시간 메모리에서 되살린다 (ADR-015, TASK-012 §10 Q1). PostGIS를 켜지 않는다.
--   * 장소 팩·Google 값 표 없음. place_facts에는 사용자 확인('user')만 둔다 (A1).
--   * 여행의 주인(owner_id)은 비울 수 없다 (§11 Q1). 데모 여행도 그 사용자 소유이고 is_demo로 표시한다 (A5).
--   * 앱은 DB를 직접 읽고 쓰지 않는다 (§8): 모든 표에 RLS를 켜고 정책을 만들지 않는다.
--     서버만 DATABASE_URL(서버 전용 연결)로 읽고 쓴다.

-- ---------- A. 사용자·여행 ----------

-- id = Supabase Auth 사용자 ID (익명 계정으로 시작, 연결해도 같은 ID, ADR-016). auth.users를 가리키지 않는다:
-- 서버는 토큰의 sub만 믿고 첫 여행을 만들 때 이 행을 만든다. 전화번호·실명 없음.
create table profiles (
    id uuid primary key,
    created_at timestamptz not null default now()
);

create table trips (
    id uuid primary key,
    seq bigint generated always as identity,                -- 만든 순서 (지금 여행 = 이 사용자의 마지막 active)
    owner_id uuid not null references profiles (id),         -- §11 Q1: 주인 없는 여행 없음
    city_code text not null,
    start_date date not null,
    end_date date not null,
    lodging_place_id text,
    status text not null default 'active' check (status in ('active', 'archived')),
    is_demo boolean not null default false,                  -- A5: 개발용 데모 여행 (status는 active, 지금 여행에는 안 나옴)
    demo_current boolean not null default false,             -- 데모가 지금 여행으로 붙었나 (as_current, 점검 전용)
    demo_today date,                                         -- 데모 여행의 날 상태 시계 (데모만)
    created_at timestamptz not null default now(),
    check (end_date >= start_date)
);
create index trips_owner_idx on trips (owner_id, seq);

-- 하루 1행. trip_id는 여행에 붙기 전까지 비어 있을 수 있다 (날을 먼저 저장하고 여행이 그 날들을 가져간다).
-- 장소는 place_id만: place_ids는 그날 후보로 쓰는 장소 id 목록 (좌표·영업시간은 읽을 때 도시 데이터에서).
-- demo는 데모 여행의 가상 장소(source = demo, 도시 팩에 없음)만 담는다. 실제 여행은 null.
create table trip_days (
    id uuid primary key,
    trip_id uuid references trips (id),
    day date not null,
    day_number int not null,
    start_time text not null,
    end_time text not null,
    lodging_known boolean not null default true,
    place_ids jsonb not null default '[]',
    sources_known boolean not null default true,
    plan_fixed jsonb not null default '[]',                  -- 계획용 고정 일정 (좌표 없이: 장소는 place_id)
    stay_overrides jsonb not null default '{}',
    demo jsonb,
    chosen_option_id uuid,                                   -- 선택한 코스 (아래 course_options를 가리킴)
    created_at timestamptz not null default now()
);
create index trip_days_trip_idx on trip_days (trip_id, day_number);

create table fixed_events (
    id uuid primary key,
    trip_id uuid not null references trips (id),
    trip_day_id uuid not null references trip_days (id),
    place_id text,                                           -- 없어도 됨
    title text not null,
    start_at timestamptz not null,
    end_at timestamptz not null,
    created_at timestamptz not null default now()
);
create index fixed_events_day_idx on fixed_events (trip_day_id, start_at);

-- 날의 꼭 갈 곳 (넣은 순서). trip_id는 날이 여행에 붙을 때 채운다.
create table must_visits (
    trip_day_id uuid not null references trip_days (id),
    slot int not null,
    trip_id uuid references trips (id),
    place_id text not null,
    primary key (trip_day_id, slot)
);

-- ---------- C. 계획 대화 ----------
-- 반응·코스안·선택 결과는 그래프 상태가 아니라 여기에 둔다 (ADR-013). 대화 맥락은 체크포인트(아래)에.

create table planning_sessions (
    id uuid primary key,
    seq bigint generated always as identity,                -- 시작한 순서 (그날 가장 나중 세션 찾기, §13 1)
    trip_day_id uuid not null references trip_days (id),
    mode text check (mode in ('conversation', 'auto')),      -- 그래프 상태에 있는 값. 저장소는 몰라 비워 둔다
    state text check (state in ('asking', 'browsing', 'composing', 'done')),
    round int,
    script_version text,
    batch_relaxed boolean not null default false,            -- 지금 묶음을 만들 때의 direction_relaxed
    batch_first boolean not null default false,              -- 지금 묶음이 첫 질문의 답으로 만든 첫 묶음인가
    stay_overrides jsonb not null default '{}',              -- 이 세션에서 사용자가 바꾼 머무는 시간 (place_id -> 분)
    created_at timestamptz not null default now()
);
create index planning_sessions_day_idx on planning_sessions (trip_day_id);

-- R1은 아직 쓰지 않는 표 (DATA-001 C): 만들어 두기만 한다.
create table candidate_batches (
    id uuid primary key,
    session_id uuid not null references planning_sessions (id),
    round int not null,
    direction text,
    place_ids jsonb not null default '[]'
);

-- 한 장소에 반응 하나. seq는 같은 action 안의 순서 (담은 곳 순서가 코스 계산에 영향을 주므로 남긴다).
-- "담은 곳" = like 중 unlike 안 된 것. 넘김(skip)도 기록한다 (FR-02b).
create table reactions (
    session_id uuid not null references planning_sessions (id),
    place_id text not null,
    action text not null check (action in ('like', 'skip', 'unlike')),
    seq int not null,
    primary key (session_id, place_id)
);

create table direction_inputs (
    id uuid primary key,
    session_id uuid not null references planning_sessions (id),
    kind text check (kind in ('chip', 'text')),
    raw_text text,
    parsed_direction text,
    parser text check (parser in ('rule', 'llm')),
    understood boolean
);

create table preference_states (
    id uuid primary key,
    trip_id uuid not null references trips (id),
    weights jsonb not null default '{}',
    avoid jsonb not null default '[]',
    version int not null default 1
);

-- ---------- D. 코스 ----------

create table course_options (
    id uuid primary key,
    seq bigint generated always as identity,
    -- 코스안을 먼저 저장하고 세션을 뒤에 만드는 순서(그래프의 자동 시작)가 있어, 요청이 끝날 때(commit) 확인한다
    session_id uuid not null references planning_sessions (id) deferrable initially deferred,
    label text not null check (label in ('relaxed', 'packed')),
    score numeric,
    picks jsonb not null default '[]',                       -- 이 안을 계산할 때 쓴 담은 곳
    dropped jsonb not null default '[]',                     -- 넣지 못한 장소와 이유 (FR-07)
    go_home_min int not null,
    total_travel_min int not null
);
create index course_options_session_idx on course_options (session_id);

alter table trip_days
    add constraint trip_days_chosen_option_fk foreign key (chosen_option_id) references course_options (id);

-- start_at·end_at은 시각 글자 "HH:MM" (자정을 넘기면 "25:10"처럼 24 이상이라 time 형식을 쓰지 않는다)
create table course_items (
    option_id uuid not null references course_options (id),
    seq int not null,
    place_id text,                                           -- 장소 없는 고정 일정이면 null
    start_at text not null,
    end_at text not null,
    stay_min int not null,
    stay_source text check (stay_source in ('auto', 'user')),
    travel_min int not null,
    wait_min int not null,
    is_fixed boolean not null,
    hours_status text check (hours_status in ('confirmed', 'unverified', 'unknown')),
    primary key (option_id, seq)
);

-- ---------- E. 여행 중 ----------

create table trip_events (
    id uuid primary key,
    seq bigint generated always as identity,
    trip_day_id uuid not null references trip_days (id),
    type text not null check (type in ('delay', 'closed', 'last_train', 'weather')),
    severity text not null check (severity in ('low', 'high')),
    evidence jsonb not null,                                 -- {k, delay_min, at}: 장소 순번과 늦은 분만. 위치는 담지 않는다
    dedupe_key text not null,                                -- 같은 사건 한 번만 알림 (FR-19)
    state text not null check (state in ('open_low', 'awaiting', 'resolved')),
    user_choice text check (user_choice in ('accepted', 'dismissed'))
);
create index trip_events_day_idx on trip_events (trip_day_id, dedupe_key);

-- 사용자가 고르기 전에는 일정을 바꾸지 않는다 (FR-13). course = 반영하면 그날의 새 코스안이 되는 전체 코스.
-- option_id·user_choice는 반영·사양 결과를 위한 자리 (R1은 사건 쪽 user_choice를 쓴다).
create table recompose_proposals (
    id uuid primary key,
    seq bigint generated always as identity,
    event_id uuid not null references trip_events (id),
    option_id uuid references course_options (id),
    label text not null check (label in ('relaxed', 'packed')),
    reason text not null,
    dropped jsonb not null default '[]',
    keeps_fixed boolean not null,
    first_leave_at text not null,
    course jsonb not null,
    from_index int not null,
    created_at timestamp not null,                           -- 도시 현지 시각 (시간대 없음, TASK-006 §A-1)
    base_delay_min int not null,
    superseded boolean not null default false,
    closed jsonb,
    user_choice text check (user_choice in ('accepted', 'dismissed'))
);
create index recompose_proposals_event_idx on recompose_proposals (event_id, seq);

-- 방문 전 영업 확인 답. 그날 그 장소 하나 (원본 장소 데이터는 건드리지 않는다)
create table visit_checks (
    trip_day_id uuid not null references trip_days (id),
    place_id text not null,
    was_open boolean not null,
    checked_at timestamp not null,
    primary key (trip_day_id, place_id)
);

-- ---------- B 중 사용자 확인만 (A1) ----------

create table place_facts (
    id uuid primary key default gen_random_uuid(),
    place_id text not null,
    field text not null,
    value text,
    status text not null check (status in ('confirmed', 'unverified', 'unknown')),
    source_type text not null check (source_type = 'user'),
    source_url text,
    checked_at timestamptz
);

-- ---------- F 중 R1이 이미 쓰는 판단 기록 (§10 Q10) ----------
-- 개인 식별 정보 없이 저장 (DATA-001 F). message_id는 R2의 messages가 생길 때 연결한다.

create table decision_logs (
    id bigint generated always as identity primary key,
    message_id uuid,
    kind text not null,
    model text not null,
    output jsonb not null,
    latency_ms int,
    cost_usd numeric,
    created_at timestamptz not null default now()
);

-- ---------- A4 계획 그래프 체크포인트 (langgraph-checkpoint-postgres 3.x의 표 그대로) ----------
-- 서버를 다시 켜도 계획 대화가 그 자리에서 이어지게 한다. 표 모양은 라이브러리 것이라 열을 바꾸지 않는다.

create table checkpoint_migrations (v integer primary key);
create table checkpoints (
    thread_id text not null,
    checkpoint_ns text not null default '',
    checkpoint_id text not null,
    parent_checkpoint_id text,
    type text,
    checkpoint jsonb not null,
    metadata jsonb not null default '{}',
    primary key (thread_id, checkpoint_ns, checkpoint_id)
);
create table checkpoint_blobs (
    thread_id text not null,
    checkpoint_ns text not null default '',
    channel text not null,
    version text not null,
    type text not null,
    blob bytea,
    primary key (thread_id, checkpoint_ns, channel, version)
);
create table checkpoint_writes (
    thread_id text not null,
    checkpoint_ns text not null default '',
    checkpoint_id text not null,
    task_id text not null,
    idx integer not null,
    channel text not null,
    type text,
    blob bytea not null,
    task_path text not null default '',
    primary key (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
create index checkpoints_thread_id_idx on checkpoints (thread_id);
create index checkpoint_blobs_thread_id_idx on checkpoint_blobs (thread_id);
create index checkpoint_writes_thread_id_idx on checkpoint_writes (thread_id);
-- 라이브러리의 setup()이 이 표들을 이미 적용된 것으로 보게 한다 (버전 0~9)
insert into checkpoint_migrations (v) select generate_series(0, 9);

-- ---------- 앱이 DB를 직접 읽고 쓰지 못하게 ----------
alter table profiles enable row level security;
alter table trips enable row level security;
alter table trip_days enable row level security;
alter table fixed_events enable row level security;
alter table must_visits enable row level security;
alter table planning_sessions enable row level security;
alter table candidate_batches enable row level security;
alter table reactions enable row level security;
alter table direction_inputs enable row level security;
alter table preference_states enable row level security;
alter table course_options enable row level security;
alter table course_items enable row level security;
alter table trip_events enable row level security;
alter table recompose_proposals enable row level security;
alter table visit_checks enable row level security;
alter table place_facts enable row level security;
alter table decision_logs enable row level security;
alter table checkpoint_migrations enable row level security;
alter table checkpoints enable row level security;
alter table checkpoint_blobs enable row level security;
alter table checkpoint_writes enable row level security;
