/// <reference types="jest" />
// 서버 상태 화면 테스트. 근거: TASK-001 §4 AC-3·AC-20, §9-1 AC-20, TASK-004 §12 Q27(경로 이동). 서버 /health는 가짜 응답으로.
import { render, screen } from '@testing-library/react-native';

import HomeScreen from '@/app/dev/health';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('AC20_서버가_카드_23개를_주면_카드_23개_로드됨을_보여줌', async () => {
  const fetchMock = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(jsonResponse(200, { ok: true, cards: 23 }));

  await render(<HomeScreen />);

  expect(await screen.findByText('카드 23개 로드됨')).toBeOnTheScreen();
  expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/health$/);
});

test.each([
  ['서버 오류 500', () => Promise.resolve(jsonResponse(500, { detail: 'error' }))],
  ['연결 실패', () => Promise.reject(new TypeError('Network request failed'))],
])('AC20_%s면_서버에_연결할_수_없어요를_보여줌', async (_name, respond) => {
  jest.spyOn(globalThis, 'fetch').mockImplementation(respond);

  await render(<HomeScreen />);

  expect(await screen.findByText('서버에 연결할 수 없어요')).toBeOnTheScreen();
  expect(screen.queryByText(/카드 \d+개 로드됨/)).toBeNull();
});
