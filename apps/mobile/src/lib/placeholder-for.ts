// TASK-004 §B-5, §B-6 G1: 자리표시 그라데이션 값을 둘 수 있는 유일한 파일 (차가운 톤, 토큰이 아님).
const MUSEUM: [string, string] = ['#9DB8BF', '#547882'];

const TABLE: Readonly<Record<string, [string, string]>> = {
  food: ['#8FA3B8', '#4F6479'],
  cafe: ['#B7B2C7', '#6E6A85'],
  walk: ['#D3CABB', '#8D8576'],
  night: ['#5D6B8A', '#2F3A55'],
  shop: ['#D9B8B4', '#96706C'],
  museum: MUSEUM,
  experience: MUSEUM,
  landmark: ['#BBC2CA', '#737C88'],
};

// 표에 없는 종류가 와도 화면이 깨지지 않게 landmark 색을 쓴다
export function placeholderFor(category: string): [string, string] {
  const colours = Object.prototype.hasOwnProperty.call(TABLE, category) ? TABLE[category] : TABLE.landmark;
  return [colours[0], colours[1]];
}
