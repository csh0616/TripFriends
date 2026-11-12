// TASK-012 C5: 프로필 메뉴·어느 여행 시트에 보이는 이메일 일부 (리뷰 파일 §1: 앞 2글자 + *** + @도메인, 앞부분이 2글자 이하면 1글자).
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  const name = at < 0 ? email : email.slice(0, at);
  const host = at < 0 ? '' : email.slice(at);
  return `${name.slice(0, name.length <= 2 ? 1 : 2)}***${host}`;
}
