// react-native-svg 가짜: 어떤 도형이든 View로 그린다. 겉모습은 시험하지 않는다.
import { createElement } from 'react';
import { Text, View } from 'react-native';

const shape = (props: object) => createElement(View, props);
const label = (props: object) => createElement(Text, props);

module.exports = new Proxy(
  { __esModule: true },
  {
    get(target: Record<string | symbol, unknown>, name) {
      if (typeof name === 'symbol' || name === 'then' || name in target) return target[name];
      return name === 'Text' ? label : shape;
    },
  },
);
