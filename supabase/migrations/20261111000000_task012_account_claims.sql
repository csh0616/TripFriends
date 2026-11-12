-- TASK-012 2단계 (§15 S3): 처리된 익명 사용자 기록. 한 번 옮김(moved)·고르기(choose)가 끝난 익명 사용자는 다시 claim할 수 없다 (409 ALREADY_CLAIMED).
-- 사용자 id만 둔다: 토큰·이메일은 저장하지 않는다 (§15 S4·S6). 여행은 지우지 않으므로 이 표도 지우는 길이 없다.
-- 익명 사용자는 여행이 없어 profiles에 행이 없을 수 있어 profiles를 가리키지 않는다.
create table account_claims (
    anonymous_user_id uuid primary key,
    account_user_id uuid not null,
    created_at timestamptz not null default now()
);

-- 앱은 DB를 직접 읽고 쓰지 못한다 (§8): RLS만 켜고 정책은 만들지 않는다
alter table account_claims enable row level security;
