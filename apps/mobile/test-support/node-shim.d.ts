// 소스를 읽는 가드레일 테스트에 필요한 만큼만 적은 Node 타입 (@types/node를 앱에 더하지 않으려고).
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): { equals(other: unknown): boolean };
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
  // TASK-014 §16 Q2: 최종 Info.plist를 임시 파일로 써서 개발 런처의 릴리스 빌드 단계를 돌려 보는 테스트
  export function mkdtempSync(prefix: string): string;
  export function writeFileSync(path: string, data: string): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[], options?: { env?: Record<string, string> }): unknown;
  export function execFileSync(file: string, args: string[], options: { encoding: 'utf8'; env?: Record<string, string> }): string;
}
declare module 'node:path' {
  export const sep: string;
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
}
declare const __dirname: string;
// TASK-012 §19 F1: PKCE 테스트와 expo-crypto 가짜가 쓰는 만큼
interface NodeBuffer extends Uint8Array {
  toString(encoding?: 'hex' | 'base64' | 'utf8'): string;
}
declare const Buffer: {
  from(data: ArrayBuffer | ArrayBufferLike, byteOffset?: number, length?: number): NodeBuffer;
};
declare module 'node:crypto' {
  interface Hash {
    update(data: string | Uint8Array, encoding?: 'utf8'): Hash;
    digest(): NodeBuffer;
    digest(encoding: 'hex' | 'base64'): string;
  }
  export function createHash(algorithm: string): Hash;
  export function randomBytes(size: number): NodeBuffer;
  export function randomUUID(): string;
}
// TASK-013 §11: 가짜 모듈 4개(module.exports)용. expo-env.d.ts(git 밖)가 없는 CI에서도 tsc가 통과하게.
declare const module: { exports: unknown };
