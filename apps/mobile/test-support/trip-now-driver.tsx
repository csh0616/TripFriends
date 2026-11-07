// 여행 중 화면 테스트 공용 도구: S9를 거쳐 SC-04까지 간다. 판단 로직은 없다.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { act, screen, waitFor } from '@testing-library/react-native';
import Constants from 'expo-constants';

import { json, type Reply } from './fake-server';
import { happyServer, pressText, R, toS9 } from './planning-driver';
import { done } from './planning-fixtures';
import { MOBILE_ROOT } from './source-files';
import { CHECK_ROUTE, NOW_ROUTE, nowView } from './trip-now-fixtures';

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

/**
 * 화면이 서버에 "지금"을 묻는 요청 한 개. TASK-007 C1부터 두 가지다:
 *  - now: GET /days/{id}/now?at= (재실행 복구·첫 요청, 위치 쿼리는 서버가 무시)
 *  - check: POST /days/{id}/check 본문 {at, lat, lng} (시각이 바뀔 때, 위치는 본문)
 * at·lat·lng는 어느 쪽이든 같은 자리에서 읽는다 (쿼리 또는 본문, 글자로). TASK-006 테스트는 둘을 합친 목록을 본다.
 */
export type NowRequest = { kind: 'now' | 'check'; path: string; at: string | null; lat: string | null; lng: string | null; body?: unknown };

const param = (query: string, name: string) => {
  const found = query.split('&').find((pair) => pair.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
};

const field = (body: unknown, name: string): string | null => {
  const value = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined;
  return value === undefined || value === null ? null : String(value);
};

export function nowServer(initial: object = nowView()) {
  const server = happyServer();
  server.on(R.get, json(200, done));
  // 서버처럼 보낸 at을 응답에 그대로 싣는다 (§A-1)
  const echo = (view: object) => (at: string | null) => json(200, { ...view, at });
  let reply: Reply | ((at: string | null) => Reply) = echo(initial);
  const hasPins = (initial as { pins?: unknown[] }).pins?.length !== 0;
  const queue: (Reply | Promise<Reply>)[] = [];
  // GET /now와 POST /check는 같은 응답 줄을 쓴다 (once·defer·show가 어느 쪽에든 걸린다)
  const answer = (at: string | null) => {
    const queued = queue.shift();
    if (queued) return queued;
    return typeof reply === 'function' ? reply(at) : reply;
  };
  server.match(NOW_ROUTE, (sent) => answer(param(sent.path.split('?')[1] ?? '', 'at')));
  server.match(CHECK_ROUTE, (sent) => answer(field(sent.body, 'at')));
  const all = (): NowRequest[] =>
    server.requests
      .filter(
        (r) =>
          (r.method === 'GET' && r.path.split('?')[0] === NOW_ROUTE.slice(4)) || (r.method === 'POST' && r.path === CHECK_ROUTE.slice(5)),
      )
      .map((r) => {
        if (r.method === 'POST') {
          return { kind: 'check', path: r.path, at: field(r.body, 'at'), lat: field(r.body, 'lat'), lng: field(r.body, 'lng'), body: r.body };
        }
        const query = r.path.split('?')[1] ?? '';
        return { kind: 'now', path: r.path, at: param(query, 'at'), lat: param(query, 'lat'), lng: param(query, 'lng') };
      });
  return {
    server,
    hasPins,
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
    /** GET /now와 POST /check를 보낸 순서대로 */
    requests: all,
    gets: () => all().filter((r) => r.kind === 'now'),
    checks: () => all().filter((r) => r.kind === 'check'),
  };
}

export type NowControl = ReturnType<typeof nowServer>;

/** S9 → [여행 중 화면 보기(데모)] → 첫 카드가 보일 때까지 */
export async function toNow(control: NowControl = nowServer()) {
  const app = await toS9();
  await pressText(ENTER);
  await screen.findByTestId('trip-now-screen');
  await screen.findByTestId('now-main');
  // §12 R7: 첫 응답의 핀으로 위치를 계산해 한 번 더 부른다(TASK-007부터 그 한 번은 check). 그 요청까지 끝난 뒤를 시작점으로 삼는다
  if (control.hasPins) await waitFor(() => expect(control.requests().length).toBeGreaterThanOrEqual(2));
  await act(async () => undefined);
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

// ---------- §13 E3: 점선은 lineDashPattern이든 짧은 조각(dashSegments)이든 통과한다 ----------

export type LatLng = { latitude: number; longitude: number };
export type LineHost = { props: Record<string, any> };

function onPath(point: LatLng, path: LatLng[]): boolean {
  return path.slice(1).some((end, index) => {
    const start = path[index];
    const [ax, ay, bx, by, px, py] = [start.latitude, start.longitude, end.latitude, end.longitude, point.latitude, point.longitude];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
    return Math.abs(cross) < 1e-9 && dot >= -1e-12 && dot <= (bx - ax) ** 2 + (by - ay) ** 2 + 1e-12;
  });
}

const near = (a: LatLng, b: LatLng) => Math.abs(a.latitude - b.latitude) < 1e-6 && Math.abs(a.longitude - b.longitude) < 1e-6;

/** 선 하나 + 점선 값, 또는 끊어진 짧은 선 조각 여러 개. 어느 쪽인지 돌려주고, 아니면 던진다 */
export function expectDashedAlong(hosts: LineHost[], path: LatLng[], dash: number[]): 'pattern' | 'segments' {
  expect(hosts.length).toBeGreaterThan(0);
  if (hosts.length === 1) {
    expect(hosts[0].props.coordinates).toEqual(path);
    expect(hosts[0].props.lineDashPattern).toEqual(dash);
    return 'pattern';
  }
  const pieces = hosts.map((host) => host.props.coordinates as LatLng[]);
  for (const host of hosts) expect(host.props.lineDashPattern ?? []).toEqual([]);
  for (const piece of pieces) {
    expect(piece.length).toBeGreaterThanOrEqual(2);
    for (const point of piece) expect(onPath(point, path)).toBe(true);
  }
  expect(near(pieces[0][0], path[0])).toBe(true);
  expect(onPath(pieces[pieces.length - 1][pieces[pieces.length - 1].length - 1], path.slice(-2))).toBe(true);
  // 조각 사이가 실제로 비어 있어야 점선이다
  expect(pieces.slice(1).some((piece, index) => !near(piece[0], pieces[index][pieces[index].length - 1]))).toBe(true);
  return 'segments';
}
