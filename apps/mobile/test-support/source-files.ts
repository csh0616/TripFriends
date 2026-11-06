// 소스를 읽어 검사하는 가드레일(G1·G5)용 도구.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const MOBILE_ROOT = join(__dirname, '..');
export const SRC = join(MOBILE_ROOT, 'src');
export const REPO_ROOT = join(MOBILE_ROOT, '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const isTest = (path: string) => path.split(sep).includes('__tests__') || /\.test\.[jt]sx?$/.test(path);

/** apps/mobile/src 아래 테스트를 뺀 모든 파일 (경로는 src 기준, / 구분) */
export function sourceFiles(): { path: string; text: string }[] {
  return walk(SRC)
    .filter((path) => !isTest(path))
    .filter((path) => /\.(tsx?|jsx?|css|json)$/.test(path))
    .map((path) => ({ path: relative(SRC, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));
}

export const hits = (files: { path: string; text: string }[], pattern: RegExp) =>
  files.flatMap(({ path, text }) =>
    text
      .split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => new RegExp(pattern.source, pattern.flags.replace('g', '')).test(line))
      .map(({ line, index }) => `${path}:${index + 1}: ${line.trim()}`),
  );
