// test-support/node-shim.d.ts를 고칠 수 없어서, 로고 파일을 바이트로 비교하는 가드레일 테스트(G65)에 필요한 한 줄만 더한다.
// 같은 모듈 선언은 합쳐지므로 기존 선언은 그대로 두고 오버로드만 추가한다.
declare module 'node:fs' {
  export function readFileSync(path: string): { equals(other: unknown): boolean };
}
