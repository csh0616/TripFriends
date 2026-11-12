/// <reference types="jest" />
// TASK-012 §18 "서버 도시 이름 표": 서버 표와 앱 표의 도시 코드·이름이 같은지 (어느 여행 시트는 서버가 준 이름을 그대로 쓰고,
// 날짜 목록 머리는 앱 표를 쓴다 -> 어긋나면 같은 여행이 두 이름으로 보인다).
//
// 방법 (승인 대기): 이 테스트 하나가 두 소스 파일을 읽어 표를 꺼내 비교한다 (공용 데이터 파일을 새로 만들지 않는다).
//   서버: apps/server/trip/link.py 의 `CITY_NAMES = {"osaka": "오사카", ...}` (파이썬 dict, 글자는 큰따옴표)
//   앱:   apps/mobile/src/lib/day-list.ts 의 `CITY_NAME ... = { osaka: '오사카', ... }`
//   표 이름이나 파일이 바뀌어 못 찾으면 이 테스트가 실패한다 (조용히 통과하지 않게)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT, SRC } from '../test-support/source-files';

const SERVER_FILE = join(REPO_ROOT, 'apps', 'server', 'trip', 'link.py');
const APP_FILE = join(SRC, 'lib', 'day-list.ts');

function serverTable(): Record<string, string> {
  const found = readFileSync(SERVER_FILE, 'utf8').match(/^CITY_NAMES\s*(?::[^=]+)?=\s*(\{[^}]*\})/m);
  expect(found).not.toBeNull();
  return JSON.parse(found![1].replace(/,\s*\}/, '}'));
}

function appTable(): Record<string, string> {
  const found = readFileSync(APP_FILE, 'utf8').match(/const CITY_NAME\b[^=]*=\s*(\{[^}]*\})/);
  expect(found).not.toBeNull();
  const pairs = [...found![1].matchAll(/['"]?([a-z_]+)['"]?\s*:\s*['"]([^'"]+)['"]/g)].map((m) => [m[1], m[2]]);
  return Object.fromEntries(pairs);
}

test('T12_S18_서버와_앱의_도시_이름_표가_같다', () => {
  const server = serverTable();
  const app = appTable();
  expect(Object.keys(app).length).toBeGreaterThan(0);
  expect(server).toEqual(app);
});

test('T12_S18_지금_도시_osaka는_오사카', () => {
  expect(serverTable().osaka).toBe('오사카');
  expect(appTable().osaka).toBe('오사카');
});
