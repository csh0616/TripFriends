// 화면 글자를 만드는 작은 함수들 (판단·계산이 아니라 표시용 글자). 날짜·시각은 서버가 준 값을 그대로 옮긴다.
import type { DaySummary } from '@/lib/planning-api';

const ORDINAL = ['첫째', '둘째', '셋째', '넷째', '다섯째'];
const WEEKDAY = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

/** TASK-004 Q10: 첫째~다섯째 날, 6일부터 "{n}일째" (서버와 같은 규칙) */
export function dayName(dayNumber: number): string {
  return dayNumber >= 1 && dayNumber <= ORDINAL.length ? `${ORDINAL[dayNumber - 1]} 날` : `${dayNumber}일째`;
}

/** TASK-004 Q32·Q43: "12월 2일 수요일 · 10:00~20:00" */
export function daySubtitle(day: DaySummary): string {
  const [year, month, date] = day.date.split('-').map(Number);
  const weekday = WEEKDAY[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
  return `${month}월 ${date}일 ${weekday} · ${day.start}~${day.end}`;
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Q40 한글 마지막 글자에 받침이 있으면 "은", 없으면 "는". 한글이 아니면 null (조사를 피한다) */
export function topicParticle(name: string): '은' | '는' | null {
  const code = name.trim().charCodeAt(name.trim().length - 1);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return null;
  return (code - 0xac00) % 28 === 0 ? '는' : '은';
}

/** TASK-004 Q6·Q40: 꼭 갈 곳 줄. 하나면 "{이름}은 먼저 넣어 뒀어", 여럿이면 조사를 피해 쉼표로 */
export function mustVisitLine(names: string[]): string {
  if (names.length === 1) {
    const particle = topicParticle(names[0]);
    return particle ? `${names[0]}${particle} 먼저 넣어 뒀어` : `${names[0]}, 먼저 넣어 뒀어`;
  }
  return `${names.join(', ')}, 먼저 넣어 뒀어`;
}

export const pad2 = (value: number) => String(value).padStart(2, '0');
