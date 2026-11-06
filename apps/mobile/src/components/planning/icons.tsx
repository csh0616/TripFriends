// 아이콘: 24칸, 둥근 선 icon-stroke(1.75), 색은 부른 쪽이 정한다. 이모지는 쓰지 않는다.
import Svg, { Path } from 'react-native-svg';

import { control } from '@/planning/theme';

type Props = { color: string; size?: number };

function Icon({ color, size = control.icon, d }: Props & { d: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={d} stroke={color} strokeWidth={control['icon-stroke']} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export const BackIcon = (p: Props) => <Icon {...p} d="M14.5 5.5 8 12l6.5 6.5" />;
export const CheckIcon = (p: Props) => <Icon {...p} d="M5 12.5l4.5 4.5L19 7.5" />;
export const PlusIcon = (p: Props) => <Icon {...p} d="M12 5v14M5 12h14" />;
export const CloseIcon = (p: Props) => <Icon {...p} d="M6 6l12 12M18 6L6 18" />;
// 집 모양 선 (24칸). 동선 그림처럼 Svg 안에서 G로 줄여 그릴 때 쓴다
export const HOME_PATH = 'M4 11l8-7 8 7M6 9.5V20h12V9.5';
export const MicIcon = (p: Props) => (
  <Icon {...p} d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3zM6 11.5a6 6 0 0 0 12 0M12 17.5V21" />
);
