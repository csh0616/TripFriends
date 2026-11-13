/** @jest-environment node */
/// <reference types="jest" />
// TASK-014 §14 ②: 위치 권한 설정은 "앱 설정에 적은 값"이 아니라 **플러그인을 거친 뒤의 최종 iOS 설정(Info.plist)**을 본다.
// 근거: TASK-014 §14 ②(Always 문구 두 값 false, 테스트는 prebuild 결과를 본다)·"배운 것"(설정은 최종 산출물을)·§13 2(Always·백그라운드 위치 키 0)·
//   §A A1(앱 사용 중만, 백그라운드 요청 없음)·§8(백그라운드 위치 요청 금지)·§10 Q9·DESIGN-001 §4-13(설명 문구 정본).
//
// 방법 (expo prebuild·expo config를 실행하지 않는다, 키·.env·.env.local 없이, 리눅스 CI에서도):
//   app.json + app.config.ts로 만든 설정(지도 키 변수는 비운다)에 그 설정의 plugins 전부를 expo/config-plugins의 withPlugins로 얹고,
//   prebuild가 Info.plist를 만들 때 부르는 ios.infoPlist mod 사슬을 introspect 모드로 직접 불러 나온 값을 본다 (파일을 쓰지 않는다).
//   expo-location만이 아니라 모든 플러그인을 거치므로 다른 플러그인이 위치 키를 넣어도 잡힌다.
// 지금 빨강인 이유: expo-location 플러그인은 옵션이 없으면 Always 두 키에 기본 영문 문구("Allow $(PRODUCT_NAME) ...")를 넣는다.
import { join } from 'node:path';

import { MOBILE_ROOT } from '../test-support/source-files';

const MAP_KEY = 'GOOGLE_MAPS_IOS_API_KEY';
const PLIST_TEXT = '지금 어디쯤인지 알아서, 일정이 늦어질 때 미리 알려 주려고 위치를 써요. 위치는 저장하지 않아요.';

/** app.json -> app.config.ts (지도 키 없이). 키 값을 읽지도 남기지도 않는다 */
function appConfig(): Record<string, any> {
  const saved = process.env[MAP_KEY];
  delete process.env[MAP_KEY];
  try {
    const base = require(join(MOBILE_ROOT, 'app.json')).expo;
    let built: Record<string, any> = {};
    jest.isolateModules(() => {
      const loaded = require('../app.config');
      const make = loaded.default ?? loaded;
      built = typeof make === 'function' ? make({ config: base }) : make;
    });
    return built;
  } finally {
    if (saved !== undefined) process.env[MAP_KEY] = saved;
  }
}

/** 플러그인을 모두 거친 최종 Info.plist (prebuild의 ios.infoPlist mod 사슬, introspect = 파일 쓰지 않음) */
async function finalInfoPlist(): Promise<Record<string, any>> {
  const { withPlugins } = require('expo/config-plugins');
  const built = appConfig();
  const withAll = withPlugins({ ...built, _internal: { projectRoot: MOBILE_ROOT } }, built.plugins ?? []);
  const mod = withAll.mods?.ios?.infoPlist;
  expect(typeof mod).toBe('function'); // 시험 자체 확인: 위치 플러그인이 Info.plist mod를 건다
  const out = await mod({
    ...withAll,
    modResults: { ...(built.ios?.infoPlist ?? {}) },
    modRequest: { projectRoot: MOBILE_ROOT, platformProjectRoot: join(MOBILE_ROOT, 'ios'), modName: 'infoPlist', platform: 'ios', introspect: true },
  });
  return out.modResults as Record<string, any>;
}

describe('§14 ② 최종 iOS 설정 (플러그인을 거친 뒤)', () => {
  test('T14_S14_2_시험_자체_확인_앱_사용_중_설명은_DESIGN_001_문구로_들어간다', async () => {
    const plist = await finalInfoPlist();
    expect(plist.NSLocationWhenInUseUsageDescription).toBe(PLIST_TEXT);
  });

  test('T14_S14_2_최종_Info_plist에_Always_설명_키가_없다', async () => {
    const plist = await finalInfoPlist();
    expect(Object.keys(plist)).not.toContain('NSLocationAlwaysAndWhenInUseUsageDescription');
    expect(Object.keys(plist)).not.toContain('NSLocationAlwaysUsageDescription');
  });

  test('T14_S14_2_최종_Info_plist의_백그라운드_모드에_location이_없다', async () => {
    const plist = await finalInfoPlist();
    expect(plist.UIBackgroundModes ?? []).not.toContain('location');
  });

  test('T14_S14_2_최종_Info_plist의_위치_설명에_기본_영문_문구가_하나도_없다', async () => {
    // 옵션을 빠뜨리면 플러그인이 넣는 기본 문구. 위치 설명 키 전부에 대해 본다
    const plist = await finalInfoPlist();
    const locationTexts = Object.entries(plist)
      .filter(([key]) => key.startsWith('NSLocation') && key.endsWith('UsageDescription'))
      .map(([, value]) => String(value));
    expect(locationTexts.length).toBeGreaterThan(0);
    for (const text of locationTexts) expect(text).not.toMatch(/Allow \$\(PRODUCT_NAME\)/);
  });
});
