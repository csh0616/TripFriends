// DESIGN-001 §4-8 (TASK-010 C5): 장소 그림 색. 종류마다 밝은 끝(cat-*-a) -> 깊은 끝(cat-*-b). 색 값을 둘 수 있는 유일한 파일 (토큰 표 밖 값).
const LANDMARK: [string, string] = ['#87919C', '#576069'];

const TABLE: Readonly<Record<string, [string, string]>> = {
  cafe: ['#8D75B7', '#5B457F'],
  food: ['#476C94', '#1B3C60'],
  walk: ['#3A8989', '#005757'],
  museum: ['#746C5C', '#443D2F'],
  landmark: LANDMARK,
  shop: ['#975388', '#612555'],
  experience: ['#4373D5', '#184098'],
  night: ['#403F79', '#191345'],
};

// 모르는 종류가 와도 화면이 깨지지 않게 landmark 색을 쓴다 (cat-fallback)
export function placeholderFor(category: string): [string, string] {
  const colours = Object.prototype.hasOwnProperty.call(TABLE, category) ? TABLE[category] : LANDMARK;
  return [colours[0], colours[1]];
}
