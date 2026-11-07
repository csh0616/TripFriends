// 가짜 서버 (fetch mock). 경로별 응답과 받은 요청을 기록한다. 판단 로직은 없다.
export type Sent = { method: string; path: string; body: unknown };
export type Reply =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'text'; status: number; text: string }
  | { kind: 'network' }
  | { kind: 'hang' };
type Deferred = { promise: Promise<Reply>; resolve: (reply: Reply) => void };

export const json = (status: number, body: unknown): Reply => ({ kind: 'json', status, body });
export const networkDown: Reply = { kind: 'network' };
export const hang: Reply = { kind: 'hang' };
// JSON이 아닌 응답 (TASK-004 Q18)
export const notJson = (status: number, text = '<html>bad gateway</html>'): Reply => ({ kind: 'text', status, text });
// TASK-003 §5 공통 오류 형식
export const apiError = (status: number, code: string, detail: unknown = null, message = '서버_내부_오류_문장'): Reply =>
  json(status, { error: { code, message, detail } });

export class FakeServer {
  requests: Sent[] = [];
  unexpected: string[] = [];
  private routes = new Map<string, Reply>();
  private queued = new Map<string, (Reply | Deferred)[]>();
  private matchers: { prefix: string; reply: (sent: Sent) => Reply | Promise<Reply> }[] = [];
  private spy: jest.SpiedFunction<typeof fetch>;

  constructor() {
    this.spy = jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => this.handle(input, init));
  }

  /** 이 경로의 기본 응답 */
  on(route: string, reply: Reply) {
    this.routes.set(route, reply);
    return this;
  }

  /** 다음 한 번만 이 응답 */
  once(route: string, reply: Reply) {
    this.queue(route).push(reply);
    return this;
  }

  /** 다음 한 번은 테스트가 풀어 줄 때까지 기다린다 */
  defer(route: string): (reply: Reply) => void {
    let resolve!: (reply: Reply) => void;
    const promise = new Promise<Reply>((done) => {
      resolve = done;
    });
    this.queue(route).push({ promise, resolve });
    return resolve;
  }

  /** TASK-006: 쿼리가 붙는 경로. "메서드 경로" 앞부분이 같으면 이 함수가 응답을 정한다 (정확한 경로가 먼저) */
  match(prefix: string, reply: (sent: Sent) => Reply | Promise<Reply>) {
    this.matchers.push({ prefix, reply });
    return this;
  }

  sent(route: string): Sent[] {
    return this.requests.filter((r) => `${r.method} ${r.path}` === route);
  }

  last(): Sent {
    return this.requests[this.requests.length - 1];
  }

  private queue(route: string) {
    if (!this.queued.has(route)) this.queued.set(route, []);
    return this.queued.get(route)!;
  }

  private async handle(input: unknown, init?: RequestInit): Promise<Response> {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.replace(/^[a-z]+:\/\/[^/]+/i, '');
    const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
    this.requests.push({ method, path, body });
    const route = `${method} ${path}`;
    const matcher = this.matchers.find(({ prefix }) => route === prefix || route.startsWith(`${prefix}?`));
    const next: Reply | Deferred | undefined =
      this.queue(route).shift() ??
      this.routes.get(route) ??
      (matcher ? { promise: Promise.resolve(matcher.reply(this.last())), resolve: () => undefined } : undefined);
    if (next === undefined) {
      this.unexpected.push(route);
      throw new TypeError(`가짜 서버에 없는 경로: ${route}`);
    }
    const reply = 'promise' in next ? await raceAbort(next.promise, init?.signal) : next;
    if (reply.kind === 'network') throw new TypeError('Network request failed');
    if (reply.kind === 'hang') return raceAbort(new Promise<Response>(() => undefined), init?.signal);
    if (reply.kind === 'text') {
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
        text: async () => reply.text,
        headers: { get: () => 'text/html' },
      } as unknown as Response;
    }
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body),
      headers: { get: () => 'application/json' },
    } as unknown as Response;
  }
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    if (signal.aborted) abort();
    signal.addEventListener('abort', abort);
    promise.then(resolve, reject);
  });
}
