// react-native-svg 가짜: 어떤 도형이든 View로 그린다. 겉모습은 시험하지 않는다.
import { createElement } from 'react';
import { Text, View } from 'react-native';

// svgElement: 무슨 부품인지 렌더 결과에서 볼 수 있게 남긴다 (TASK-005 B7: 동선 그림에 Svg는 하나)
const shape = (svgElement: string) => (props: object) => createElement(View, { ...props, svgElement } as object);
const label = (props: object) => createElement(Text, { ...props, svgElement: 'Text' } as object);

const shapes = new Map<string, (props: object) => unknown>(); // 같은 이름은 같은 부품이어야 다시 그릴 때 새로 만들어지지 않는다

module.exports = new Proxy(
  { __esModule: true },
  {
    get(target: Record<string | symbol, unknown>, name) {
      if (typeof name === 'symbol' || name === 'then' || name in target) return target[name];
      if (name === 'Text') return label;
      if (!shapes.has(name)) shapes.set(name, shape(name === 'default' ? 'Svg' : name));
      return shapes.get(name);
    },
  },
);
