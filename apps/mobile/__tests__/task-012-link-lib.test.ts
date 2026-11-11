/// <reference types="jest" />
// TASK-012 2단계 앱 로직·가드레일: 이메일 일부 · 되돌아오기 주소(scheme) · PKCE · §4-12 토큰을 이름으로 · 개발용 가짜 로그인 공급자는 릴리스에 0 · G 로고 파일.
// 근거: TASK-012 §C C2·C5·§7 AC-6·§9 1·K7, 리뷰 파일 §1(이메일 앞 2글자 + *** + @도메인, 2글자 이하면 1글자)·§2(G 로고는 공식 SVG 그대로),
//   DESIGN-001 §4-12, PM 안(redirect tripfriends://auth/callback, scheme "mobile" -> "tripfriends", 개발 빌드 전용 가짜 로그인 공급자, 릴리스 번들에 그 코드 0).
//
// 계약 (이 테스트가 정한 이름, 승인 대기):
//   src/lib/mask-email.ts  maskEmail(email) -> 'se***@gmail.com'
//   app.json expo.scheme = 'tripfriends'. Supabase 클라이언트는 code 교환을 쓰므로 createClient(..., { auth: { flowType: 'pkce' } })
//   개발용 가짜 로그인 공급자 = src/lib/dev-login.ts (안에 표시 글자 DEV_FAKE_LOGIN). 다른 파일은 이 모듈을
//     `__DEV__`가 같은 줄에 있는 require로만 부른다 (`import` 금지) -> 릴리스 번들(__DEV__ = false)에서 죽은 코드로 빠진다
//   G 로고: docs/design/google/에 공식 G 로고 파일이 생기면(K7) 앱 assets/google/에 같은 바이트로 들어 있어야 한다. 그 전엔 건너뜀
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';

import { ACCOUNT } from '../test-support/design-table';
import { hits, MOBILE_ROOT, REPO_ROOT, sourceFiles } from '../test-support/source-files';
import { createClientCalls } from '../test-support/supabase-mock';

const files = sourceFiles();

// ---------- C5 이메일 일부 ----------

describe('C5 maskEmail', () => {
  const { maskEmail } = require('@/lib/mask-email') as { maskEmail: (email: string) => string };

  test.each([
    ['seunghyun@gmail.com', 'se***@gmail.com'], // 리뷰 §1 예
    ['abc@x.com', 'ab***@x.com'], // 3글자 = 2글자 넘음 -> 앞 2글자
    ['ab@x.com', 'a***@x.com'], // 경계: 2글자 이하 -> 1글자
    ['a@x.com', 'a***@x.com'],
  ])('T12_C5_%s는_%s', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });

  test('T12_C5_속성_앞부분은_길이_2_이하면_1글자_넘으면_2글자만_도메인은_그대로', () => {
    const local = fc.stringMatching(/^[a-z0-9._+-]{1,24}$/);
    const domain = fc.stringMatching(/^[a-z0-9-]{1,12}\.[a-z]{2,6}$/);
    fc.assert(
      fc.property(local, domain, (name, host) => {
        const shown = name.length <= 2 ? 1 : 2;
        expect(maskEmail(`${name}@${host}`)).toBe(`${name.slice(0, shown)}***@${host}`);
      }),
    );
  });
});

// ---------- C2 되돌아오기 주소 · PKCE ----------

describe('C2 설정', () => {
  test('T12_C2_앱_scheme은_tripfriends', () => {
    const app = JSON.parse(readFileSync(join(MOBILE_ROOT, 'app.json'), 'utf8'));
    expect(app.expo.scheme).toBe('tripfriends');
  });

  test('T12_C2_code_교환을_쓰려면_Supabase_클라이언트는_pkce', () => {
    require('@/lib/auth');
    expect(createClientCalls.at(-1)?.options?.auth?.flowType).toBe('pkce');
  });
});

// ---------- §4-12 토큰은 이름으로 읽는다 (TASK-011 AC-4와 같은 방식) ----------

test.each(Object.keys(ACCOUNT))('T12_S4_12_토큰_%s를_앱_소스가_이름으로_읽는다', (name) => {
  expect(files.filter(({ text }) => text.includes(`'${name}'`) || text.includes(`"${name}"`)).map(({ path }) => path).length).toBeGreaterThan(0);
});

// ---------- AC-6 개발용 가짜 로그인 공급자: 릴리스 번들에 0 ----------

describe('AC-6 가짜 로그인 공급자', () => {
  const FAKE = 'lib/dev-login.ts';

  test('T12_AC6_가짜_공급자는_한_파일에_표시_글자와_함께_있다', () => {
    const found = files.find(({ path }) => path === FAKE);
    expect(found).toBeDefined();
    expect(found!.text).toContain('DEV_FAKE_LOGIN');
    expect(hits(files.filter(({ path }) => path !== FAKE), /DEV_FAKE_LOGIN/)).toEqual([]); // 표시 글자는 그 파일에만
  });

  test('T12_AC6_가짜_공급자는_import로_부르지_않는다', () => {
    expect(hits(files, /(import|export)\s[^;]*['"][^'"]*dev-login['"]/)).toEqual([]);
    expect(hits(files, /import\(\s*['"][^'"]*dev-login['"]/)).toEqual([]);
  });

  test('T12_AC6_가짜_공급자_require는_모두_같은_줄에_DEV_가드', () => {
    const uses = hits(files, /require\(\s*['"][^'"]*dev-login['"]\s*\)/);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((line) => !/__DEV__/.test(line))).toEqual([]);
  });
});

// ---------- §9 1·K7 G 로고는 공식 파일 그대로 ----------

const OFFICIAL_DIR = join(REPO_ROOT, 'docs', 'design', 'google');
// 지금 docs/design/google/에는 Google Maps 로고만 있다. 로그인 버튼용 G 로고 파일 이름은 아직 모른다 -> Maps 로고가 아닌 svg·png를 G 로고로 본다
const officialG = existsSync(OFFICIAL_DIR) ? readdirSync(OFFICIAL_DIR).filter((name) => /\.(svg|png)$/i.test(name) && !/^GoogleMaps_/i.test(name)) : [];

(officialG.length > 0 ? test : test.skip)('T12_S9_1_K7_공식_G_로고_파일이_앱_assets에_같은_바이트로_있다', () => {
  const assets = join(MOBILE_ROOT, 'assets', 'google');
  const copies = existsSync(assets) ? readdirSync(assets).map((name) => readFileSync(join(assets, name))) : [];
  const matched = officialG.filter((name) => copies.some((copy) => copy.equals(readFileSync(join(OFFICIAL_DIR, name)))));
  expect(matched.length).toBeGreaterThan(0);
});
