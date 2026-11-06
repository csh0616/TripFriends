// B7: 숙소 원 안의 집 아이콘 선 2개(지붕, 벽)를 Polyline의 points 글자로 만든다.
// 24칸 좌표를 size 칸으로 줄여 가운데 (cx, cy)에 놓는다. 변환(G transform)을 쓰지 않으려고 좌표를 직접 계산한다.
import { control } from '@/planning/theme';

const ROOF: [number, number][] = [
  [4, 11],
  [12, 4],
  [20, 11],
];
const WALL: [number, number][] = [
  [6, 9.5],
  [6, 20],
  [18, 20],
  [18, 9.5],
];

export function homeIconLines(cx: number, cy: number, size: number): string[] {
  const scale = size / control.icon;
  const center = control.icon / 2;
  return [ROOF, WALL].map((line) =>
    line.map(([x, y]) => `${cx + (x - center) * scale},${cy + (y - center) * scale}`).join(' '),
  );
}
