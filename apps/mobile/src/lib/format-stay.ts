// TASK-004 §B-5: 머문 시간 글자. 90 -> "1시간 30분", 60 -> "1시간", 45 -> "45분"
export function formatStay(min: number): string {
  const hours = Math.floor(min / 60);
  const rest = min % 60;
  if (hours === 0) return `${rest}분`;
  if (rest === 0) return `${hours}시간`;
  return `${hours}시간 ${rest}분`;
}
