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
export const MicIcon = (p: Props) => (
  <Icon {...p} d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3zM6 11.5a6 6 0 0 0 12 0M12 17.5V21" />
);
export const LocateIcon = (p: Props) => (
  <Icon {...p} d="M12 3v3M12 18v3M3 12h3M18 12h3M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />
);

// TASK-010 여행 만들기: 검색 칸·숙소·다음·알림
// TASK-015 §24(04·05): a3 못 찾음 = 돋보기 + 렌즈 안 ×
export const SearchOffIcon = (p: Props) => <Icon {...p} d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20M8.5 8.5l4 4M12.5 8.5l-4 4" />;
export const SearchIcon = (p: Props) => <Icon {...p} d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20" />;
export const HouseIcon = (p: Props) => <Icon {...p} d="M4 11l8-6.5 8 6.5M6 9.8V19h12V9.8M10 19v-5h4v5" />;
export const NextIcon = (p: Props) => <Icon {...p} d="M9.5 5.5L16 12l-6.5 6.5" />;
export const AlertIcon = (p: Props) => <Icon {...p} d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v5M12 16v.5" />;

export const ClockIcon = (p: Props) => <Icon {...p} d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4.5l3 1.8" />;

// TASK-014 위치·연습 (DESIGN-001 §4-13)
export const PinIcon = (p: Props) => <Icon {...p} d="M12 21s6-5.6 6-11a6 6 0 1 0-12 0c0 5.4 6 11 6 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />;
export const LockIcon = (p: Props) => <Icon {...p} d="M6.5 11h11v8h-11zM8.5 11V8.5a3.5 3.5 0 0 1 7 0V11" />;
export const LocationOffIcon = (p: Props) => <Icon {...p} d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 3v3M12 18v3M3 12h3M18 12h3M4 4l16 16" />;
export const WalkIcon = (p: Props) => <Icon {...p} d="M13 5a1.5 1.5 0 1 0 0 .01M11 20l1.5-6-2.5-2 1-4 3 2 2.5 1M10 8.5 8 12M12.5 14l2 6" />;
export const InfoIcon = (p: Props) => <Icon {...p} d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 11v5M12 8v.5" />;

// 사람(머리 아바타, DESIGN-001 §4-12) · 길(연습 띠 reh-band, 보드 route)
export const PersonIcon = (p: Props) => <Icon {...p} d="M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />;
export const RouteIcon = (p: Props) => <Icon {...p} d="M6 19a2 2 0 1 0 0-.01M18 5a2 2 0 1 0 0-.01M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7" />;

// 연습 시계 [재생]·[멈춤] (DESIGN-001 §4-13 reh-clock)
export const PlayIcon = (p: Props) => <Icon {...p} d="M8 5.5v13l10-6.5z" />;
export const PauseIcon = (p: Props) => <Icon {...p} d="M9 5.5v13M15 5.5v13" />;

// TASK-015 §D 코스 크게 보기 알약
export const ExpandIcon = (p: Props) => <Icon {...p} d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />;
/** 바깥으로 나가는 링크 화살표 (TASK-015 §32 칩 시트 [구글 지도에서 보기], task-015-design §16-3) */
export const ExternalIcon = (p: Props) => <Icon {...p} d="M14 5h5v5M19 5l-8 8M17 13.5V19H5V7h5.5" />;
