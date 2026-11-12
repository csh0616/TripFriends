/// <reference types="jest" />
// TASK-013 §9 Q4: Node·pnpm을 맥 값으로 고정하고, "나온 지 얼마 안 된 패키지" 안전장치를 pnpm-workspace.yaml에 명시한다 (맥·CI가 같은 규칙).
// 파일은 backend가 만든다. 이 테스트는 값만 본다. 앱 작업 목록(MOBILE_PATHS)에 .node-version·pnpm-workspace.yaml이 있는 이유가 이 파일이다 (§9 Q3).
// minimumReleaseAge 값은 문서에 숫자가 없어(맥 `pnpm config get minimumReleaseAge` = undefined) 양의 정수인지만 본다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from '../test-support/source-files';

const MAC_NODE = '26.10.0'; // §9 Q4
const MAC_PNPM = 'pnpm@12.15.0'; // §9 Q4

test('T13_Q4_루트_package_json의_packageManager가_맥_pnpm', () => {
  const root = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  expect(root.packageManager).toBe(MAC_PNPM);
});

test('T13_Q4_node_version이_맥_Node', () => {
  const path = join(REPO_ROOT, '.node-version');
  expect(existsSync(path)).toBe(true);
  expect(readFileSync(path, 'utf8').trim()).toBe(MAC_NODE);
});

test('T13_Q4_테스트를_돌리는_Node가_고정한_버전', () => {
  const path = join(REPO_ROOT, '.node-version');
  expect(existsSync(path)).toBe(true);
  expect(process.version).toBe(`v${readFileSync(path, 'utf8').trim()}`);
});

test('T13_Q4_B4_pnpm_workspace에_minimumReleaseAge가_양의_정수로_있다', () => {
  const text = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
  const match = text.match(/^minimumReleaseAge:\s*(\d+)\s*$/m);
  expect(match).not.toBeNull();
  expect(Number(match![1])).toBeGreaterThan(0);
});
