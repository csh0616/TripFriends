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
