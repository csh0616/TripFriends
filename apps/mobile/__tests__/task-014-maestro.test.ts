/// <reference types="jest" />
// TASK-014 §13 1: Maestro 실행 때 개발 메뉴의 떠 있는 버튼(톱니)이 화면을 덮지 않게 끈다 ([연습 끝내기]·SOS를 덮어 흐름이 실패했다).
// 좌표로 피하지 않고 앱 실행 인자로 끈다: expo-dev-menu가 읽는 UserDefaults 키 EXDevMenuShowFloatingActionButton = false.
// 계약: .maestro/ 바로 아래 흐름(단독으로 돌리는 것)의 launchApp마다 arguments에 이 키가 false로 있다. common/은 runFlow로만 불리는 조각이라 뺀다.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MOBILE_ROOT } from '../test-support/source-files';

const DIR = join(MOBILE_ROOT, '.maestro');
const flows = readdirSync(DIR).filter((name) => name.endsWith('.yaml'));

/** launchApp 단계 하나의 글자 (다음 최상위 "- " 단계 전까지) */
function launchSteps(text: string): string[] {
  const lines = text.split('\n');
  const steps: string[] = [];
  lines.forEach((line, index) => {
    if (!/^- launchApp:?/.test(line)) return;
    const rest: string[] = [line];
    for (let i = index + 1; i < lines.length && !/^- /.test(lines[i]); i += 1) rest.push(lines[i]);
    steps.push(rest.join('\n'));
  });
  return steps;
}

test('T14_S13_1_시험_자체_확인_흐름이_있다', () => {
  expect(flows).toEqual(expect.arrayContaining(['rehearsal.yaml', 'trip-now.yaml']));
});

test.each(flows)('T14_S13_1_%s의_launchApp은_개발_메뉴_떠_있는_버튼을_끈다', (name) => {
  const steps = launchSteps(readFileSync(join(DIR, name), 'utf8'));
  expect(steps.length).toBeGreaterThan(0);
  for (const step of steps) {
    expect(step).toMatch(/\n\s+arguments:\s*\n(?:\s+.*\n)*?\s+EXDevMenuShowFloatingActionButton:\s*false\b/);
  }
});

test('T14_S13_1_연습_흐름은_연습_끝내기를_누른다_좌표로_누르지_않는다', () => {
  const text = readFileSync(join(DIR, 'rehearsal.yaml'), 'utf8');
  expect(text).toContain('tapOn: "연습 끝내기"');
  expect(text).not.toMatch(/point:/); // 좌표 탭 금지 (§13 1: 끄는 방법이 있으면 그쪽)
});
