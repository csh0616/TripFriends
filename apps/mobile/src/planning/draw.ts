// TASK-004 §13-2 #8: 동그라미가 그려지는 움직임. 시간은 dur-draw 토큰, 기기의 "움직임 줄이기"가 켜져 있으면 0.
// 리애니메이티드가 아니라 RN Animated를 쓴다. 담기 응답이 온 뒤(부품이 나타난 뒤)에만 시작한다 = 낙관적 갱신 없음.
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

import { motion } from './theme';

// "cubic-bezier(.2,.8,.2,1)" -> Easing.bezier
const [x1, y1, x2, y2] = (/\(([^)]*)\)/.exec(motion['ease-out'])?.[1] ?? '0,0,1,1').split(',').map(Number);
const easeOut = Easing.bezier(x1, y1, x2, y2);

/** 기기의 움직임 줄이기. 읽기가 실패하면 false */
export function readReduceMotion(): Promise<boolean> {
  return AccessibilityInfo.isReduceMotionEnabled().then(
    (value) => value === true,
    () => false,
  );
}

/** 처음 나타날 때 0 -> 1로 한 번 움직이는 값 */
export function useDraw(): Animated.Value {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let live = true;
    let running: Animated.CompositeAnimation | null = null;
    // 설정을 못 읽으면 움직임을 줄이지 않은 것으로 본다 (끝값까지 그려진다)
    readReduceMotion().then((reduce) => {
      if (!live) return;
      running = Animated.timing(progress, {
        toValue: 1,
        duration: reduce ? 0 : motion['dur-draw'],
        easing: easeOut,
        useNativeDriver: false,
      });
      running.start();
    });
    return () => {
      live = false;
      running?.stop();
    };
  }, [progress]);
  return progress;
}
