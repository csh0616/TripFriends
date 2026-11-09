// TASK-011 화면 테스트가 함께 쓰는 나무 읽기 도구 (로직·가드레일 확인용. 모습 값은 보지 않는다).
import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

export type Host = {
  type: unknown;
  props: Record<string, any>;
  parent: Host | null;
  children: (Host | string)[];
  queryAll: (pick: (host: Host) => boolean) => Host[];
};

export const styleOf = (host: Host) => (StyleSheet.flatten(host.props.style) ?? {}) as Record<string, any>;
export const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toUpperCase() === b.toUpperCase();
export const rootHost = () => screen.root as unknown as Host;

export const chain = (host: Host): Host[] => {
  const list: Host[] = [];
  for (let now: Host | null = host; now; now = now.parent) list.push(now);
  return list;
};

/** testID가 붙은 부품에서 실제로 눌리는 상자 (onClick이 있는 View) */
export const pressableOf = (host: Host): Host =>
  chain(host).find((h) => typeof h.props.onClick === 'function') ?? host.queryAll((h) => typeof h.props.onClick === 'function')[0] ?? host;

/** 바탕이 주어진 색인 모든 상자 (under 아래, 없으면 화면 전체) */
export const filledWith = (colour: string, under: Host = rootHost()) => under.queryAll((host) => same(styleOf(host).backgroundColor, colour));

/** 바탕이 주어진 색인 눌리는 버튼 */
export const buttonsFilledWith = (colour: string, under: Host = rootHost()) =>
  under.queryAll((host) => typeof host.props.onClick === 'function' && same(styleOf(host).backgroundColor, colour));

export const isInside = (host: Host, outer: Host) => chain(host).includes(outer);

/** 두 상자를 함께 담은 가장 가까운 상자 */
export const commonAncestor = (a: Host, b: Host): Host => {
  const outer = chain(b);
  const found = chain(a).find((host) => outer.includes(host));
  if (!found) throw new Error('같은 화면 나무가 아니다');
  return found;
};

/** ancestor 바로 아래 자식 중 host를 담은 것 */
export const childOn = (ancestor: Host, host: Host): Host => {
  const found = chain(host).find((h) => h.parent === ancestor);
  if (!found) throw new Error('ancestor 아래에 없다');
  return found;
};

/** 화면 나무 앞에서부터의 순서 (깊이 우선) */
export const treeIndex = (host: Host, root: Host = rootHost()): number => [root, ...root.queryAll(() => true)].indexOf(host);

/** 바탕색이 없다 (미지정·transparent·알파 0) */
export const noFill = (value: unknown) =>
  value === undefined || value === null || value === 'transparent' || /^(#0000|#00000000|rgba\(.*,\s*0\))$/i.test(String(value));
