// @gorhom/bottom-sheet 가짜 (TASK-006 B5). 안의 내용을 높이와 상관없이 모두 그린다.
// 끌기, 실제 높이, "낮게는 메인 한 줄"은 이 가짜로 알 수 없다. Maestro·폰 몫.
import { createElement, forwardRef, useImperativeHandle } from 'react';
import { ScrollView, View } from 'react-native';

type Props = Record<string, any>;

export const sheetControl = {
  commands: [] as string[], // 앱이 시트를 직접 움직인 기록 (§6: 시트 높이는 사용자 것)
  onChange: undefined as undefined | ((index: number) => void),
  reset() {
    this.commands = [];
    this.onChange = undefined;
  },
};

const BottomSheet = forwardRef<unknown, Props>(function BottomSheet(props, ref) {
  sheetControl.onChange = props.onChange;
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
  return createElement(View, { testID: 'card-sheet', snapPoints: props.snapPoints, index: props.index } as object, props.children);
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
