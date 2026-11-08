// TASK-010 §12 답 3: 실제 여행의 계획 대화에서는 머리 왼쪽에 "‹ 날짜" 뒤로가 있다. 화면이 따로 뒤로를 정하지 않았을 때만 쓴다.
import { createContext } from 'react';

export const LeaveContext = createContext<(() => void) | null>(null);
