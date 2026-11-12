// 소스를 읽는 가드레일 테스트에 필요한 만큼만 적은 Node 타입 (@types/node를 앱에 더하지 않으려고).
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): { equals(other: unknown): boolean };
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
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
