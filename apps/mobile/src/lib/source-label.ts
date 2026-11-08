// ADR-015 §3-5 · TASK-010 C6: source_type 원문을 화면에 쓰지 않는다. 표에 없는 값은 모두 "출처 정보".
// "Google Maps"는 번역하지 않는다 (§11 G1).
export function sourceLabel(sourceType: string): string {
  switch (sourceType) {
    case 'google':
      return 'Google Maps';
    case 'serper':
      return '검색 결과 · 미확인';
    case 'user':
      return '내가 확인';
    case 'curated':
      return 'Tripfriends';
    case 'demo':
      return '데모 데이터';
    default:
      return '출처 정보';
  }
}
