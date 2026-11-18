// @gorhom/bottom-sheet 가짜 (TASK-006 B5). 안의 내용을 높이와 상관없이 모두 그린다.
// 끌기, 실제 높이, "낮게는 메인 한 줄"은 이 가짜로 알 수 없다. Maestro·폰 몫.
// 진짜 부품처럼 받는 style과 accessible을 남긴다. accessible을 안 주면 true다
// (@gorhom/bottom-sheet src/components/bottomSheet/constants.ts의 DEFAULT_ACCESSIBLE = true: 안의 요소가 하나로 묶인다).
import { createElement, forwardRef, useImperativeHandle } from 'react';
import { ScrollView, View } from 'react-native';

type Props = Record<string, any>;

export const sheetControl = {
  commands: [] as string[], // 앱이 시트를 직접 움직인 기록 (§6: 시트 높이는 사용자 것)
  onChange: undefined as undefined | ((index: number) => void),
  props: null as Props | null,
  /** TASK-015 §29 하-13: 그릴 때마다 받은 snapPoints (접힌 단이 중간 값을 거치는지 본다) */
  history: [] as (string | number)[][],
  reset() {
    this.commands = [];
    this.onChange = undefined;
    this.props = null;
    this.history = [];
  },
  /**
   * 사용자가 index 단으로 끌어 놓은 것처럼: animatedPosition(시트 윗면의 y)을 넣고 onChange를 부른다.
   * 위치는 문서 값으로 계산한다: 윗면 = 영역 높이 − 그 단의 높이. 높이는 snapPoints('88%'는 비율, 숫자는 px)에서 읽는다.
   */
  settle(index: number, areaHeight: number) {
    const point = this.props?.snapPoints?.[index];
    // '%' 글자 = 비율, 숫자 = 높이 px (진짜 부품과 같다. TASK-015 §24 18번: 접힌 단은 px로 올 수 있다)
    const height = typeof point === 'string' ? (Number(point.replace('%', '')) / 100) * areaHeight : Number(point);
    if (this.props?.animatedPosition) this.props.animatedPosition.value = areaHeight - height;
    this.onChange?.(index);
  },
};

const BottomSheet = forwardRef<unknown, Props>(function BottomSheet(props, ref) {
  sheetControl.onChange = props.onChange;
  sheetControl.props = props;
  if (Array.isArray(props.snapPoints)) sheetControl.history.push([...props.snapPoints]);
  const record = (name: string) => () => {
    sheetControl.commands.push(name);
  };
  useImperativeHandle(ref, () => ({
    snapToIndex: record('snapToIndex'),
    snapToPosition: record('snapToPosition'),
    expand: record('expand'),
    collapse: record('collapse'),
    close: record('close'),
  }));
  return createElement(
    View,
    { testID: 'card-sheet', snapPoints: props.snapPoints, index: props.index, style: props.style, accessible: props.accessible ?? true } as object,
    props.children,
  );
});

const plain = (props: Props) => createElement(View, props as object);

module.exports = {
  __esModule: true,
  sheetControl,
  default: BottomSheet,
  BottomSheetView: plain,
  BottomSheetScrollView: (props: Props) => createElement(ScrollView, props as object),
  BottomSheetBackdrop: () => null,
};
