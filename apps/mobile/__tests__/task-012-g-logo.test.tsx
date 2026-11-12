/// <reference types="jest" />
// TASK-012 §19 F3·K7: Google 로그인 버튼의 G 로고는 공식 파일 그대로 (§16 Q12의 SVG를 PNG로 바꿈).
// 근거: TASK-012 §19 F3("docs/design/google/g-logo.png·@2x·@3x -> 앱 assets/google/에 같은 바이트로. 새 G 로고 SVG는 react-native-svg가 못 그림"),
//   docs/design/google/g-logo-README.md(20pt, G 자리만 잘라 냄, 색·모양 손대지 않음), 리뷰 파일 §2(G 20, 바꾸지 않음), DESIGN-001 §4-12 google-btn.
// 늘 켜져 있다: 파일이 없으면 실패한다 (건너뜀 0).
//
// 계약 (이 테스트가 정한 것, 승인 대기):
//   Google 버튼 부품 = src/account/google-button.tsx 의 GoogleButton (testID 'google-continue', 지금 이름 그대로)
//   G는 <Image source={require('…/assets/google/g-logo.png')}> 하나 (@2x·@3x는 React Native가 고른다), 크기 = 토큰 google-btn.logo(20)
//   G는 읽기 도구에 따로 읽히지 않는다 -> 버튼의 이름은 「Google 계정으로 계속」 그대로
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ACCOUNT } from '../test-support/design-table';
import { hits, MOBILE_ROOT, REPO_ROOT, sourceFiles } from '../test-support/source-files';

const NAMES = ['g-logo.png', 'g-logo@2x.png', 'g-logo@3x.png'];
const OFFICIAL = join(REPO_ROOT, 'docs', 'design', 'google');
const APP = join(MOBILE_ROOT, 'assets', 'google');

type Host = { type: string; props: Record<string, any>; queryAll: (p: (h: Host) => boolean) => Host[] };

test.each(NAMES)('T12_S19_F3_공식_%s가_docs에_있다', (name) => {
  expect(existsSync(join(OFFICIAL, name))).toBe(true);
});

test.each(NAMES)('T12_S19_F3_앱_assets_google_%s는_docs와_같은_바이트', (name) => {
  expect(existsSync(join(APP, name))).toBe(true);
  expect(readFileSync(join(APP, name)).equals(readFileSync(join(OFFICIAL, name)))).toBe(true);
});

describe('Google 버튼이 G PNG를 그린다', () => {
  function renderButton() {
    const { GoogleButton } = require('@/account/google-button');
    return render(<GoogleButton onPress={() => undefined} />);
  }

  test('T12_S19_F3_버튼_안에_g_logo_png_이미지_하나·크기_20', async () => {
    await renderButton();
    const button = screen.getByTestId('google-continue') as unknown as Host;
    const images = button.queryAll((host) => host.type === 'Image');
    expect(images).toHaveLength(1);
    expect(images[0].props.source).toEqual(require('../assets/google/g-logo.png'));
    const style = StyleSheet.flatten(images[0].props.style) ?? {};
    expect(style.width).toBe(ACCOUNT['google-btn'].logo);
    expect(style.height).toBe(ACCOUNT['google-btn'].logo);
  });

  test('T12_S19_F3_G는_읽기_도구에_따로_안_읽히고_버튼_이름은_Google_계정으로_계속', async () => {
    await renderButton();
    expect(screen.getByRole('button', { name: 'Google 계정으로 계속' })).toBeTruthy();
    const [image] = (screen.getByTestId('google-continue') as unknown as Host).queryAll((host) => host.type === 'Image');
    expect(image).toBeDefined();
    expect(image.props.accessible === true || typeof image.props.accessibilityLabel === 'string' || typeof image.props.alt === 'string').toBe(false);
    expect(within(screen.getByTestId('google-continue')).getAllByText('Google 계정으로 계속')).toHaveLength(1);
  });
});

test('T12_S19_F3_앱은_SVG_G_로고를_쓰지_않는다', () => {
  const files = sourceFiles();
  // 주석 줄은 빼고 본다 (코드가 SVG를 부르는지)
  expect(hits(files, /g-logo\.svg|signin-icon[^'"]*\.svg/).filter((line) => !/:\s*(\/\/|\*|\{\/\*)/.test(line.replace(/^[^:]+:\d+:/, ':')))).toEqual([]);
  const button = files.find(({ path }) => path === 'account/google-button.tsx');
  expect(button).toBeDefined();
  expect(button!.text).not.toMatch(/react-native-svg/);
  expect(existsSync(join(APP, 'g-logo.svg'))).toBe(false);
});
