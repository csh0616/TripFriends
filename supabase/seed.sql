-- 로컬 Supabase 전용 시드 (`supabase db reset --local`이 마이그레이션 뒤 실행). 클라우드 프로젝트에는 적용하지 않는다 (TASK-012 §16 Q11).
-- 가짜 로그인 공급자의 "이미 있는 계정": link-existing@example.test (비밀번호 = apps/mobile/src/lib/dev-login.ts의 개발 전용 테스트 값).
-- 이 계정에는 여행을 넣지 않는다: 여행이 있는 계정 쪽(choose 흐름)은 점검 때 앱·API로 만든다.
-- link-new@example.test는 시드하지 않는다: 익명 사용자에게 이메일·비밀번호를 붙이는 쪽(updateUser)이 그때 만든다.
insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, is_anonymous
) values (
    '00000000-0000-0000-0000-000000000000', '5d1f0c1e-7b2a-4c3a-9a55-0e1a2b3c4d5e', 'authenticated', 'authenticated',
    'link-existing@example.test', crypt('dev-login-local-only', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false
);
insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
    gen_random_uuid(), '5d1f0c1e-7b2a-4c3a-9a55-0e1a2b3c4d5e', '5d1f0c1e-7b2a-4c3a-9a55-0e1a2b3c4d5e',
    '{"sub":"5d1f0c1e-7b2a-4c3a-9a55-0e1a2b3c4d5e","email":"link-existing@example.test","email_verified":true}', 'email', now(), now(), now()
);
