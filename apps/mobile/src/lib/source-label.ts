// B3: source_type 원문을 화면에 쓰지 않는다. demo -> "데모 데이터", user -> "내가 확인", 그 밖 -> "출처 정보" (TASK-010에서 실제 출처 이름으로)
export function sourceLabel(sourceType: string): string {
  if (sourceType === 'demo') return '데모 데이터';
  if (sourceType === 'user') return '내가 확인';
  return '출처 정보';
}
