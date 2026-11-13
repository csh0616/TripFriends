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
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/** 권한 설명 키 (NS...UsageDescription, ...Dictionary 포함), 이름순 */
const permissionKeys = (plist: Record<string, any>): string[] =>
  Object.keys(plist)
    .filter((key) => /^NS.*UsageDescription(Dictionary)?$/.test(key))
    .sort();

type BuildPhase = { name: string; script: string };

/**
 * 앱 설정의 expo-dev-client 플러그인이 Xcode 프로젝트에 거는 셸 빌드 단계 (이름·스크립트 글자 그대로).
 * prebuild·Xcode 없이: 그 플러그인 하나만 얹은 설정의 ios.xcodeproj mod에 "받아 적기만 하는" 가짜 프로젝트를 준다.
 * 가짜 프로젝트는 단계 내용을 흉내 내지 않고, 플러그인이 넘긴 스크립트를 그대로 받아 둔다.
 */
async function devClientBuildPhases(): Promise<BuildPhase[]> {
  const { withPlugins } = require('expo/config-plugins');
  const built = appConfig();
  const name = (plugin: unknown) => (Array.isArray(plugin) ? plugin[0] : plugin);
  const devClient = (built.plugins ?? []).filter((plugin: unknown) => name(plugin) === 'expo-dev-client');
  expect(devClient).toHaveLength(1); // 시험 자체 확인: 앱 설정에 개발 런처가 있다 (app.config.ts)
  const withDev = withPlugins({ name: built.name, slug: built.slug, _internal: { projectRoot: MOBILE_ROOT } }, devClient);
  const mod = withDev.mods?.ios?.xcodeproj;
  expect(typeof mod).toBe('function');
  const phases: BuildPhase[] = [];
  const target = { buildPhases: [] as { value: string; comment?: string }[] };
  const project = {
    findTargetKey: (targetName: string) => (targetName === built.name ? 'TARGET' : null),
    pbxNativeTargetSection: () => ({ TARGET: target }),
    addBuildPhase: (_files: unknown, isa: string, phaseName: string, _target: unknown, options: { shellScript?: string }) => {
      if (isa === 'PBXShellScriptBuildPhase') phases.push({ name: phaseName, script: options?.shellScript ?? '' });
      target.buildPhases.push({ value: `PHASE${phases.length}`, comment: phaseName });
    },
  };
  await mod({
    ...withDev,
    modResults: project,
    modRequest: { projectRoot: MOBILE_ROOT, platformProjectRoot: join(MOBILE_ROOT, 'ios'), projectName: built.name, modName: 'xcodeproj', platform: 'ios', introspect: true },
  });
  return phases;
}

/**
 * 최종 Info.plist를 임시 폴더에 파일로 쓰고, 개발 런처의 빌드 단계 스크립트를 Xcode가 주는 환경 변수로 돌린 뒤 다시 읽는다.
 * debug = Xcode의 SWIFT_ACTIVE_COMPILATION_CONDITIONS에 DEBUG가 있는지 (Debug 구성 = 있음, Release = 없음).
 */
