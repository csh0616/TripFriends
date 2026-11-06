// 여행 중 화면 테스트 공용 도구: S9를 거쳐 SC-04까지 간다. 판단 로직은 없다.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { act, screen } from '@testing-library/react-native';
import Constants from 'expo-constants';

import { json, type Reply } from './fake-server';
import { happyServer, pressText, R, toS9 } from './planning-driver';
import { done } from './planning-fixtures';
import { MOBILE_ROOT } from './source-files';
import { NOW_ROUTE, nowView } from './trip-now-fixtures';

export const ENTER = '여행 중 화면 보기(데모)';
export const KEY_NAME = 'GOOGLE_MAPS_IOS_API_KEY';
export const TEST_KEY = 'TEST_ONLY_NOT_A_REAL_KEY';

/** 키 값을 넣거나 빼고 app.config를 새로 불러 결과를 돌려준다. 실제 env 파일은 읽지 않는다. */
export function buildConfig(key: string | null): Record<string, any> {
  const saved = process.env[KEY_NAME];
  if (key === null) delete process.env[KEY_NAME];
  else process.env[KEY_NAME] = key;
  try {
    const appJson = join(MOBILE_ROOT, 'app.json');
    const config = existsSync(appJson) ? require(appJson).expo : {};
    let built: unknown;
    jest.isolateModules(() => {
      const loaded = require('../app.config');
      const made = loaded.default ?? loaded;
      built = typeof made === 'function' ? made({ config }) : made;
    });
    return built as Record<string, any>;
  } finally {
    if (saved === undefined) delete process.env[KEY_NAME];
    else process.env[KEY_NAME] = saved;
  }
}

/**
 * 앱이 빌드 결과를 보는 길은 Constants.expoConfig뿐이다 (EXPO_PUBLIC_ 금지). 환경값을 넣어 만든 설정을 그 자리에 둔다.
 * 진짜 Constants는 이 값을 바꿀 수 없어서, 쓰는 테스트 파일이 expo-constants를 FAKE_CONSTANTS로 가짜로 둔다.
 */
export function installConfig(key: string | null) {
  (Constants as unknown as { expoConfig: unknown }).expoConfig = buildConfig(key);
}

export type NowRequest = { path: string; at: string | null; lat: string | null; lng: string | null };

const param = (query: string, name: string) => {
  const found = query.split('&').find((pair) => pair.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
};

export function nowServer(initial: object = nowView()) {
  const server = happyServer();
  server.on(R.get, json(200, done));
  // 서버처럼 보낸 at을 응답에 그대로 싣는다 (§A-1)
  const echo = (view: object) => (at: string | null) => json(200, { ...view, at });
  let reply: Reply | ((at: string | null) => Reply) = echo(initial);
  const queue: (Reply | Promise<Reply>)[] = [];
  server.match(NOW_ROUTE, (sent) => {
    const queued = queue.shift();
    if (queued) return queued;
    return typeof reply === 'function' ? reply(param(sent.path.split('?')[1] ?? '', 'at')) : reply;
  });
  return {
    server,
    show: (view: object) => {
      reply = echo(view);
    },
    reply: (next: Reply | ((at: string | null) => Reply)) => {
      reply = next;
    },
    once: (next: Reply) => {
      queue.push(next);
    },
    /** 다음 한 번은 테스트가 풀어 줄 때까지 기다린다 */
    defer: () => {
      let resolve!: (next: Reply) => void;
      queue.push(new Promise<Reply>((done_) => (resolve = done_)));
      return resolve;
    },
    requests: (): NowRequest[] =>
      server.requests
        .filter((r) => r.method === 'GET' && r.path.split('?')[0] === NOW_ROUTE.slice(4))
        .map((r) => {
          const query = r.path.split('?')[1] ?? '';
          return { path: r.path, at: param(query, 'at'), lat: param(query, 'lat'), lng: param(query, 'lng') };
        }),
  };
}

export type NowControl = ReturnType<typeof nowServer>;

/** S9 → [여행 중 화면 보기(데모)] → 첫 카드가 보일 때까지 */
export async function toNow(control: NowControl = nowServer()) {
  const app = await toS9();
  await pressText(ENTER);
  await screen.findByTestId('trip-now-screen');
  await screen.findByTestId('now-main');
  return { app, control };
}

/** 가짜 타이머를 켠 뒤 시간을 민다 */
export const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

/** 재생처럼 시간이 흐르는 동안 화면 갱신이 끼어야 할 때: 100ms씩 나눠 민다 */
export async function flow(ms: number) {
  for (let passed = 0; passed < ms; passed += 100) await advance(Math.min(100, ms - passed));
}
