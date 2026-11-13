/// <reference types="jest" />
// TASK-014 §13 1·§14 ①④: Maestro 흐름의 계약.
// ① 개발 메뉴의 떠 있는 버튼(톱니)이 화면을 덮지 않게: 앱을 여는 주소(openLink, expo-development-client)에 `__expo_disable_fab=1`.
//    §13에서 넣은 launchApp 실행 인자 EXDevMenuShowFloatingActionButton은 실제로 효과가 없었다(reviewer 재점검) -> 흐름에서 뺐다. 이 테스트도 더는 보지 않는다.
// ④ 시각 막대는 **비율로 시각을 고르지 않는다**(기기 폭이 달라지면 99%·31% 같은 좁은 칸이 다른 5분으로 떨어진다):
//    막대는 맨 앞(0% = 하루 시작, 폭과 상관없이 locationX 0)만 누르고, 그 뒤 시각은 [+10분]을 정한 횟수만큼 눌러 고른다.
// 계약: .maestro/ 바로 아래 흐름(단독으로 돌리는 것)만 본다. common/은 runFlow로만 불리는 조각이라 뺀다.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MOBILE_ROOT } from '../test-support/source-files';

const DIR = join(MOBILE_ROOT, '.maestro');
const flows = readdirSync(DIR).filter((name) => name.endsWith('.yaml'));
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');

/** 앱을 여는 주소 (개발 빌드 런처로 Metro를 여는 openLink) */
const devLinks = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => /^\s*-\s*openLink:\s*(\S.*)$/.exec(line)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? null)
    .filter((link): link is string => link !== null && link.includes('expo-development-client'));

/** demo-bar를 누르는 단계마다 그 point 값 (point가 없으면 "가운데") */
function barPoints(text: string): string[] {
  const lines = text.split('\n');
  const points: string[] = [];
  lines.forEach((line, index) => {
    if (!/id:\s*"demo-bar"/.test(line)) return;
    const indent = line.search(/\S/);
    let point = '가운데';
    for (let i = index + 1; i < lines.length && lines[i].search(/\S/) >= indent && lines[i].trim() !== ''; i += 1) {
      const found = /^\s*point:\s*"([^"]+)"/.exec(lines[i]);
      if (found) point = found[1];
    }
    points.push(point);
  });
  return points;
}

test('T14_S13_1_시험_자체_확인_흐름이_있다', () => {
  expect(flows).toEqual(expect.arrayContaining(['rehearsal.yaml', 'trip-now.yaml', 'trip-delay.yaml', 'trip-closed.yaml']));
  expect(flows).toHaveLength(7);
});

test.each(flows)('T14_S14_1_%s의_앱을_여는_주소는_개발_메뉴_버튼을_끈다__expo_disable_fab_1', (name) => {
  const links = devLinks(read(name));
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    const query = link.split('?')[1] ?? '';
    expect(query.split('&')).toContain('__expo_disable_fab=1');
  }
});

test('T14_S14_1_도구_자체_확인_주소_읽기', () => {
  const sample = '- openLink: exp+mobile://expo-development-client/?url=${METRO_URL}&disableOnboarding=1&__expo_disable_fab=1\n';
  expect(devLinks(sample)).toEqual(['exp+mobile://expo-development-client/?url=${METRO_URL}&disableOnboarding=1&__expo_disable_fab=1']);
  expect(devLinks('- openLink: https://example.test/\n')).toEqual([]);
});

test.each(flows)('T14_S14_4_%s는_시각_막대를_맨_앞_0퍼센트로만_누른다_비율로_시각을_고르지_않는다', (name) => {
  for (const point of barPoints(read(name))) expect(point).toMatch(/^0%,\s*\d+%$/);
});

test('T14_S14_4_도구_자체_확인_막대_누르기_읽기', () => {
  const sample = ['      - tapOn:', '          id: "demo-bar"', '          point: "99%,50%"', '      - tapOn:', '          id: "demo-bar"', '          point: "0%,50%"', ''].join('\n');
  expect(barPoints(sample)).toEqual(['99%,50%', '0%,50%']);
});

test.each(['trip-now.yaml', 'trip-delay.yaml', 'trip-closed.yaml'])('T14_S14_4_%s는_시각을_10분_단추로_고른다', (name) => {
  // 데모 시계 흐름 셋 다 이전엔 막대 비율로 시각을 골랐다 (trip-now 0·30·40·99%, trip-delay 31%, trip-closed 15%)
  expect(read(name)).toMatch(/id:\s*"demo-plus-10"/);
});

test('T14_S13_1_연습_흐름은_연습_끝내기를_누른다_좌표로_누르지_않는다', () => {
  const text = read('rehearsal.yaml');
  expect(text).toContain('tapOn: "연습 끝내기"');
  expect(text).not.toMatch(/point:/); // 좌표 탭 금지 (§13 1: 끄는 방법이 있으면 그쪽)
});