async function afterBuildPhases(plist: Record<string, any>, { debug }: { debug: boolean }): Promise<Record<string, any>> {
  const phases = (await devClientBuildPhases()).filter((phase) => /Strip Local Network Keys for Release/.test(phase.name));
  expect(phases).toHaveLength(1);
  const dir = mkdtempSync(join(tmpdir(), 'tf-plist-'));
  try {
    writeFileSync(join(dir, 'Info.json'), JSON.stringify(plist));
    execFileSync('/usr/bin/plutil', ['-convert', 'xml1', join(dir, 'Info.json'), '-o', join(dir, 'Info.plist')]);
    writeFileSync(join(dir, 'phase.sh'), phases[0].script);
    execFileSync('/bin/sh', [join(dir, 'phase.sh')], {
      env: { PATH: '/usr/bin:/bin', TARGET_BUILD_DIR: dir, INFOPLIST_PATH: 'Info.plist', SWIFT_ACTIVE_COMPILATION_CONDITIONS: debug ? 'DEBUG' : '' },
    });
    return JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(dir, 'Info.plist')], { encoding: 'utf8' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

  // §15 Q4 + §16 Q2: 앱이 실제로 묻지 않는 권한의 설명은 넣지 않는다 (정확한 위치 임시 요청·동작 센서·Face ID 등 플러그인 기본 문구 포함).
  //   앱이 묻는 권한은 위치 "앱 사용 중" 하나 (src/now/use-live-location.ts requestForegroundPermissionsAsync).
  //   §16 Q2: 로컬 네트워크 문구(NSLocalNetworkUsageDescription)는 expo-dev-client(개발 런처)가 Metro를 찾으려고 넣는 것이라 **개발 빌드에서만** 허용.
  //   그래서 둘로 본다: 개발 설정 = 위치 "앱 사용 중" + 로컬 네트워크 / 릴리스 설정 = 위치 "앱 사용 중" 하나뿐.
  test('T14_S16_Q2_개발_설정_권한_설명_키는_위치_앱_사용_중과_개발_런처_로컬_네트워크뿐', async () => {
    const plist = await finalInfoPlist();
    expect(permissionKeys(plist)).toEqual(['NSLocalNetworkUsageDescription', 'NSLocationWhenInUseUsageDescription']);
  });

  test('T14_S16_Q2_릴리스에서_로컬_네트워크_문구를_지우는_빌드_단계가_앱_설정에_걸려_있다', async () => {
    // 릴리스 설정은 Info.plist mod만으로는 안 나온다: 개발 런처는 키를 늘 넣고, 릴리스 빌드에서 Xcode 빌드 단계(셸 스크립트)가 지운다.
    // 여기서는 앱 설정의 expo-dev-client 플러그인이 그 빌드 단계를 Xcode 프로젝트에 거는지 본다 (리눅스 CI에서도 돎)
    const phases = await devClientBuildPhases();
    const strip = phases.filter((phase) => /Strip Local Network Keys for Release/.test(phase.name));
    expect(strip).toHaveLength(1);
    expect(strip[0].script).toContain('NSLocalNetworkUsageDescription');
  });

  // 진짜 릴리스 빌드 단계 스크립트(플러그인이 거는 그 글자 그대로)를 최종 Info.plist 파일에 돌려 본다.
  // PlistBuddy·plutil(macOS 도구)이 있어야 해서 macOS에서만 돈다. 리눅스 CI에서는 건너뛴다 -> reviewer가 릴리스 빌드에서 직접 확인 (§16 Q2)
  const onMac = process.platform === 'darwin' && existsSync('/usr/libexec/PlistBuddy') && existsSync('/usr/bin/plutil');
  (onMac ? test : test.skip)('T14_S16_Q2_릴리스_설정_권한_설명_키는_위치_앱_사용_중_하나뿐_macOS_빌드_단계_실행', async () => {
    const plist = await afterBuildPhases(await finalInfoPlist(), { debug: false });
    expect(permissionKeys(plist)).toEqual(['NSLocationWhenInUseUsageDescription']);
  });

  (onMac ? test : test.skip)('T14_S16_Q2_시험_자체_확인_같은_빌드_단계가_DEBUG면_그대로_두고_릴리스면_개발_런처_키만_지운다_macOS', async () => {
    // 파일 쓰기·읽기 왕복과 스크립트 실행이 맞는지: DEBUG는 바뀌는 것 0, 릴리스는 로컬 네트워크 문구와 _expo._tcp만 빠진다
    const plist = await finalInfoPlist();
    expect(await afterBuildPhases(plist, { debug: true })).toEqual(plist);
    const release = await afterBuildPhases(plist, { debug: false });
    const removed = Object.keys(plist).filter((key) => !(key in release));
    expect(plist.NSLocalNetworkUsageDescription).toBeDefined();
    expect(removed).toContain('NSLocalNetworkUsageDescription');
    for (const key of removed) expect(['NSLocalNetworkUsageDescription', 'NSBonjourServices']).toContain(key);
    expect(release.NSBonjourServices ?? []).not.toContain('_expo._tcp');
  });

  test('T14_S15_Q4_도구_자체_확인_권한_설명_키_고르기', () => {
    const keys = ['NSLocationWhenInUseUsageDescription', 'NSLocationTemporaryUsageDescriptionDictionary', 'NSMotionUsageDescription', 'NSFaceIDUsageDescription', 'CFBundleName', 'UIBackgroundModes'];
    expect(keys.filter((key) => /^NS.*UsageDescription(Dictionary)?$/.test(key))).toEqual(keys.slice(0, 4));
  });
});
